// node functions/test/functions.test.js — Webhook とキー更新の全経路を、Stripe・Firestore・メールを差し替えて確かめる
// （functions の npm install は不要。外部モジュールはすべて差し替える）
'use strict';
const assert = require('node:assert/strict');
const path = require('node:path');
const crypto = require('node:crypto');
const Module = require('node:module');

const FN = path.join(__dirname, '..');
const PRO = 'prod_TEST_PRO';
const BIZ = 'prod_TEST_BIZ';
const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');
const PEM = privateKey.export({ type: 'pkcs8', format: 'pem' });

// ---- 差し替え ----
const store = {}; // Firestore の代わり（コレクション/ID → 値）
const mails = [];
let subs = {};
let customers = {};
let failMailOnce = false;
const docRef = (col, id) => {
  const k = `${col}/${id}`;
  return {
    async set(v, o) {
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
const fakes = {
  'firebase-functions/v2/https': { onRequest: (_opts, fn) => fn },
  'firebase-functions/params': {
    defineSecret: (n) => ({ value: () => (n === 'YP_LICENSE_PRIVATE_KEY' ? PEM : n === 'MAIL_FROM' ? 'MiseFits <studio@kokokikaku.com>' : 'x') }),
    defineString: (n, o) => ({ value: () => (n === 'SMTP_HOST' ? 'smtp.example' : (o && o.default) || '') }),
  },
  'firebase-admin/app': { initializeApp() {}, getApps: () => [1] },
  'firebase-admin/firestore': { getFirestore: () => ({ collection: (col) => ({ doc: (id) => docRef(col, id) }) }) },
  stripe: function Stripe() {
    return {
      webhooks: { constructEvent: (body) => JSON.parse(body) },
      subscriptions: { retrieve: async (id) => { if (!subs[id]) throw new Error('no sub ' + id); return subs[id]; } },
      customers: { retrieve: async (id) => customers[id] },
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
const origLoad = Module._load;
Module._load = function (req, ...rest) {
  return fakes[req] || origLoad.call(this, req, ...rest);
};
const fns = require(path.join(FN, 'index.js'));
Module._load = origLoad;

const now = Math.floor(Date.now() / 1000);
const mkSub = (id, product, extra = {}) => ({
  id,
  customer: 'cus_' + id,
  status: 'active',
  items: { data: [{ current_period_end: now + 30 * 86400, price: { product, recurring: { interval: 'month' } } }] },
  ...extra,
});
let evSeq = 0;
async function post(event) {
  let status = 200, body;
  const res = { status(s) { status = s; return this; }, json(b) { body = b; return this; }, send(b) { body = b; return this; } };
  await fns.yukyuponStripeWebhook({ rawBody: JSON.stringify({ id: event.id || `evt_${++evSeq}`, ...event }), headers: {} }, res);
  return { status, body };
}
async function getKey(id, origin) {
  let status = 200, body;
  const headers = {};
  const res = { status(s) { status = s; return this; }, json(b) { body = b; return this; }, send(b) { body = b; return this; }, set(k, v) { headers[k] = v; } };
  await fns.yukyuponLicense({ method: 'GET', query: { id }, headers: origin ? { origin } : {} }, res);
  return { status, body, headers };
}
function payloadOf(key) {
  const m = key.match(/^YP1-([^.]+)\.(.+)$/);
  const body = Buffer.from(m[1], 'base64url');
  assert.ok(crypto.verify(null, body, publicKey, Buffer.from(m[2], 'base64url')), '署名が正しい');
  return JSON.parse(body.toString());
}
const licenseDocs = () => Object.keys(store).filter((k) => k.startsWith('yukyuponLicenses/'));

(async () => {
  let passed = 0;
  const t = async (name, fn) => {
    await fn();
    passed++;
    console.log('ok -', name);
  };

  await t('商品IDが未設定なら何もしない（共用アカウントで全部通さない）', async () => {
    subs.sub_X = mkSub('sub_X', 'prod_ANY');
    const r = await post({ type: 'checkout.session.completed', data: { object: { mode: 'subscription', subscription: 'sub_X', customer_details: { email: 'x@example.com' } } } });
    assert.equal(r.body.skipped, 'not configured');
    assert.equal(mails.length, 0);
  });

  PLANS.pro.productId = PRO;
  PLANS.business.productId = BIZ;

  await t('Pro の新規購入で30人上限のキーを発行してメールを送る', async () => {
    subs.sub_A = mkSub('sub_A', PRO);
    const r = await post({ id: 'evt_new_A', type: 'checkout.session.completed', data: { object: { mode: 'subscription', subscription: 'sub_A', customer_details: { email: 'a@example.com' } } } });
    assert.equal(r.status, 200);
    assert.equal(mails.length, 1);
    const key = mails[0].text.match(/YP1-\S+/)[0];
    const p = payloadOf(key);
    assert.equal(p.n, 30);
    assert.equal(p.p, 'pro');
    assert.doesNotMatch(mails[0].text, /\*\*/); // プレーンテキスト
    assert.match(mails[0].text, /https:\/\/yukyu\.kokokikaku\.com\/#pro/);
    assert.match(mails[0].text, /billing\.stripe\.com\/p\/login\//);
    assert.match(mails[0].subject, /Proプラン/);
    assert.deepEqual(mails[0].from, { name: '有休ポン（ここ企画）', address: 'studio@kokokikaku.com' });
  });

  await t('同じイベントが二重に届いても、メールは1通だけ', async () => {
    mails.length = 0;
    const r = await post({ id: 'evt_new_A', type: 'checkout.session.completed', data: { object: { mode: 'subscription', subscription: 'sub_A', customer_details: { email: 'a@example.com' } } } });
    assert.equal(r.body.skipped, 'already processed');
    assert.equal(mails.length, 0);
  });

  await t('メールを送ったあとに落ちた再送では、二重に送らず続きから完了する', async () => {
    mails.length = 0;
    subs.sub_R = mkSub('sub_R', PRO);
    // 1回目: メール送信済み・完了印の前に落ちた状態を作る
    store['yukyuponEvents/evt_retry'] = { startedAt: 'x', mailedAt: 'y' };
    const r = await post({ id: 'evt_retry', type: 'checkout.session.completed', data: { object: { mode: 'subscription', subscription: 'sub_R', customer_details: { email: 'r@example.com' } } } });
    assert.equal(r.status, 200);
    assert.equal(mails.length, 0);
    assert.ok(store['yukyuponEvents/evt_retry'].doneAt);
  });

  await t('メールが送れなかったら運営者に知らせて500を返し、Stripe の再送で届ける', async () => {
    mails.length = 0;
    subs.sub_M = mkSub('sub_M', PRO);
    failMailOnce = true;
    const ev = { id: 'evt_mailfail', type: 'checkout.session.completed', data: { object: { mode: 'subscription', subscription: 'sub_M', customer_details: { email: 'm@example.com' } } } };
    const r1 = await post(ev);
    assert.equal(r1.status, 500);
    assert.equal(mails.length, 1);
    assert.equal(mails[0].to, 'studio@kokokikaku.com');
    assert.match(mails[0].subject, /要対応/);
    mails.length = 0;
    const r2 = await post(ev); // Stripe の再送
    assert.equal(r2.status, 200);
    assert.equal(mails.length, 1);
    assert.equal(mails[0].to, 'm@example.com');
  });

  await t('subscription.updated でメールアドレスが消えない', async () => {
    const k = 'yukyuponLicenses/' + Object.keys(store).find((x) => x.startsWith('yukyuponLicenses/') && store[x].subscriptionId === 'sub_A').split('/')[1];
    await post({ type: 'customer.subscription.updated', data: { object: { ...subs.sub_A } } });
    assert.equal(store[k].email, 'a@example.com');
  });

  await t('Pro → ビジネスに変えたら、キーの取り直しで人数無制限になる（ライセンスIDは同じ）', async () => {
    const before = licenseDocs().length;
    subs.sub_A = mkSub('sub_A', BIZ);
    await post({ type: 'customer.subscription.updated', data: { object: subs.sub_A } });
    assert.equal(licenseDocs().length, before);
    const id = licenseDocs().find((k) => store[k].subscriptionId === 'sub_A').split('/')[1];
    const r = await getKey(id, 'https://yukyu.kokokikaku.com');
    assert.equal(r.status, 200);
    assert.equal(payloadOf(r.body.key).n, undefined);
    assert.equal(r.headers['Access-Control-Allow-Origin'], 'https://yukyu.kokokikaku.com');
  });

  await t('解約の手続きをした時点で「解約を承りました」が1回だけ届く', async () => {
    mails.length = 0;
    await post({ type: 'customer.subscription.updated', data: { object: { ...subs.sub_A, cancel_at_period_end: true }, previous_attributes: { cancel_at_period_end: false } } });
    assert.equal(mails.length, 1);
    assert.match(mails[0].subject, /解約を承りました/);
    assert.match(mails[0].text, /\d{4}年\d{1,2}月\d{1,2}日 までは/);
    mails.length = 0;
    await post({ type: 'customer.subscription.updated', data: { object: { ...subs.sub_A, cancel_at_period_end: true }, previous_attributes: { metadata: {} } } });
    assert.equal(mails.length, 0);
  });

  await t('契約が終わったら「終了しました」が届き、猶予が過ぎると 410', async () => {
    mails.length = 0;
    const ended = now - 10 * 86400;
    subs.sub_A = { ...mkSub('sub_A', BIZ), status: 'canceled', ended_at: ended };
    await post({ type: 'customer.subscription.deleted', data: { object: subs.sub_A } });
    assert.equal(mails.length, 1);
    assert.equal(mails[0].to, 'a@example.com');
    assert.match(mails[0].subject, /終了しました/);
    const id = licenseDocs().find((k) => store[k].subscriptionId === 'sub_A').split('/')[1];
    const r = await getKey(id);
    assert.equal(r.status, 410);
  });

  await t('更新（2回目以降の請求）でキーの控えを送る。初回の invoice.paid は送らない', async () => {
    mails.length = 0;
    subs.sub_C = mkSub('sub_C', PRO);
    await post({ type: 'checkout.session.completed', data: { object: { mode: 'subscription', subscription: 'sub_C', customer_details: { email: 'c@example.com' } } } });
    mails.length = 0;
    await post({ type: 'invoice.paid', data: { object: { billing_reason: 'subscription_create', subscription: 'sub_C' } } });
    assert.equal(mails.length, 0);
    const r = await post({ type: 'invoice.paid', data: { object: { billing_reason: 'subscription_cycle', customer_email: 'c@example.com', parent: { subscription_details: { subscription: 'sub_C' } } } } });
    assert.equal(r.status, 200);
    assert.equal(mails.length, 1);
    assert.match(mails[0].subject, /更新/);
  });

  await t('ほかの商品（全銀ポン・MiseFits）の契約にはキーを出さない', async () => {
    mails.length = 0;
    const before = licenseDocs().length;
    subs.sub_B = mkSub('sub_B', 'prod_ZENGINPON');
    await post({ type: 'checkout.session.completed', data: { object: { mode: 'subscription', subscription: 'sub_B', customer_details: { email: 'b@example.com' } } } });
    await post({ type: 'invoice.paid', data: { object: { billing_reason: 'subscription_cycle', subscription: 'sub_B' } } });
    await post({ type: 'customer.subscription.updated', data: { object: subs.sub_B } });
    await post({ type: 'customer.subscription.deleted', data: { object: subs.sub_B } });
    assert.equal(mails.length, 0);
    assert.equal(licenseDocs().length, before);
  });

  await t('買い切り（mode=payment）は素通り', async () => {
    const r = await post({ type: 'checkout.session.completed', data: { object: { mode: 'payment' } } });
    assert.equal(r.body.skipped, 'not a subscription');
  });

  await t('キー更新: 不正なIDは400、未登録は404、他サイトには CORS を許可しない', async () => {
    assert.equal((await getKey('ab')).status, 400);
    assert.equal((await getKey('unknown123')).status, 404);
    const id = licenseDocs().find((k) => store[k].subscriptionId === 'sub_C').split('/')[1];
    const r = await getKey(id, 'https://evil.example');
    assert.equal(r.status, 200);
    assert.equal(r.headers['Access-Control-Allow-Origin'], undefined);
    assert.equal(payloadOf(r.body.key).n, 30);
  });

  console.log(`\n${passed} tests passed`);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
