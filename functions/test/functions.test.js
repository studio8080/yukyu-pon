// node functions/test/functions.test.js — Webhook とキー更新の全経路を、Stripe・Firestore・メールを差し替えて確かめる
// （functions の npm install は不要。外部モジュールはすべて差し替える。functions/node_modules に stripe があれば、
//   署名の検証だけは本物の SDK でも確かめる）
//
// イベントは Stripe の実際の形（Webhook の API バージョン 2026-08-26.dahlia、SDK の照会は 2025-08-27.basil）に合わせ、
// 使わない項目も入れた本物らしい JSON にしている。古い形（basil より前: 直下の current_period_end、invoice.subscription、
// 明細の price.product）でも動くことを別に確かめる。
'use strict';
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const Module = require('node:module');

const FN = path.join(__dirname, '..');
const PRO = 'prod_TEST_PRO';
const BIZ = 'prod_TEST_BIZ';
const ZENGINPON = 'prod_VEa5100IEJu6JE'; // 全銀ポン Pro（共用アカウントのほかの製品）
const MISEFITS = 'prod_MISEFITS_TEST';
const WHSEC = 'whsec_test_secret';
const API_VERSION = '2026-08-26.dahlia';
const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519'); // 使い捨ての鍵（本番の秘密鍵は使わない）
const PEM = privateKey.export({ type: 'pkcs8', format: 'pem' });

// ---- 差し替え ----
const store = {}; // Firestore の代わり（コレクション/ID → 値）
const mails = [];
let subs = {};
let customers = {};
let failMailOnce = false;
let smtpHost = 'smtp.example';
const calls = { subRetrieve: 0, custRetrieve: 0 };
let subRetrieveError = null; // Stripe 照会の失敗（権限不足など）
const setFailures = []; // Firestore の set を1回失敗させる条件
let realWebhooks = null; // 本物の SDK の webhooks（あれば）

const docRef = (col, id) => {
  const k = `${col}/${id}`;
  return {
    async set(v, o) {
      const i = setFailures.findIndex((f) => f(k, v));
      if (i >= 0) {
        setFailures.splice(i, 1);
        throw new Error('14 UNAVAILABLE: firestore down');
      }
      store[k] = o && o.merge ? { ...(store[k] || {}), ...v } : { ...v };
    },
    async create(v) {
      if (store[k]) {
        const e = new Error('6 ALREADY_EXISTS: Document already exists');
        e.code = 6;
        throw e;
      }
      store[k] = { ...v };
    },
    async get() {
      return { exists: !!store[k], data: () => store[k] };
    },
  };
};
const tick = () => new Promise((r) => setTimeout(r, 2));
const stripeError = (type, message, extra = {}) => Object.assign(new Error(message), { type, ...extra });

const fakes = {
  'firebase-functions/v2/https': { onRequest: (_opts, fn) => Object.assign(fn, { opts: _opts }) },
  'firebase-functions/params': {
    defineSecret: (n) => ({ value: () => ({ YP_LICENSE_PRIVATE_KEY: PEM, MAIL_FROM: 'MiseFits <studio@kokokikaku.com>', YP_STRIPE_WEBHOOK_SECRET: WHSEC })[n] || 'x' }),
    defineString: (n, o) => ({ value: () => (n === 'SMTP_HOST' ? smtpHost : (o && o.default) || '') }),
  },
  'firebase-admin/app': { initializeApp() {}, getApps: () => [1] },
  'firebase-admin/firestore': { getFirestore: () => ({ collection: (col) => ({ doc: (id) => docRef(col, id) }) }) },
  stripe: function Stripe() {
    return {
      webhooks: {
        // Stripe の署名方式（t=<時刻>,v1=<HMAC-SHA256(t.本文)>）をそのまま再現する
        constructEvent: (raw, header, secret) => {
          if (realWebhooks) return realWebhooks.constructEvent(raw, header, secret);
          const parts = Object.fromEntries(String(header || '').split(',').map((kv) => kv.split('=')));
          const expected = crypto.createHmac('sha256', secret).update(`${parts.t}.${raw}`).digest('hex');
          if (!parts.v1 || parts.v1 !== expected) throw stripeError('StripeSignatureVerificationError', 'No signatures found matching the expected signature for payload');
          return JSON.parse(raw.toString());
        },
      },
      subscriptions: {
        retrieve: async (id) => {
          calls.subRetrieve++;
          await tick();
          if (subRetrieveError) throw subRetrieveError;
          if (!subs[id]) throw stripeError('StripeInvalidRequestError', `No such subscription: '${id}'`, { code: 'resource_missing', statusCode: 404 });
          return JSON.parse(JSON.stringify(subs[id]));
        },
      },
      customers: {
        retrieve: async (id) => {
          calls.custRetrieve++;
          const c = customers[id];
          if (c instanceof Error) throw c;
          if (!c) throw stripeError('StripeInvalidRequestError', `No such customer: '${id}'`, { code: 'resource_missing', statusCode: 404 });
          return c;
        },
      },
    };
  },
  nodemailer: {
    createTransport: () => ({
      sendMail: async (m) => {
        if (failMailOnce) {
          failMailOnce = false;
          throw new Error('SMTP down');
        }
        mails.push(m);
      },
    }),
  },
};
const { PLANS } = require(path.join(FN, 'plans.js'));
const sign = require(path.join(FN, 'sign.js'));
const B = require(path.join(FN, 'billing.js'));
const origLoad = Module._load;
Module._load = function (req, ...rest) {
  return fakes[req] || origLoad.call(this, req, ...rest);
};
const fns = require(path.join(FN, 'index.js'));
Module._load = origLoad;

// ---- 日付 ----
const DAY = 86400;
const now = Math.floor(Date.now() / 1000);
const isoDay = (unix) => new Date(unix * 1000).toISOString().slice(0, 10);
const today = isoDay(now);
const plusDays = (n) => isoDay(now + n * DAY);

// ---- Stripe の実際の形に近いオブジェクト ----
let seq = 0;
const rid = (p) => `${p}_${(++seq).toString(36).padStart(14, '0')}`;
const priceOf = (product, interval, amount) => ({
  id: `price_${product}_${interval}`,
  object: 'price',
  active: true,
  billing_scheme: 'per_unit',
  created: now - 30 * DAY,
  currency: 'jpy',
  custom_unit_amount: null,
  livemode: true,
  lookup_key: null,
  metadata: {},
  nickname: null,
  product, // サブスクリプションの中では商品は文字列のID（展開しない）
  recurring: { interval, interval_count: 1, meter: null, trial_period_days: null, usage_type: 'licensed' },
  tax_behavior: 'inclusive',
  tiers_mode: null,
  transform_quantity: null,
  type: 'recurring',
  unit_amount: amount,
  unit_amount_decimal: String(amount),
});

/**
 * サブスクリプション（2026-08-26.dahlia の形）。legacy: true なら basil より前の形（期間が直下）
 */
function mkSub(id, product, o = {}) {
  const interval = o.interval || 'month';
  const start = o.start != null ? o.start : now - 2 * DAY;
  const end = o.end != null ? o.end : start + (interval === 'year' ? 365 : 30) * DAY;
  const amount = product === BIZ ? (interval === 'year' ? 9800 : 980) : interval === 'year' ? 4800 : 480;
  const item = {
    id: `si_${id}`,
    object: 'subscription_item',
    billing_thresholds: null,
    created: start,
    current_period_end: end,
    current_period_start: start,
    discounts: [],
    metadata: {},
    plan: { id: `price_${product}_${interval}`, object: 'plan', active: true, amount, currency: 'jpy', interval, interval_count: 1, product, usage_type: 'licensed' },
    price: priceOf(product, interval, amount),
    quantity: 1,
    subscription: id,
    tax_rates: [],
  };
  if (o.legacy) {
    delete item.current_period_end;
    delete item.current_period_start;
  }
  return {
    id,
    object: 'subscription',
    application: null,
    application_fee_percent: null,
    automatic_tax: { disabled_reason: null, enabled: false, liability: null },
    billing_cycle_anchor: start,
    billing_cycle_anchor_config: null,
    billing_mode: { type: 'flexible', flexible: { proration_discounts: 'included' }, updated_at: start },
    billing_thresholds: null,
    cancel_at: o.cancel_at || null,
    cancel_at_period_end: !!o.cancel_at_period_end,
    canceled_at: o.canceled_at || null,
    cancellation_details: { comment: null, feedback: null, reason: o.status === 'canceled' ? 'cancellation_requested' : null },
    collection_method: 'charge_automatically',
    created: start,
    currency: 'jpy',
    customer: o.customer || `cus_${id}`,
    customer_account: null,
    days_until_due: null,
    default_payment_method: 'pm_1Test',
    default_source: null,
    default_tax_rates: [],
    description: null,
    discounts: [],
    ended_at: o.ended_at || null,
    invoice_settings: { account_tax_ids: null, issuer: { type: 'self' } },
    items: { object: 'list', data: [item], has_more: false, total_count: 1, url: `/v1/subscription_items?subscription=${id}` },
    latest_invoice: `in_${id}`,
    livemode: true,
    metadata: {},
    next_pending_invoice_item_invoice: null,
    on_behalf_of: null,
    pause_collection: null,
    payment_settings: { payment_method_options: null, payment_method_types: null, save_default_payment_method: 'off' },
    pending_invoice_item_interval: null,
    pending_setup_intent: null,
    pending_update: null,
    plan: null,
    quantity: 1,
    schedule: null,
    start_date: start,
    status: o.status || 'active',
    test_clock: null,
    transfer_data: null,
    trial_end: null,
    trial_settings: { end_behavior: { missing_payment_method: 'create_invoice' } },
    trial_start: null,
    ...(o.legacy ? { current_period_start: start, current_period_end: end } : {}),
  };
}

/** 支払いリンク（Payment Link）から完了したチェックアウト */
function mkSession(subId, o = {}) {
  return {
    id: rid('cs_live'),
    object: 'checkout.session',
    adaptive_pricing: { enabled: false },
    after_expiration: null,
    allow_promotion_codes: false,
    amount_subtotal: o.amount || 480,
    amount_total: o.amount || 480,
    automatic_tax: { enabled: false, liability: null, provider: null, status: null },
    billing_address_collection: 'auto',
    cancel_url: null,
    client_reference_id: null,
    collected_information: { business_name: null, individual_name: null, shipping_details: null },
    consent: null,
    consent_collection: null,
    created: now - 60,
    currency: 'jpy',
    custom_fields: [],
    custom_text: { after_submit: null, shipping_address: null, submit: { message: '有休ポン Pro（在籍30人まで）月額480円（税込）…' }, terms_of_service_acceptance: null },
    customer: o.customer === undefined ? `cus_${subId}` : o.customer,
    customer_creation: 'always',
    customer_details: o.noDetails
      ? null
      : { address: { city: null, country: 'JP', line1: null, line2: null, postal_code: null, state: null }, business_name: null, email: o.email === undefined ? 'buyer@example.com' : o.email, individual_name: null, name: 'テスト 太郎', phone: null, tax_exempt: 'none', tax_ids: [] },
    customer_email: o.customer_email || null,
    discounts: [],
    expires_at: now + DAY,
    invoice: `in_${subId}`,
    invoice_creation: null,
    livemode: true,
    locale: 'auto',
    metadata: {},
    mode: o.mode || 'subscription',
    origin_context: null,
    payment_intent: null,
    payment_link: 'plink_1TestYukyuPro',
    payment_method_collection: 'always',
    payment_method_types: ['card'],
    payment_status: 'paid',
    phone_number_collection: { enabled: false },
    recovered_from: null,
    saved_payment_method_options: null,
    setup_intent: null,
    shipping_address_collection: null,
    status: 'complete',
    submit_type: 'auto',
    subscription: subId,
    success_url: 'https://stripe.com',
    total_details: { amount_discount: 0, amount_shipping: 0, amount_tax: 0 },
    ui_mode: 'hosted',
    url: null,
    wallet_options: null,
  };
}

/** 支払い済みの請求書（dahlia の形: parent.subscription_details・明細の pricing.price_details）。legacy は古い形 */
function mkInvoice(subId, product, o = {}) {
  const amount = o.amount || 480;
  const line = o.legacy
    ? { id: rid('il'), object: 'line_item', amount, currency: 'jpy', description: '1 × 有休ポン', period: { start: now, end: now + 30 * DAY }, price: priceOf(product, 'month', amount), plan: { id: 'price_x', product }, proration: false, quantity: 1, subscription: subId, type: 'subscription' }
    : {
        id: rid('il'),
        object: 'line_item',
        amount,
        currency: 'jpy',
        description: '1 × 有休ポン (at ¥480 / month)',
        discount_amounts: [],
        discountable: true,
        discounts: [],
        invoice: `in_${subId}`,
        livemode: true,
        metadata: {},
        parent: { type: 'subscription_item_details', invoice_item_details: null, subscription_item_details: { invoice_item: null, proration: false, proration_details: { credited_items: null }, subscription: subId, subscription_item: `si_${subId}` } },
        period: { end: now + 30 * DAY, start: now },
        pretax_credit_amounts: [],
        pricing: { price_details: { price: `price_${product}_month`, product }, type: 'price_details', unit_amount_decimal: String(amount) },
        quantity: 1,
        taxes: [],
      };
  return {
    id: rid('in'),
    object: 'invoice',
    account_country: 'JP',
    account_name: 'ここ企画',
    amount_due: amount,
    amount_paid: amount,
    amount_remaining: 0,
    attempt_count: 1,
    attempted: true,
    billing_reason: o.reason || 'subscription_cycle',
    collection_method: 'charge_automatically',
    created: now,
    currency: 'jpy',
    customer: o.customer || `cus_${subId}`,
    customer_email: o.email === undefined ? 'buyer@example.com' : o.email,
    customer_name: 'テスト 太郎',
    hosted_invoice_url: 'https://invoice.stripe.com/i/test',
    lines: { object: 'list', data: [line], has_more: false, total_count: 1, url: '/v1/invoices/in_x/lines' },
    livemode: true,
    metadata: {},
    number: 'ABCD-0001',
    parent: o.legacy ? null : { quote_details: null, subscription_details: { metadata: {}, subscription: subId }, type: 'subscription_details' },
    ...(o.legacy ? { subscription: subId } : {}),
    period_end: now,
    period_start: now - 30 * DAY,
    status: 'paid',
    status_transitions: { finalized_at: now, marked_uncollectible_at: null, paid_at: now, voided_at: null },
    total: amount,
  };
}

function mkEvent(type, object, o = {}) {
  return {
    id: o.id || rid('evt'),
    object: 'event',
    api_version: API_VERSION,
    created: now,
    data: { object, ...(o.prev ? { previous_attributes: o.prev } : {}) },
    livemode: true,
    pending_webhooks: 1,
    request: { id: null, idempotency_key: null },
    type,
  };
}

// ---- 呼び出し ----
function signedHeader(raw, secret = WHSEC) {
  if (realWebhooks) return realWebhooks.generateTestHeaderString({ payload: raw, secret });
  const t = Math.floor(Date.now() / 1000);
  return `t=${t},v1=${crypto.createHmac('sha256', secret).update(`${t}.${raw}`).digest('hex')}`;
}
async function post(event, o = {}) {
  let status = 200, body;
  const res = { status(s) { status = s; return this; }, json(b) { body = b; return this; }, send(b) { body = b; return this; }, set() {} };
  const raw = JSON.stringify(event, null, 2);
  const header = o.header !== undefined ? o.header : signedHeader(raw, o.secret);
  await fns.yukyuponStripeWebhook({ method: 'POST', rawBody: Buffer.from(raw), headers: { 'stripe-signature': header, 'content-type': 'application/json' } }, res);
  return { status, body };
}
async function getKey(id, o = {}) {
  let status = 200, body;
  const headers = {};
  const res = { status(s) { status = s; return this; }, json(b) { body = b; return this; }, send(b) { body = b; return this; }, set(k, v) { headers[k] = v; } };
  await fns.yukyuponLicense({ method: o.method || 'GET', query: { id }, headers: o.origin ? { origin: o.origin } : {} }, res);
  return { status, body, headers };
}
function payloadOf(key) {
  const m = key.match(/^YP1-([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)$/);
  assert.ok(m, 'キーの形式 YP1-<base64url>.<base64url>');
  const body = Buffer.from(m[1], 'base64url');
  assert.ok(crypto.verify(null, body, publicKey, Buffer.from(m[2], 'base64url')), '署名が正しい');
  return JSON.parse(body.toString());
}
const keyIn = (text) => text.match(/YP1-\S+/)[0];
const lic = (subId) => store[`yukyuponLicenses/${sign.licenseIdFor(subId)}`];
const licenseDocs = () => Object.keys(store).filter((k) => k.startsWith('yukyuponLicenses/'));
const eventDocs = () => Object.keys(store).filter((k) => k.startsWith('yukyuponEvents/'));
const buy = async (subId, product, o = {}) => {
  subs[subId] = mkSub(subId, product, o);
  return post(mkEvent('checkout.session.completed', mkSession(subId, { email: o.email === undefined ? `${subId}@example.com` : o.email })));
};
const reset = () => {
  mails.length = 0;
  calls.subRetrieve = 0;
  calls.custRetrieve = 0;
};

(async () => {
  let passed = 0;
  const t = async (name, fn) => {
    reset();
    await fn();
    passed++;
    console.log('ok -', name);
  };

  // ---------------- 設定と署名 ----------------
  PLANS.pro.productId = '';
  PLANS.business.productId = '';
  await t('商品IDが未設定なら何もしない（共用アカウントで全部通さない）', async () => {
    subs.sub_X = mkSub('sub_X', 'prod_ANY');
    const r = await post(mkEvent('checkout.session.completed', mkSession('sub_X')));
    assert.equal(r.body.skipped, 'not configured');
    assert.equal(mails.length, 0);
    assert.equal(calls.subRetrieve, 0);
  });

  PLANS.pro.productId = PRO;
  PLANS.business.productId = BIZ;

  await t('署名が無い・違う秘密で署名された Webhook は 400 で、何も書かない', async () => {
    const before = Object.keys(store).length;
    subs.sub_S = mkSub('sub_S', PRO);
    const ev = mkEvent('checkout.session.completed', mkSession('sub_S'));
    assert.equal((await post(ev, { header: '' })).status, 400);
    assert.equal((await post(ev, { secret: 'whsec_other' })).status, 400);
    assert.equal((await post(ev, { header: 't=1,v1=deadbeef' })).status, 400);
    assert.equal(Object.keys(store).length, before);
    assert.equal(mails.length, 0);
  });

  const realStripePath = path.join(FN, 'node_modules', 'stripe');
  if (fs.existsSync(realStripePath)) {
    await t('（本物の stripe SDK）req.rawBody（Buffer）と stripe-signature で署名を検証できる', async () => {
      const RealStripe = require(realStripePath);
      realWebhooks = new RealStripe('sk_test_dummy').webhooks;
      try {
        subs.sub_RS = mkSub('sub_RS', PRO);
        const ev = mkEvent('checkout.session.completed', mkSession('sub_RS'));
        assert.equal((await post(ev)).status, 200);
        assert.equal(mails.length, 1);
        assert.equal((await post(ev, { secret: 'whsec_other' })).status, 400);
      } finally {
        realWebhooks = null;
      }
    });
  } else {
    console.log('skip - 本物の stripe SDK での署名検証（functions/node_modules が無い）');
  }

  // ---------------- 新規購入 ----------------
  await t('Pro 月払いの新規購入: 30人上限のキーを発行してメールを送り、Firestore に記録する', async () => {
    const r = await buy('sub_A', PRO, { email: 'a@example.com' });
    assert.equal(r.status, 200);
    assert.equal(mails.length, 1);
    const m = mails[0];
    const p = payloadOf(keyIn(m.text));
    assert.deepEqual(Object.keys(p).sort(), ['e', 'id', 'n', 'p', 'v']);
    assert.equal(p.v, 1);
    assert.equal(p.p, 'pro');
    assert.equal(p.n, 30);
    assert.equal(p.id, sign.licenseIdFor('sub_A'));
    assert.equal(p.e, plusDays(30)); // 期間末+3日（31日後）より、今日+30日が先
    assert.equal(m.to, 'a@example.com');
    assert.doesNotMatch(m.text, /\*\*/); // プレーンテキスト
    assert.match(m.text, /https:\/\/yukyu\.kokokikaku\.com\/#pro/);
    assert.match(m.text, /billing\.stripe\.com\/p\/login\//);
    assert.match(m.text, /Proプラン（月払い・在籍30人まで）/);
    assert.match(m.text, new RegExp(`ライセンスID: ${p.id}`));
    assert.match(m.subject, /Proプラン/);
    assert.deepEqual(m.from, { name: '有休ポン（ここ企画）', address: 'studio@kokokikaku.com' });
    const d = lic('sub_A');
    assert.equal(d.email, 'a@example.com');
    assert.equal(d.customerId, 'cus_sub_A');
    assert.equal(d.subscriptionId, 'sub_A');
    assert.equal(d.status, 'active');
    assert.equal(d.plan, 'Pro');
    assert.equal(d.limit, 30);
    assert.equal(d.entitledUntil, isoDay(subs.sub_A.items.data[0].current_period_end + 3 * DAY));
    assert.ok(d.stripeCheckedAt);
  });

  await t('ビジネス年払いの新規購入: 上限なしのキー（期限は今日+30日まで）、メールに「年払い・人数無制限」', async () => {
    await buy('sub_Y', BIZ, { interval: 'year', email: 'y@example.com' });
    assert.equal(mails.length, 1);
    const p = payloadOf(keyIn(mails[0].text));
    assert.equal(p.n, undefined);
    assert.equal(p.e, plusDays(30));
    assert.match(mails[0].text, /ビジネスプラン（年払い・人数無制限）/);
    assert.match(mails[0].subject, /ビジネスプラン/);
    assert.equal(lic('sub_Y').limit, null);
    assert.ok(lic('sub_Y').entitledUntil > plusDays(360));
  });

  await t('期間の末日が近い契約: キーの期限は期間の末日+3日（今日+30日より前）', async () => {
    await buy('sub_N', PRO, { start: now - 25 * DAY, end: now + 5 * DAY });
    assert.equal(payloadOf(keyIn(mails[0].text)).e, isoDay(now + 8 * DAY));
  });

  await t('古い形（basil より前: current_period_end がサブスクリプション直下）でも同じように発行する', async () => {
    await buy('sub_L', PRO, { legacy: true });
    assert.equal(subs.sub_L.items.data[0].current_period_end, undefined);
    assert.equal(mails.length, 1);
    assert.equal(lic('sub_L').entitledUntil, isoDay(subs.sub_L.current_period_end + 3 * DAY));
  });

  await t('チェックアウトの subscription が展開済みのオブジェクトでも読める', async () => {
    subs.sub_EX = mkSub('sub_EX', PRO);
    const s = mkSession('sub_EX');
    s.subscription = { id: 'sub_EX', object: 'subscription' };
    assert.equal((await post(mkEvent('checkout.session.completed', s))).status, 200);
    assert.equal(mails.length, 1);
  });

  await t('チェックアウトにメールが無い: customer_email → 顧客の順に補う', async () => {
    subs.sub_CE = mkSub('sub_CE', PRO);
    await post(mkEvent('checkout.session.completed', mkSession('sub_CE', { email: null, customer_email: 'prefill@example.com' })));
    assert.equal(mails[0].to, 'prefill@example.com');
    assert.equal(calls.custRetrieve, 0);
    reset();
    subs.sub_CC = mkSub('sub_CC', PRO);
    customers.cus_sub_CC = { id: 'cus_sub_CC', object: 'customer', email: 'customer@example.com' };
    await post(mkEvent('checkout.session.completed', mkSession('sub_CC', { noDetails: true })));
    assert.equal(calls.custRetrieve, 1);
    assert.equal(mails[0].to, 'customer@example.com');
  });

  await t('購入者のメールアドレスがどこにも無い: 運営者に「要対応」でキーを送り、200 で完了', async () => {
    subs.sub_NE = mkSub('sub_NE', PRO);
    customers.cus_sub_NE = { id: 'cus_sub_NE', object: 'customer', email: null };
    const r = await post(mkEvent('checkout.session.completed', mkSession('sub_NE', { email: null })));
    assert.equal(r.status, 200);
    assert.equal(mails.length, 1);
    assert.equal(mails[0].to, 'studio@kokokikaku.com');
    assert.match(mails[0].subject, /要対応.*メールアドレスが分かりません/);
    assert.match(mails[0].text, /sub_NE/);
    assert.equal(payloadOf(keyIn(mails[0].text)).n, 30);
    assert.doesNotMatch(mails[0].text, /\*\*/);
  });

  await t('顧客の照会が権限不足で失敗したら、黙って諦めず 500（Stripe が再送し、運営者に知らせる）', async () => {
    subs.sub_CP = mkSub('sub_CP', PRO);
    customers.cus_sub_CP = stripeError('StripePermissionError', 'The provided key does not have the required permissions', { statusCode: 403 });
    const ev = mkEvent('checkout.session.completed', mkSession('sub_CP', { email: null }));
    assert.equal((await post(ev)).status, 500);
    assert.equal(mails.length, 0);
    customers.cus_sub_CP = { id: 'cus_sub_CP', object: 'customer', email: 'cp@example.com' }; // 権限を直して再送
    assert.equal((await post(ev)).status, 200);
    assert.equal(mails.length, 1);
    assert.equal(mails[0].to, 'cp@example.com');
  });

  await t('支払いが済んでいない契約（incomplete）にはキーを出さず、運営者に知らせる', async () => {
    subs.sub_IC = mkSub('sub_IC', PRO, { status: 'incomplete' });
    const r = await post(mkEvent('checkout.session.completed', mkSession('sub_IC')));
    assert.equal(r.status, 200);
    assert.equal(r.body.skipped, 'not entitled');
    assert.equal(mails.length, 1);
    assert.equal(mails[0].to, 'studio@kokokikaku.com');
    assert.doesNotMatch(mails[0].text, /YP1-/);
    assert.equal(lic('sub_IC').entitledUntil, null);
  });

  // ---------------- 二重配信・同時到着・途中で落ちた再送 ----------------
  await t('同じイベントが二重に届いても、メールは1通だけ', async () => {
    subs.sub_D = mkSub('sub_D', PRO);
    const ev = mkEvent('checkout.session.completed', mkSession('sub_D'));
    await post(ev);
    const r = await post(ev);
    assert.equal(r.body.skipped, 'already processed');
    assert.equal(mails.length, 1);
  });

  await t('同じイベントが同時に届いたら、後の方は 409（Stripe が後で再送）で、メールは1通だけ', async () => {
    subs.sub_P = mkSub('sub_P', PRO);
    const ev = mkEvent('checkout.session.completed', mkSession('sub_P'));
    const [r1, r2] = await Promise.all([post(ev), post(ev)]);
    assert.deepEqual([r1.status, r2.status].sort(), [200, 409]);
    assert.equal(mails.length, 1);
    const r3 = await post(ev); // Stripe の再送
    assert.equal(r3.body.skipped, 'already processed');
    assert.equal(mails.length, 1);
  });

  await t('メールを送ったあとに落ちた再送では、二重に送らず続きから完了する', async () => {
    subs.sub_R = mkSub('sub_R', PRO);
    store['yukyuponEvents/evt_retry'] = { startedAt: 'x', mailedAt: 'y', leaseUntil: 0 };
    const r = await post(mkEvent('checkout.session.completed', mkSession('sub_R'), { id: 'evt_retry' }));
    assert.equal(r.status, 200);
    assert.equal(mails.length, 0);
    assert.ok(store['yukyuponEvents/evt_retry'].doneAt);
  });

  await t('メールが送れなかったら運営者に知らせて500を返し、Stripe の再送で届ける', async () => {
    subs.sub_M = mkSub('sub_M', PRO);
    failMailOnce = true;
    const ev = mkEvent('checkout.session.completed', mkSession('sub_M', { email: 'm@example.com' }));
    const r1 = await post(ev);
    assert.equal(r1.status, 500);
    assert.equal(mails.length, 1);
    assert.equal(mails[0].to, 'studio@kokokikaku.com');
    assert.match(mails[0].subject, /要対応/);
    mails.length = 0;
    const r2 = await post(ev); // Stripe の再送（実行中の印は外れているので、すぐ処理できる）
    assert.equal(r2.status, 200);
    assert.equal(mails.length, 1);
    assert.equal(mails[0].to, 'm@example.com');
  });

  await t('SMTP 未設定（mailerReady=false）: 契約は記録して 500。設定してから再送すると届く', async () => {
    smtpHost = '';
    subs.sub_SM = mkSub('sub_SM', PRO);
    const ev = mkEvent('checkout.session.completed', mkSession('sub_SM'));
    try {
      assert.equal((await post(ev)).status, 500);
      assert.equal(mails.length, 0);
      assert.equal(lic('sub_SM').status, 'active');
    } finally {
      smtpHost = 'smtp.example';
    }
    assert.equal((await post(ev)).status, 200);
    assert.equal(mails.length, 1);
  });

  await t('Stripe の照会に失敗（権限不足）したら 500。直してから再送すると続きから発行する', async () => {
    subs.sub_F = mkSub('sub_F', PRO);
    const ev = mkEvent('checkout.session.completed', mkSession('sub_F'));
    subRetrieveError = stripeError('StripePermissionError', 'The provided key does not have the required permissions for this endpoint', { statusCode: 403 });
    try {
      assert.equal((await post(ev)).status, 500);
    } finally {
      subRetrieveError = null;
    }
    assert.equal(lic('sub_F'), undefined);
    assert.equal(store[`yukyuponEvents/${ev.id}`].doneAt, undefined);
    assert.equal(store[`yukyuponEvents/${ev.id}`].leaseUntil, 0);
    assert.equal((await post(ev)).status, 200);
    assert.equal(mails.length, 1);
    assert.equal(lic('sub_F').limit, 30);
  });

  await t('送信済みの印（mailedAt）を書けずに落ちたら 500。再送ではもう一度送る（届かないより二重の方がよい）', async () => {
    subs.sub_W = mkSub('sub_W', PRO);
    const ev = mkEvent('checkout.session.completed', mkSession('sub_W'));
    setFailures.push((k, v) => k === `yukyuponEvents/${ev.id}` && 'mailedAt' in v);
    assert.equal((await post(ev)).status, 500);
    assert.equal(mails.length, 1);
    assert.equal((await post(ev)).status, 200);
    assert.equal(mails.length, 2);
    assert.equal(keyIn(mails[0].text).split('.')[0], keyIn(mails[1].text).split('.')[0]); // 同じ内容のキー
  });

  // ---------------- 契約の変更 ----------------
  await t('subscription.updated でメールアドレスが消えない（null で上書きしない）', async () => {
    await post(mkEvent('customer.subscription.updated', subs.sub_A, { prev: { metadata: {} } }));
    assert.equal(lic('sub_A').email, 'a@example.com');
    assert.equal(lic('sub_A').stripeCheckedAt, null); // Webhook の写しは「照会済み」にしない
  });

  await t('Pro → ビジネスに変えたら、差額の請求でビジネスのキーが届き、キーの取り直しでも人数無制限（ライセンスIDは同じ）', async () => {
    const before = licenseDocs().length;
    const old = subs.sub_A;
    subs.sub_A = mkSub('sub_A', BIZ, { start: old.items.data[0].current_period_start, end: old.items.data[0].current_period_end });
    await post(mkEvent('customer.subscription.updated', subs.sub_A, { prev: { items: old.items, plan: null } }));
    assert.equal(lic('sub_A').limit, null);
    assert.equal(lic('sub_A').plan, 'ビジネス');
    const r1 = await post(mkEvent('invoice.paid', mkInvoice('sub_A', BIZ, { reason: 'subscription_update', email: 'a@example.com', amount: 500 })));
    assert.equal(r1.status, 200);
    assert.equal(mails.length, 1);
    assert.match(mails[0].subject, /ビジネスプランを更新しました/);
    assert.equal(payloadOf(keyIn(mails[0].text)).n, undefined);
    assert.equal(licenseDocs().length, before);
    const r = await getKey(sign.licenseIdFor('sub_A'), { origin: 'https://yukyu.kokokikaku.com' });
    assert.equal(r.status, 200);
    assert.equal(payloadOf(r.body.key).n, undefined);
    assert.equal(payloadOf(r.body.key).id, sign.licenseIdFor('sub_A'));
    assert.equal(r.headers['Access-Control-Allow-Origin'], 'https://yukyu.kokokikaku.com');
    assert.equal(r.headers['Cache-Control'], 'no-store');
  });

  await t('ビジネス → Pro に戻したら、キーの取り直しで30人上限に戻る', async () => {
    subs.sub_DN = mkSub('sub_DN', BIZ);
    await post(mkEvent('checkout.session.completed', mkSession('sub_DN')));
    const old = subs.sub_DN;
    subs.sub_DN = mkSub('sub_DN', PRO);
    await post(mkEvent('customer.subscription.updated', subs.sub_DN, { prev: { items: old.items } })); // 変更の通知で「照会済み」が外れる
    const r = await getKey(sign.licenseIdFor('sub_DN'));
    assert.equal(calls.subRetrieve, 2); // チェックアウトの1回 + キー更新で Stripe に照会
    assert.equal(payloadOf(r.body.key).n, 30);
    assert.equal(lic('sub_DN').limit, 30);
  });

  await t('期間末の解約（cancel_at_period_end）を受け付けた時点で「解約を承りました」が1回だけ届く', async () => {
    const s = { ...subs.sub_A, cancel_at_period_end: true, canceled_at: now };
    await post(mkEvent('customer.subscription.updated', s, { prev: { cancel_at_period_end: false, canceled_at: null } }));
    assert.equal(mails.length, 1);
    assert.equal(mails[0].to, 'a@example.com');
    assert.match(mails[0].subject, /解約を承りました/);
    assert.match(mails[0].text, new RegExp(`${B.jstDate(s.items.data[0].current_period_end)} までは`));
    assert.match(mails[0].text, /無料プラン（在籍5人まで）/);
    mails.length = 0;
    await post(mkEvent('customer.subscription.updated', s, { prev: { metadata: {} } }));
    assert.equal(mails.length, 0);
  });

  await t('日付指定の解約（cancel_at。flexible billing のポータルもこちら）: 指定日を知らせ、キーもその日+3日まで', async () => {
    await buy('sub_CA', PRO, { email: 'ca@example.com' });
    reset();
    const at = now + 10 * DAY;
    subs.sub_CA = { ...subs.sub_CA, cancel_at: at };
    await post(mkEvent('customer.subscription.updated', subs.sub_CA, { prev: { cancel_at: null } }));
    assert.equal(mails.length, 1);
    assert.match(mails[0].text, new RegExp(`${B.jstDate(at)} までは`));
    assert.equal(lic('sub_CA').entitledUntil, isoDay(at + 3 * DAY));
    const r = await getKey(sign.licenseIdFor('sub_CA'));
    assert.equal(payloadOf(r.body.key).e, isoDay(at + 3 * DAY));
  });

  await t('解約予約の取り消し（cancel_at → null、cancel_at_period_end → false）ではメールを送らず、期限は元に戻る', async () => {
    const at = subs.sub_CA.cancel_at;
    subs.sub_CA = { ...subs.sub_CA, cancel_at: null };
    await post(mkEvent('customer.subscription.updated', subs.sub_CA, { prev: { cancel_at: at } }));
    await post(mkEvent('customer.subscription.updated', { ...subs.sub_A, cancel_at_period_end: false }, { prev: { cancel_at_period_end: true } }));
    assert.equal(mails.length, 0);
    assert.equal(lic('sub_CA').entitledUntil, isoDay(subs.sub_CA.items.data[0].current_period_end + 3 * DAY));
  });

  await t('契約が終わったら「終了しました」が届き、猶予が過ぎると 410', async () => {
    const ended = now - 10 * DAY;
    subs.sub_A = { ...subs.sub_A, status: 'canceled', ended_at: ended, canceled_at: ended };
    await post(mkEvent('customer.subscription.deleted', subs.sub_A));
    assert.equal(mails.length, 1);
    assert.equal(mails[0].to, 'a@example.com');
    assert.match(mails[0].subject, /終了しました/);
    assert.equal(lic('sub_A').status, 'canceled');
    const r = await getKey(sign.licenseIdFor('sub_A'));
    assert.equal(r.status, 410);
    assert.equal(r.body.entitledUntil, isoDay(ended + 3 * DAY));
  });

  await t('解約の後に、順番が前後した古い subscription.updated が届いても「契約中」に戻さない', async () => {
    const stale = { ...subs.sub_A, status: 'active', ended_at: null };
    const r = await post(mkEvent('customer.subscription.updated', stale, { prev: { cancel_at_period_end: false } }));
    assert.equal(r.body.skipped, 'stale (already ended)');
    assert.equal(lic('sub_A').status, 'canceled');
    assert.equal(mails.length, 0);
  });

  await t('subscription.deleted で契約の記録が無い: 200 で記録だけ残し、メールは送らない', async () => {
    const s = mkSub('sub_GONE', PRO, { status: 'canceled', ended_at: now - DAY });
    const r = await post(mkEvent('customer.subscription.deleted', s));
    assert.equal(r.status, 200);
    assert.equal(mails.length, 0);
    assert.equal(lic('sub_GONE').status, 'canceled');
    assert.equal(lic('sub_GONE').subscriptionId, 'sub_GONE');
  });

  // ---------------- 更新の請求 ----------------
  await t('初回の invoice.paid（subscription_create）はチェックアウトと二重に送らない', async () => {
    subs.sub_C = mkSub('sub_C', PRO);
    await post(mkEvent('checkout.session.completed', mkSession('sub_C', { email: 'c@example.com' })));
    const r = await post(mkEvent('invoice.paid', mkInvoice('sub_C', PRO, { reason: 'subscription_create', email: 'c@example.com' })));
    assert.equal(r.body.skipped, 'initial invoice (handled by checkout)');
    assert.equal(mails.length, 1);
    assert.match(mails[0].subject, /ライセンスキーをお送りします/);
  });

  await t('更新（2回目以降の請求）でキーの控えを送る', async () => {
    subs.sub_C = mkSub('sub_C', PRO, { start: now, end: now + 30 * DAY });
    const r = await post(mkEvent('invoice.paid', mkInvoice('sub_C', PRO, { email: 'c@example.com' })));
    assert.equal(r.status, 200);
    assert.equal(mails.length, 1);
    assert.match(mails[0].subject, /Proプランを更新しました/);
    assert.match(mails[0].text, new RegExp(`このキー自体の有効期限: ${plusDays(30)}`));
    assert.doesNotMatch(mails[0].text, /\*\*/);
  });

  await t('古い形の請求書（invoice.subscription・明細の price.product）でも更新できる', async () => {
    const r = await post(mkEvent('invoice.paid', mkInvoice('sub_C', PRO, { legacy: true, email: 'c@example.com' })));
    assert.equal(r.status, 200);
    assert.equal(mails.length, 1);
  });

  await t('invoice.paid に customer_email が無い: Firestore のメール → 顧客の照会の順に補う／顧客が削除済みなら運営者へ', async () => {
    await post(mkEvent('invoice.paid', mkInvoice('sub_C', PRO, { email: null })));
    assert.equal(mails[0].to, 'c@example.com'); // 購入時に記録したもの
    assert.equal(calls.custRetrieve, 0);
    reset();
    subs.sub_NC = mkSub('sub_NC', PRO);
    customers.cus_sub_NC = { id: 'cus_sub_NC', object: 'customer', email: 'nc@example.com' };
    await post(mkEvent('invoice.paid', mkInvoice('sub_NC', PRO, { email: null })));
    assert.equal(calls.custRetrieve, 1);
    assert.equal(mails[0].to, 'nc@example.com');
    reset();
    subs.sub_DEL = mkSub('sub_DEL', PRO);
    customers.cus_sub_DEL = { id: 'cus_sub_DEL', object: 'customer', deleted: true };
    const r = await post(mkEvent('invoice.paid', mkInvoice('sub_DEL', PRO, { email: null })));
    assert.equal(r.status, 200);
    assert.equal(mails.length, 1);
    assert.equal(mails[0].to, 'studio@kokokikaku.com');
    assert.match(mails[0].subject, /要対応/);
  });

  // ---------------- ほかの製品 ----------------
  await t('ほかの製品（全銀ポン・MiseFits）のイベントは完全に無視する（キー・メール・記録なし、照会も最小限）', async () => {
    const beforeLic = licenseDocs().length;
    for (const product of [ZENGINPON, MISEFITS]) {
      const id = `sub_O_${product}`;
      subs[id] = mkSub(id, product);
      const beforeEv = eventDocs().length;
      reset();
      // チェックアウトは商品を知るために1回だけ照会する
      assert.equal((await post(mkEvent('checkout.session.completed', mkSession(id)))).body.skipped, 'other product');
      assert.equal(calls.subRetrieve, 1);
      // 請求書は明細の商品で判断し、照会しない（新旧どちらの形でも）
      assert.equal((await post(mkEvent('invoice.paid', mkInvoice(id, product)))).body.skipped, 'other product');
      assert.equal((await post(mkEvent('invoice.paid', mkInvoice(id, product, { legacy: true })))).body.skipped, 'other product');
      assert.equal((await post(mkEvent('customer.subscription.updated', subs[id], { prev: { cancel_at_period_end: false } }))).body.skipped, 'other product');
      assert.equal((await post(mkEvent('customer.subscription.deleted', { ...subs[id], status: 'canceled', ended_at: now }))).body.skipped, 'other product');
      assert.equal(calls.subRetrieve, 1);
      assert.equal(eventDocs().length, beforeEv + 1); // チェックアウトの分だけ（処理済みの印）
      assert.equal(mails.length, 0);
    }
    assert.equal(licenseDocs().length, beforeLic);
  });

  await t('MiseFits の買い切り（mode=payment）・ほかの種類のイベントは素通り', async () => {
    const r = await post(mkEvent('checkout.session.completed', mkSession(null, { mode: 'payment' })));
    assert.equal(r.body.skipped, 'not a subscription');
    const r2 = await post(mkEvent('invoice.payment_failed', mkInvoice('sub_C', PRO)));
    assert.equal(r2.body.skipped, 'unhandled type');
    const r3 = await post(mkEvent('invoice.paid', { ...mkInvoice('x', PRO), parent: null, lines: { object: 'list', data: [], has_more: false } }));
    assert.equal(r3.body.skipped, 'no subscription');
    assert.equal(mails.length, 0);
  });

  await t('片方のプランの商品IDだけ空: そのプランの契約は処理せず、もう片方は処理する', async () => {
    PLANS.pro.productId = '';
    try {
      subs.sub_HP = mkSub('sub_HP', PRO);
      assert.equal((await post(mkEvent('checkout.session.completed', mkSession('sub_HP')))).body.skipped, 'other product');
      assert.equal(lic('sub_HP'), undefined);
      await buy('sub_HB', BIZ);
      assert.equal(mails.length, 1);
      assert.equal(lic('sub_HB').plan, 'ビジネス');
    } finally {
      PLANS.pro.productId = PRO;
    }
  });

  // ---------------- キー更新エンドポイント ----------------
  await t('キー更新: 不正なIDは400、未登録は404、OPTIONS は 204、GET 以外は 405、他サイトには CORS を許可しない', async () => {
    assert.equal((await getKey('ab')).status, 400);
    assert.equal((await getKey('a/b..c')).status, 400);
    assert.equal((await getKey('unknown123')).status, 404);
    const o = await getKey('unknown123', { method: 'OPTIONS', origin: 'https://yukyu.kokokikaku.com' });
    assert.equal(o.status, 204);
    assert.equal(o.headers['Access-Control-Allow-Methods'], 'GET');
    assert.equal(o.headers['Access-Control-Allow-Origin'], 'https://yukyu.kokokikaku.com');
    assert.equal((await getKey(sign.licenseIdFor('sub_C'), { method: 'POST' })).status, 405);
    const r = await getKey(sign.licenseIdFor('sub_C'), { origin: 'https://evil.example' });
    assert.equal(r.status, 200);
    assert.equal(r.headers['Access-Control-Allow-Origin'], undefined);
    assert.equal(payloadOf(r.body.key).n, 30);
    assert.equal(r.body.expiry, plusDays(30));
    assert.equal(r.body.status, 'active');
  });

  /** 契約を Firestore に用意し、Stripe 側の状態を差し替えてキー更新を呼ぶ */
  const withStatus = async (name, o) => {
    const id = `sub_ST_${name}`;
    subs[id] = mkSub(id, PRO);
    await post(mkEvent('checkout.session.completed', mkSession(id)));
    store[`yukyuponLicenses/${sign.licenseIdFor(id)}`].stripeCheckedAt = null; // 照会させる
    subs[id] = mkSub(id, PRO, o);
    return getKey(sign.licenseIdFor(id));
  };

  await t('キー更新: active・trialing は延長、past_due は期間の初日+30日まで（+猶予）', async () => {
    assert.equal((await withStatus('active', {})).status, 200);
    assert.equal((await withStatus('trialing', { status: 'trialing' })).status, 200);
    const pd = await withStatus('pdue', { status: 'past_due', start: now - 5 * DAY, end: now + 360 * DAY });
    assert.equal(pd.status, 200);
    assert.equal(pd.body.expiry, isoDay(now - 5 * DAY + 33 * DAY)); // 年払いでも1年は延ばさない
    const pdOld = await withStatus('pdue_old', { status: 'past_due', start: now - 40 * DAY, end: now + 325 * DAY });
    assert.equal(pdOld.status, 410);
  });

  await t('キー更新: unpaid・paused は支払い済みの期間（今の期間の初日+猶予）まで、incomplete・incomplete_expired・canceled は 410', async () => {
    assert.equal((await withStatus('unpaid', { status: 'unpaid', start: now - 10 * DAY })).status, 410);
    const recent = await withStatus('unpaid_recent', { status: 'unpaid', start: now - DAY });
    assert.equal(recent.status, 200);
    assert.equal(recent.body.expiry, isoDay(now - DAY + 3 * DAY));
    assert.equal((await withStatus('paused', { status: 'paused', start: now - 10 * DAY })).status, 410);
    assert.equal((await withStatus('incomplete', { status: 'incomplete' })).status, 410);
    assert.equal((await withStatus('incomplete_expired', { status: 'incomplete_expired' })).status, 410);
    assert.equal((await withStatus('canceled', { status: 'canceled', ended_at: now - 5 * DAY })).status, 410);
    const justEnded = await withStatus('canceled_now', { status: 'canceled', ended_at: now });
    assert.equal(justEnded.status, 200); // 即時解約（返金）でも猶予の3日は使える
    assert.equal(justEnded.body.expiry, isoDay(now + 3 * DAY));
  });

  await t('キー更新: Stripe の照会に失敗したら Firestore の値で判定（期限内なら延長。人数上限の記録が無ければ Pro の30人）', async () => {
    const id = sign.licenseIdFor('sub_C');
    store[`yukyuponLicenses/${id}`].stripeCheckedAt = null;
    subRetrieveError = stripeError('StripeConnectionError', 'An error occurred with our connection to Stripe');
    try {
      const r = await getKey(id);
      assert.equal(r.status, 200);
      assert.equal(payloadOf(r.body.key).n, 30);
      const biz = sign.licenseIdFor('sub_Y');
      store[`yukyuponLicenses/${biz}`].stripeCheckedAt = null;
      assert.equal(payloadOf((await getKey(biz)).body.key).n, undefined); // ビジネスの記録（limit: null）は無制限のまま
      store['yukyuponLicenses/nolimit01'] = { subscriptionId: 'sub_C', status: 'active', entitledUntil: plusDays(20) };
      const r2 = await getKey('nolimit01');
      assert.equal(r2.status, 200);
      assert.equal(payloadOf(r2.body.key).n, 30);
      assert.equal(r2.body.expiry, plusDays(20));
    } finally {
      subRetrieveError = null;
    }
  });

  await t('キー更新: Stripe に照会できず Firestore の期限が過ぎている → 503（キーを消させない）。解約を Webhook で受け取っていれば 410', async () => {
    store['yukyuponLicenses/stalekey01'] = { subscriptionId: 'sub_C', status: 'active', limit: 30, entitledUntil: plusDays(-1) };
    store['yukyuponLicenses/canceled01'] = { subscriptionId: 'sub_C', status: 'canceled', limit: 30, entitledUntil: plusDays(-1) };
    subRetrieveError = stripeError('StripeAPIError', 'Internal server error', { statusCode: 500 });
    try {
      const r = await getKey('stalekey01');
      assert.equal(r.status, 503);
      assert.equal(r.headers['Retry-After'], '3600');
      assert.equal((await getKey('canceled01')).status, 410);
    } finally {
      subRetrieveError = null;
    }
    // 照会できるようになれば、Stripe の状態（契約中）で延長する
    const r2 = await getKey('stalekey01');
    assert.equal(r2.status, 200);
  });

  await t('キー更新の連打: 10分以内に Stripe で確かめていれば照会しない。Webhook で状態が変わったら次は照会する', async () => {
    const id = sign.licenseIdFor('sub_C');
    store[`yukyuponLicenses/${id}`].stripeCheckedAt = null;
    reset();
    for (let i = 0; i < 5; i++) assert.equal((await getKey(id)).status, 200);
    assert.equal(calls.subRetrieve, 1);
    await post(mkEvent('customer.subscription.updated', subs.sub_C, { prev: { metadata: {} } }));
    await getKey(id);
    assert.equal(calls.subRetrieve, 2);
  });

  await t('キー更新: Firestore への書き込みに失敗しても、Stripe で確かめた結果でキーを返す', async () => {
    const id = sign.licenseIdFor('sub_C');
    store[`yukyuponLicenses/${id}`].stripeCheckedAt = null;
    setFailures.push((k) => k === `yukyuponLicenses/${id}`);
    const r = await getKey(id);
    assert.equal(r.status, 200);
    assert.equal(setFailures.length, 0);
  });

  // ---------------- 判定の単体 ----------------
  await t('entitledUntilOf: 新旧の形・状態ごとの最終日', async () => {
    const s = (o) => mkSub('sub_U', PRO, { start: now, end: now + 30 * DAY, ...o });
    assert.equal(B.entitledUntilOf(s({})), isoDay(now + 33 * DAY));
    assert.equal(B.entitledUntilOf(s({ legacy: true })), isoDay(now + 33 * DAY));
    assert.equal(B.entitledUntilOf(s({ cancel_at: now + 5 * DAY })), isoDay(now + 8 * DAY));
    assert.equal(B.entitledUntilOf(s({ cancel_at: now + 90 * DAY })), isoDay(now + 33 * DAY)); // 期間より先の指定日は期間末で区切る（次の請求で延びる）
    assert.equal(B.entitledUntilOf(s({ status: 'canceled', ended_at: now + DAY })), isoDay(now + 4 * DAY));
    assert.equal(B.entitledUntilOf(s({ status: 'incomplete' })), null);
    assert.equal(B.entitledUntilOf(s({ status: 'incomplete_expired' })), null);
    assert.equal(B.entitledUntilOf(s({ status: 'unpaid' })), isoDay(now + 3 * DAY));
  });

  await t('sign.js: ライセンスIDは契約ごとに固定の12文字、cappedExpiry は min(期間末+猶予, 今日+上限)', async () => {
    assert.equal(sign.licenseIdFor('sub_A'), sign.licenseIdFor('sub_A'));
    assert.notEqual(sign.licenseIdFor('sub_A'), sign.licenseIdFor('sub_B'));
    assert.match(sign.licenseIdFor('sub_1TestABC'), /^[A-Za-z0-9_-]{12}$/);
    assert.equal(sign.cappedExpiry(now + 100 * DAY, 3, 30), plusDays(30));
    assert.equal(sign.cappedExpiry(now + 2 * DAY, 3, 30), plusDays(5));
    assert.equal(B.keyExpiry(plusDays(400)), plusDays(30));
    assert.equal(B.keyExpiry(plusDays(4)), plusDays(4));
  });

  await t('関数の設定: 東京リージョン、インスタンス数の上限、必要なシークレット', async () => {
    const w = fns.yukyuponStripeWebhook.opts;
    const l = fns.yukyuponLicense.opts;
    assert.equal(w.region, 'asia-northeast1');
    assert.equal(l.region, 'asia-northeast1');
    assert.ok(w.maxInstances > 0 && l.maxInstances > 0);
    assert.equal(l.cors, false);
    assert.equal(w.secrets.length, 6);
    assert.equal(l.secrets.length, 2);
  });

  console.log(`\n${passed} tests passed`);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
