/*
 * 有休ポン Pro / ビジネス のライセンス発行API（Stripe Webhook + キー更新エンドポイント）
 * 全銀ポン（studio8080/zengin-pon の functions/）と同じ設計。違いはプランが2つあることと、二重配信・同時到着への備え。
 * 判定とメールの文面は billing.js（外部モジュールなし。テストと tools/preflight.mjs からも読む）。
 *
 * 方針:
 *   月払いも年払いも Stripe のサブスクリプション（自動更新）。
 *   キーはオフラインで検証できる署名付きトークンなので、寿命を短く（最長30日）して、
 *   ブラウザが定期的に取り直す。取り直すたびに Stripe の契約状態を見に行くので、
 *     - 契約中        → 期限を延ばして返す（プランを変えていれば人数上限も新しいものになる）
 *     - 解約・未払い  → 410。ブラウザは保存済みのキーを削除して無料プランに戻る
 *     - 期間末で解約  → 期間の末日＋猶予までは延ばすが、それ以上は延ばさない
 *     - Stripe に照会できず、手元の記録でも判断できない → 503（ブラウザは何もしない。キーを消さない）
 *
 * 置き場所:
 *   Firebase プロジェクト "misefits" に codebase "yukyupon" として相乗りする（全銀ポンと同じ）。
 *   codebase を分けているので、ここから deploy しても MiseFits・全銀ポンの関数は消えない。
 *   デプロイは必ず --only functions:yukyupon を付ける。
 *
 * Stripe アカウントは MiseFits・MenuFits・全銀ポンと共用。**有休ポンの商品の契約にだけ**キーを出す。
 * 商品IDが空のあいだは何もしない（全部通すのではなく、止める）。
 *
 * 必要なシークレット（Secret Manager）:
 *   STRIPE_SECRET_KEY         … 共用の制限付きキー。Subscriptions・Customers の読み取りが必須
 *   YP_STRIPE_WEBHOOK_SECRET  … この Webhook 送信先専用（Stripe が発行する whsec_...）
 *   YP_LICENSE_PRIVATE_KEY    … ~/.yukyu-pon/license-private.pem の中身そのまま
 *   SMTP_USER / MAIL_FROM / SMTP_PASS … 共用
 * 通常パラメータ（functions/.env）: SMTP_HOST / SMTP_PORT
 */
const { onRequest } = require('firebase-functions/v2/https');
const { defineSecret, defineString } = require('firebase-functions/params');
const { initializeApp, getApps } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const Stripe = require('stripe');
const nodemailer = require('nodemailer');
const { licenseIdFor, signKey } = require('./sign');
const B = require('./billing');

if (!getApps().length) initializeApp();
const db = getFirestore();

const stripeSecretKey = defineSecret('STRIPE_SECRET_KEY');
const ypWebhookSecret = defineSecret('YP_STRIPE_WEBHOOK_SECRET');
const ypPrivateKey = defineSecret('YP_LICENSE_PRIVATE_KEY');
const smtpUser = defineSecret('SMTP_USER');
const mailFrom = defineSecret('MAIL_FROM');
const smtpPass = defineSecret('SMTP_PASS');
const smtpHost = defineString('SMTP_HOST', { default: '' });
const smtpPort = defineString('SMTP_PORT', { default: '465' });

const COLLECTION = 'yukyuponLicenses';
const EVENTS = 'yukyuponEvents';
const HANDLED = ['checkout.session.completed', 'invoice.paid', 'customer.subscription.updated', 'customer.subscription.deleted'];
const LEASE_SECONDS = 120; // 同じイベントを同時に処理しない（関数のタイムアウト60秒より長く）
const RECHECK_SECONDS = 600; // キー更新で、この間に Stripe で確かめていれば照会を省く（連打で共用の Stripe の上限を使わない）
const { PLANS } = B;

const licenseRef = (id) => db.collection(COLLECTION).doc(id);
async function readLicense(id) {
  const snap = await licenseRef(id).get();
  return snap.exists ? snap.data() || {} : null;
}

// ------------------------------------------------------------
// メール（プレーンテキスト。Markdown を書かない。文面は billing.js）
// ------------------------------------------------------------
function mailerReady() {
  return !!(smtpHost.value() && smtpUser.value() && mailFrom.value() && smtpPass.value());
}
const operatorAddress = () => B.fromHeader(mailFrom.value()).address;

async function sendMail(to, subject, text) {
  if (!mailerReady()) {
    console.error('SMTP 未設定のためメールを送れません（運営者が手動で送ること）:', to, subject);
    return false;
  }
  const transport = nodemailer.createTransport({
    host: smtpHost.value(),
    port: Number(smtpPort.value()),
    secure: Number(smtpPort.value()) === 465,
    auth: { user: smtpUser.value(), pass: smtpPass.value() },
  });
  const from = B.fromHeader(mailFrom.value());
  try {
    await transport.sendMail({ from, to, subject, text });
    return true;
  } catch (e) {
    console.error('メール送信に失敗', to, subject, e.message);
    // 送れなかったことを運営者に知らせる（これも失敗したらログだけ）
    try {
      await transport.sendMail({ from, to: from.address, subject: `【要対応】有休ポンのメールを送れませんでした: ${subject}`, text: `宛先: ${to}\n件名: ${subject}\nエラー: ${e.message}\n\n本文:\n${text}` });
    } catch (e2) {
      console.error('運営者への通知にも失敗', e2.message);
    }
    return false;
  }
}

/**
 * 購入者のメールアドレス。分かっている値（イベント・Firestore）を先に使い、無ければ Stripe の顧客を見る。
 * 顧客が削除済み・存在しないなら null。権限不足など、それ以外の失敗は投げて 500 にし、Stripe に再送させる
 * （2026-10-02 の全銀ポンの障害: 制限付きキーに読み取り権限が無かった。黙って null にすると気づけない）。
 */
async function emailOf(stripe, sub, ...known) {
  for (const k of known) if (k) return k;
  const cid = B.customerIdOf(sub);
  if (!cid) return null;
  let customer;
  try {
    customer = await stripe.customers.retrieve(cid);
  } catch (e) {
    if (e && (e.code === 'resource_missing' || e.statusCode === 404)) return null;
    throw e;
  }
  return (customer && !customer.deleted && customer.email) || null;
}

/**
 * 契約状態を Firestore に保存する。分かっている値（メールなど）を null で上書きしない。
 * live = Stripe に今照会した値か（Webhook の中身はその時点の写しで、順番が前後して届くことがある）。
 */
async function saveState(sub, plan, email, live) {
  const id = licenseIdFor(sub.id);
  const entitledUntil = B.entitledUntilOf(sub);
  const now = new Date().toISOString();
  await licenseRef(id).set(
    {
      ...(email ? { email } : {}),
      ...(B.customerIdOf(sub) ? { customerId: B.customerIdOf(sub) } : {}),
      subscriptionId: sub.id,
      status: sub.status || 'active',
      ...(plan ? { plan: plan.name, limit: plan.limit } : {}),
      entitledUntil,
      stripeCheckedAt: live ? now : null,
      updatedAt: now,
    },
    { merge: true },
  );
  return { id, entitledUntil };
}

function makeKey(entitledUntil, id, plan) {
  const expiry = B.keyExpiry(entitledUntil);
  return { key: signKey(ypPrivateKey.value(), expiry, id, plan.limit), expiry };
}

/**
 * Webhook の二重配信・同時到着・途中で落ちた再送への備え。
 * イベントIDで先に枠を取る（create）。もう完了していれば何もしない。ほかの処理が実行中（leaseUntil 内）なら 409 で後から再送させる。
 * 途中で落ちていた（done でない）なら続きから。メールは送ったら印を付け、再送で二重に送らない。
 */
async function claimEvent(eventId, type) {
  const ref = db.collection(EVENTS).doc(eventId);
  const now = Date.now();
  try {
    await ref.create({ type, startedAt: new Date(now).toISOString(), leaseUntil: now + LEASE_SECONDS * 1000 });
    return { ref, done: false, busy: false, mailed: false };
  } catch (e) {
    if (e.code !== 6 && e.code !== 'already-exists' && !/ALREADY_EXISTS/.test(String(e.message))) throw e;
    const snap = await ref.get();
    const d = (snap.exists && snap.data()) || {};
    if (d.doneAt) return { ref, done: true };
    if (d.leaseUntil && d.leaseUntil > now) return { ref, busy: true };
    await ref.set({ leaseUntil: now + LEASE_SECONDS * 1000, retriedAt: new Date(now).toISOString() }, { merge: true });
    return { ref, done: false, busy: false, mailed: !!d.mailedAt };
  }
}

// ------------------------------------------------------------
// Stripe Webhook
// ------------------------------------------------------------
exports.yukyuponStripeWebhook = onRequest(
  { secrets: [stripeSecretKey, ypWebhookSecret, ypPrivateKey, smtpUser, mailFrom, smtpPass], region: B.REGION, maxInstances: 5, timeoutSeconds: 60 },
  async (req, res) => {
    const stripe = new Stripe(stripeSecretKey.value());
    let event;
    try {
      event = stripe.webhooks.constructEvent(req.rawBody, req.headers['stripe-signature'], ypWebhookSecret.value());
    } catch (e) {
      console.error('署名検証に失敗', e.message);
      res.status(400).send(`Webhook Error: ${e.message}`);
      return;
    }
    if (!PLANS.pro.productId && !PLANS.business.productId) {
      console.error('有休ポンの商品IDが未設定のため処理しません');
      res.json({ received: true, skipped: 'not configured' });
      return;
    }
    // 共用アカウントのほかの製品（全銀ポン・MiseFits）のイベントは、Firestore にも Stripe にも触らずに返す
    const obj = event.data && event.data.object;
    if (!HANDLED.includes(event.type)) return void res.json({ received: true, skipped: 'unhandled type' });
    if (event.type.startsWith('customer.subscription.') && !B.planOf(obj)) return void res.json({ received: true, skipped: 'other product' });
    if (event.type === 'invoice.paid' && B.isOtherProductInvoice(obj)) return void res.json({ received: true, skipped: 'other product' });

    let claim = null;
    try {
      claim = await claimEvent(event.id, event.type);
      if (claim.done) return void res.json({ received: true, skipped: 'already processed' });
      if (claim.busy) return void res.status(409).json({ error: 'in progress' });
      // 送れなかったら 500 を返して Stripe に再送させる（Stripe は最長3日再送し、失敗が続くと運営者にも知らせる）
      const mailOnce = async (to, subject, text) => {
        if (!to || claim.mailed) return;
        if (!(await sendMail(to, subject, text))) throw new Error(`メールを送れませんでした: ${subject}`);
        claim.mailed = true;
        await claim.ref.set({ mailedAt: new Date().toISOString() }, { merge: true });
      };
      const notifyOperator = (subject, what, fields, key) => mailOnce(operatorAddress(), `【要対応】有休ポン: ${subject}`, B.operatorMail(what, fields, key));
      const finish = async (body) => {
        await claim.ref.set({ doneAt: new Date().toISOString(), leaseUntil: 0 }, { merge: true });
        res.json({ received: true, ...body });
      };

      if (event.type === 'checkout.session.completed') {
        const session = obj;
        const subId = typeof session.subscription === 'string' ? session.subscription : session.subscription && session.subscription.id;
        if (session.mode !== 'subscription' || !subId) return finish({ skipped: 'not a subscription' });
        const sub = await stripe.subscriptions.retrieve(subId);
        const plan = B.planOf(sub);
        if (!plan) return finish({ skipped: 'other product' });
        const email = await emailOf(stripe, sub, session.customer_details && session.customer_details.email, session.customer_email);
        const { id, entitledUntil } = await saveState(sub, plan, email, true);
        const fields = { ライセンスID: id, 契約: sub.id, 顧客: B.customerIdOf(sub), 状態: sub.status, プラン: plan.name, イベント: event.id };
        if (!entitledUntil || entitledUntil < B.todayIso()) {
          await notifyOperator('申し込みの契約が有効になっていません', '申し込みは完了しましたが、契約が支払い済みの状態ではないため、キーを送っていません。', fields);
          return finish({ skipped: 'not entitled' });
        }
        const { key, expiry } = makeKey(entitledUntil, id, plan);
        if (email) await mailOnce(email, `【有休ポン】${plan.name}プランのライセンスキーをお送りします`, B.welcomeMail(key, id, plan, B.intervalOf(sub)));
        else await notifyOperator('キーを送れませんでした（メールアドレスが分かりません）', '購入者のメールアドレスが分からないため、キーを送れませんでした。顧客のメールアドレスを確かめて、下のキーを送ってください。', fields, key);
        console.log('新規発行', id, plan.name, expiry);
        return finish({});
      }

      if (event.type === 'invoice.paid') {
        const invoice = obj;
        const subId = B.subscriptionIdOfInvoice(invoice);
        if (!subId) return finish({ skipped: 'no subscription' });
        // 初回はチェックアウト完了でキーを送るので、ここでは送らない（二重に送らない）
        if (invoice.billing_reason === 'subscription_create') return finish({ skipped: 'initial invoice (handled by checkout)' });
        const sub = await stripe.subscriptions.retrieve(subId);
        const plan = B.planOf(sub);
        if (!plan) return finish({ skipped: 'other product' });
        const stored = await readLicense(licenseIdFor(sub.id));
        const email = await emailOf(stripe, sub, invoice.customer_email, stored && stored.email);
        const { id, entitledUntil } = await saveState(sub, plan, email, true);
        if (!entitledUntil || entitledUntil < B.todayIso()) return finish({ skipped: 'not entitled' });
        const { key, expiry } = makeKey(entitledUntil, id, plan);
        if (email) await mailOnce(email, `【有休ポン】${plan.name}プランを更新しました`, B.renewalMail(key, expiry, id, plan, B.intervalOf(sub)));
        else
          await notifyOperator(
            '更新のキーの控えを送れませんでした（メールアドレスが分かりません）',
            '更新の支払いを確認しましたが、購入者のメールアドレスが分かりません（キーはブラウザで自動更新されるので、急ぎではありません）。',
            { ライセンスID: id, 契約: sub.id, 顧客: B.customerIdOf(sub), イベント: event.id },
            key,
          );
        console.log('更新発行', id, plan.name, expiry);
        return finish({});
      }

      if (event.type === 'customer.subscription.deleted') {
        const sub = obj;
        const plan = B.planOf(sub);
        const id = licenseIdFor(sub.id);
        const stored = await readLicense(id);
        const { entitledUntil } = await saveState({ ...sub, status: sub.status || 'canceled' }, plan, null, false);
        if (stored && stored.email) await mailOnce(stored.email, '【有休ポン】有料プランのご契約が終了しました', B.canceledMail());
        else console.warn('契約の記録（メールアドレス）が無い解約。終了のメールは送っていません', id, sub.id);
        console.log('解約', id, entitledUntil);
        return finish({});
      }

      // customer.subscription.updated
      const sub = obj;
      const plan = B.planOf(sub);
      const id = licenseIdFor(sub.id);
      const stored = await readLicense(id);
      // 解約済みの記録を、順番が前後して届いた古い写しで「契約中」に戻さない（解約した契約は再開できない）
      if (stored && B.TERMINAL.includes(stored.status) && !B.TERMINAL.includes(sub.status)) return finish({ skipped: 'stale (already ended)' });
      await saveState(sub, plan, null, false);
      // 解約の予約（期間の末日や指定日で終わる）を受け付けた瞬間に、いつまで使えるかを知らせる
      const prev = (event.data && event.data.previous_attributes) || {};
      const nowScheduled = !!(sub.cancel_at_period_end || sub.cancel_at);
      const wasScheduled = 'cancel_at_period_end' in prev || 'cancel_at' in prev ? !!(prev.cancel_at_period_end || prev.cancel_at) : nowScheduled;
      if (nowScheduled && !wasScheduled && sub.status !== 'canceled') {
        const end = sub.cancel_at || B.periodEndOf(sub);
        if (end) await mailOnce(stored && stored.email, '【有休ポン】有料プランの解約を承りました', B.cancelScheduledMail(B.jstDate(end)));
      }
      console.log('状態更新', id, plan.name, sub.status, nowScheduled ? '解約予約あり' : '');
      return finish({});
    } catch (e) {
      console.error('処理に失敗', e);
      // すぐに再送できるように、実行中の印を外す（外せなくても LEASE_SECONDS で切れる）
      if (claim && claim.ref) await claim.ref.set({ leaseUntil: 0, lastError: String(e && e.message) }, { merge: true }).catch(() => {});
      res.status(500).send('internal error');
    }
  },
);

// ------------------------------------------------------------
// キー更新エンドポイント（ブラウザが定期的に叩く）
//   GET ?id=<ライセンスID>
//     200 { key, expiry }  … 契約中（プランを変えていれば新しい人数上限のキー）
//     410 { error }        … Stripe で解約・期限切れを確かめた（ブラウザは保存済みキーを消す）
//     503 { error }        … Stripe に照会できず、手元の記録でも判断できない（ブラウザは何もしない）
//     404                  … 自動発行の記録が無い（手動発行のキー）
//   送られてくるのはライセンスIDだけ。従業員のデータは一切扱わない。
// ------------------------------------------------------------
exports.yukyuponLicense = onRequest({ secrets: [stripeSecretKey, ypPrivateKey], region: B.REGION, cors: false, maxInstances: 10, timeoutSeconds: 30 }, async (req, res) => {
  const origin = req.headers.origin;
  if (origin && B.ALLOWED_ORIGINS.includes(origin)) {
    res.set('Access-Control-Allow-Origin', origin);
    res.set('Vary', 'Origin');
  }
  if (req.method === 'OPTIONS') {
    res.set('Access-Control-Allow-Methods', 'GET');
    res.status(204).send('');
    return;
  }
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'method not allowed' });
    return;
  }
  const id = String(req.query.id || '');
  if (!/^[A-Za-z0-9_-]{6,32}$/.test(id)) {
    res.status(400).json({ error: 'bad id' });
    return;
  }
  res.set('Cache-Control', 'no-store');

  try {
    const d = await readLicense(id);
    if (!d) {
      res.status(404).json({ error: 'not found' });
      return;
    }
    const today = B.todayIso();
    let entitledUntil = d.entitledUntil || null;
    let limit = d.limit === undefined ? PLANS.pro.limit : d.limit; // 分からなければ狭い方（Pro）
    let status = d.status || null;
    // Stripe で確かめた状態か。Webhook（Stripe の署名付き）で解約を受け取っていれば確定
    let confirmed = B.TERMINAL.includes(status);
    const fresh = !!d.stripeCheckedAt && Date.now() - Date.parse(d.stripeCheckedAt) < RECHECK_SECONDS * 1000;

    if (fresh) {
      confirmed = true;
    } else {
      // Stripe に現在の契約状態を直接確認する（Webhook の取りこぼしがあっても正しく判定できる）
      let sub = null;
      try {
        sub = await new Stripe(stripeSecretKey.value()).subscriptions.retrieve(d.subscriptionId);
      } catch (e) {
        console.error('Stripe 参照に失敗、Firestore の値で判定します', id, e.message);
      }
      if (sub) {
        const plan = B.planOf(sub);
        if (plan) limit = plan.limit;
        entitledUntil = B.entitledUntilOf(sub);
        status = sub.status;
        confirmed = true;
        const now = new Date().toISOString();
        await licenseRef(id)
          .set({ status, entitledUntil, limit, ...(plan ? { plan: plan.name } : {}), stripeCheckedAt: now, updatedAt: now }, { merge: true })
          .catch((e) => console.error('Firestore への保存に失敗（応答は続ける）', id, e.message));
      }
    }

    if (!entitledUntil || entitledUntil < today) {
      if (confirmed) {
        res.status(410).json({ error: 'not entitled', entitledUntil: entitledUntil || null });
      } else {
        // 解約を確かめられないうちはキーを消させない（ブラウザは手元のキーの期限まで使い、次に開いたときに取り直す）
        res.set('Retry-After', '3600');
        res.status(503).json({ error: 'temporarily unavailable' });
      }
      return;
    }
    const expiry = B.keyExpiry(entitledUntil);
    res.json({ key: signKey(ypPrivateKey.value(), expiry, id, limit), expiry, status });
  } catch (e) {
    console.error('更新に失敗', e);
    res.status(500).json({ error: 'internal error' });
  }
});
