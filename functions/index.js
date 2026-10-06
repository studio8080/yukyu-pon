/*
 * 有休ポン Pro / ビジネス のライセンス発行API（Stripe Webhook + キー更新エンドポイント）
 * 全銀ポン（studio8080/zengin-pon の functions/）と同じ設計。違いはプランが2つあることと、二重配信への備え。
 *
 * 方針:
 *   月払いも年払いも Stripe のサブスクリプション（自動更新）。
 *   キーはオフラインで検証できる署名付きトークンなので、寿命を短く（最長30日）して、
 *   ブラウザが定期的に取り直す。取り直すたびに Stripe の契約状態を見に行くので、
 *     - 契約中        → 期限を延ばして返す（プランを変えていれば人数上限も新しいものになる）
 *     - 解約・未払い  → 410。ブラウザは保存済みのキーを削除して無料プランに戻る
 *     - 期間末で解約  → 期間の末日＋猶予までは延ばすが、それ以上は延ばさない
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
const { licenseIdFor, signKey, expiryFromUnix, daysFromToday, cappedExpiry } = require('./sign');

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

const SITE = 'https://yukyu.kokokikaku.com';
const COLLECTION = 'yukyuponLicenses';
const EVENTS = 'yukyuponEvents';
const GRACE_DAYS = 3; // 契約期間の末日を過ぎても数日は使える（更新の行き違い対策）
const MAX_OFFLINE_DAYS = 30; // キーの最長寿命
const ACTIVE = ['active', 'trialing', 'past_due']; // past_due は Stripe が再請求中なので使わせる
const ALLOWED_ORIGINS = [SITE, 'http://localhost:5191', 'http://localhost:5192'];

const { PLANS } = require('./plans');
// Stripe カスタマーポータルのログインリンク（アカウント共通。全銀ポンと同じもの）
const PORTAL_URL = 'https://billing.stripe.com/p/login/cNi7sEb0eg2g7HtcOv9R600';

/** 契約の商品からプランを決める。有休ポンの商品でなければ null */
function planOf(subscription) {
  const items = (subscription.items && subscription.items.data) || [];
  for (const it of items) {
    const p = it.price && it.price.product;
    const pid = typeof p === 'string' ? p : p && p.id;
    if (!pid) continue;
    for (const plan of Object.values(PLANS)) if (plan.productId && plan.productId === pid) return plan;
  }
  return null;
}

// ------------------------------------------------------------
// メール（プレーンテキスト。Markdown を書かない）
// ------------------------------------------------------------
function mailerReady() {
  return !!(smtpHost.value() && smtpUser.value() && mailFrom.value() && smtpPass.value());
}

// MAIL_FROM は MiseFits と共用（「MiseFits <studio@…>」）。アドレスだけ使い、表示名は有休ポンにする。
const SENDER_NAME = '有休ポン（ここ企画）';
function fromHeader(raw) {
  const s = String(raw || '').trim();
  const m = s.match(/<([^<>\s]+@[^<>\s]+)>/);
  return { name: SENDER_NAME, address: m ? m[1] : s };
}

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
  const from = fromHeader(mailFrom.value());
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

const planLine = (plan, interval) => `${plan.name}プラン（${interval === 'year' ? '年払い' : '月払い'}・${plan.limit ? `在籍${plan.limit}人まで` : '人数無制限'}）`;

function welcomeMail(key, id, plan, interval) {
  return `このたびは有休ポン ${planLine(plan, interval)} をお申し込みいただき、ありがとうございます。
ライセンスキーをお送りします。

────────────────────────────
${key}
────────────────────────────

【使い方】
1. 次のリンクを開くと、キーの入力画面が開きます
   ${SITE}/#pro
   （開かないときは、${SITE}/ の「設定」→「料金プラン」を開いてください）
2. 上のキーを貼り付けて「有効にする」を押す

これで在籍${plan.limit ? `${plan.limit}人` : '人数の制限なく'}まで管理できるようになります。
キーはブラウザの中で確かめるだけで、従業員のデータが送られることはありません。

【キーの有効期限について】
キーには短い有効期限が入っていますが、ご契約が続いているかぎり、有休ポンを開いたときに
自動で更新されます（貼り直しの必要はありません）。ご契約は自動更新のため、
解約のお手続きをされない限り、そのままお使いいただけます。
うまく更新されないときは、このメールのキーを貼り直すと復帰できます。保管をお願いします。

【解約・プランの変更について】
次のページから、ご登録のメールアドレスでいつでも解約・プランの変更ができます（このメールへのご返信でも承ります）。
${PORTAL_URL}
解約後は、お支払い済みの期間の末日までご利用いただけます。

ご不明な点がありましたら、このメールにご返信ください。
※ 従業員の名簿やバックアップのファイルはお送りにならないでください。

--
有休ポン（ここ企画）
${SITE}/
（ライセンスID: ${id}）`;
}

function renewalMail(key, expiry, id, plan, interval) {
  return `有休ポン ${planLine(plan, interval)} のお支払いを確認しました。ありがとうございます。

有休ポンを開いていればキーは自動で更新されますので、通常この作業は不要です。
念のため、新しいキーの控えをお送りします。

────────────────────────────
${key}
────────────────────────────

（このキー自体の有効期限: ${expiry}。ご契約中は自動で延長されます）

--
有休ポン（ここ企画）
${SITE}/
（ライセンスID: ${id}）`;
}

/** Unix秒 → 日本時間の「2026年11月2日」 */
function jstDate(unix) {
  const d = new Date((Number(unix) + 9 * 3600) * 1000);
  return `${d.getUTCFullYear()}年${d.getUTCMonth() + 1}月${d.getUTCDate()}日`;
}

function cancelScheduledMail(endDate) {
  return `有休ポンの有料プランの解約を承りました。

${endDate} までは、これまでどおりご利用いただけます。
その後は自動的に無料プラン（在籍5人まで）に戻ります。お手続きは不要です。
入力したデータはブラウザに残り、閲覧・管理簿の出力・バックアップはそのまま使えます。
期間中であれば、契約の管理ページから解約を取り消すこともできます。
${PORTAL_URL}

またのご利用をお待ちしています。ご不便な点がありましたら、
このメールにご返信いただけると今後の改善に役立ちます。

--
有休ポン（ここ企画）
${SITE}/`;
}

function canceledMail() {
  return `有休ポンの有料プランのご契約が終了しました。これまでのご利用ありがとうございました。

無料プラン（在籍5人まで）は、これまでどおりお使いいただけます。
入力したデータはブラウザに残り、閲覧・管理簿の出力・バックアップはそのまま使えます。

またのご利用をお待ちしています。

--
有休ポン（ここ企画）
${SITE}/`;
}

// ------------------------------------------------------------
// 共通処理
// ------------------------------------------------------------
function periodEndOf(subscription) {
  return subscription.current_period_end || (subscription.items && subscription.items.data[0] && subscription.items.data[0].current_period_end);
}

function intervalOf(subscription) {
  const item = subscription.items && subscription.items.data[0];
  return (item && item.price && item.price.recurring && item.price.recurring.interval) || 'month';
}

async function emailOf(stripe, subscription, fallback) {
  if (fallback) return fallback;
  try {
    const customer = await stripe.customers.retrieve(subscription.customer);
    return (customer && !customer.deleted && customer.email) || null;
  } catch (e) {
    console.error('顧客のメール取得に失敗', e.message);
    return null;
  }
}

/** 契約状態を Firestore に保存する。分かっている値（メールなど）を null で上書きしない */
async function saveState(subscription, plan, email) {
  const id = licenseIdFor(subscription.id);
  const periodEnd = periodEndOf(subscription);
  if (!periodEnd) throw new Error(`current_period_end が取れません: ${subscription.id}`);
  await db.collection(COLLECTION).doc(id).set(
    {
      ...(email ? { email } : {}),
      ...(subscription.customer ? { customerId: subscription.customer } : {}),
      subscriptionId: subscription.id,
      status: subscription.status || 'active',
      plan: plan.name,
      limit: plan.limit,
      entitledUntil: expiryFromUnix(periodEnd, GRACE_DAYS),
      updatedAt: new Date().toISOString(),
    },
    { merge: true },
  );
  return { id, periodEnd };
}

function makeKey(periodEndUnix, id, plan) {
  const expiry = cappedExpiry(periodEndUnix, GRACE_DAYS, MAX_OFFLINE_DAYS);
  return { key: signKey(ypPrivateKey.value(), expiry, id, plan.limit), expiry };
}

/**
 * Webhook の二重配信・途中で落ちた再送への備え。
 * イベントIDで先に枠を取る（create）。もう完了していれば何もしない。
 * 途中で落ちていた（done でない）なら続きから。メールは送ったら印を付け、再送で二重に送らない。
 */
async function claimEvent(eventId) {
  const ref = db.collection(EVENTS).doc(eventId);
  try {
    await ref.create({ startedAt: new Date().toISOString() });
    return { ref, done: false, mailed: false };
  } catch (e) {
    if (e.code !== 6 && e.code !== 'already-exists' && !/ALREADY_EXISTS/.test(String(e.message))) throw e;
    const snap = await ref.get();
    const d = (snap.exists && snap.data()) || {};
    return { ref, done: !!d.doneAt, mailed: !!d.mailedAt };
  }
}

// ------------------------------------------------------------
// Stripe Webhook
// ------------------------------------------------------------
exports.yukyuponStripeWebhook = onRequest(
  { secrets: [stripeSecretKey, ypWebhookSecret, ypPrivateKey, smtpUser, mailFrom, smtpPass], region: 'asia-northeast1' },
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

    try {
      const claim = await claimEvent(event.id);
      if (claim.done) {
        res.json({ received: true, skipped: 'already processed' });
        return;
      }
      // 送れなかったら 500 を返して Stripe に再送させる（Stripe は最長3日再送し、失敗が続くと運営者にも知らせる）
      const mailOnce = async (to, subject, text) => {
        if (!to || claim.mailed) return;
        if (!(await sendMail(to, subject, text))) throw new Error(`メールを送れませんでした: ${subject}`);
        await claim.ref.set({ mailedAt: new Date().toISOString() }, { merge: true });
      };
      const finish = async (body) => {
        await claim.ref.set({ type: event.type, doneAt: new Date().toISOString() }, { merge: true });
        res.json({ received: true, ...body });
      };

      if (event.type === 'checkout.session.completed') {
        const session = event.data.object;
        if (session.mode !== 'subscription' || !session.subscription) return finish({ skipped: 'not a subscription' });
        const sub = await stripe.subscriptions.retrieve(session.subscription);
        const plan = planOf(sub);
        if (!plan) return finish({ skipped: 'other product' });
        const email = await emailOf(stripe, sub, session.customer_details && session.customer_details.email);
        const { id, periodEnd } = await saveState(sub, plan, email);
        const { key, expiry } = makeKey(periodEnd, id, plan);
        await mailOnce(email, `【有休ポン】${plan.name}プランのライセンスキーをお送りします`, welcomeMail(key, id, plan, intervalOf(sub)));
        if (!email) console.error('メールアドレスが分からないためキーを送れません（手動で送ること）', id);
        console.log('新規発行', id, plan.name, expiry);
        return finish({});
      }

      if (event.type === 'invoice.paid') {
        const invoice = event.data.object;
        const subId = invoice.subscription || (invoice.parent && invoice.parent.subscription_details && invoice.parent.subscription_details.subscription);
        if (!subId) return finish({ skipped: 'no subscription' });
        if (invoice.billing_reason === 'subscription_create') return finish({ skipped: 'initial invoice (handled by checkout)' });
        const sub = await stripe.subscriptions.retrieve(subId);
        const plan = planOf(sub);
        if (!plan) return finish({ skipped: 'other product' });
        const email = await emailOf(stripe, sub, invoice.customer_email);
        const { id, periodEnd } = await saveState(sub, plan, email);
        const { key, expiry } = makeKey(periodEnd, id, plan);
        await mailOnce(email, `【有休ポン】${plan.name}プランを更新しました`, renewalMail(key, expiry, id, plan, intervalOf(sub)));
        console.log('更新発行', id, plan.name, expiry);
        return finish({});
      }

      if (event.type === 'customer.subscription.deleted') {
        const sub = event.data.object;
        if (!planOf(sub)) return finish({ skipped: 'other product' });
        const id = licenseIdFor(sub.id);
        const end = sub.ended_at || periodEndOf(sub);
        const entitledUntil = expiryFromUnix(end, GRACE_DAYS);
        await db.collection(COLLECTION).doc(id).set({ status: sub.status || 'canceled', entitledUntil, updatedAt: new Date().toISOString() }, { merge: true });
        const snap = await db.collection(COLLECTION).doc(id).get();
        await mailOnce(snap.exists && snap.data().email, '【有休ポン】有料プランのご契約が終了しました', canceledMail());
        console.log('解約', id, entitledUntil);
        return finish({});
      }

      if (event.type === 'customer.subscription.updated') {
        const sub = event.data.object;
        const plan = planOf(sub);
        if (!plan) return finish({ skipped: 'other product' });
        await saveState(sub, plan, null);
        // 解約の予約（期間の末日で終わる）を受け付けた瞬間に、いつまで使えるかを知らせる
        const prev = (event.data && event.data.previous_attributes) || {};
        const nowScheduled = !!(sub.cancel_at_period_end || sub.cancel_at);
        const wasScheduled = 'cancel_at_period_end' in prev || 'cancel_at' in prev ? !!(prev.cancel_at_period_end || prev.cancel_at) : nowScheduled;
        if (nowScheduled && !wasScheduled) {
          const snap = await db.collection(COLLECTION).doc(licenseIdFor(sub.id)).get();
          const end = sub.cancel_at || periodEndOf(sub);
          if (end) await mailOnce(snap.exists && snap.data().email, '【有休ポン】有料プランの解約を承りました', cancelScheduledMail(jstDate(end)));
        }
        console.log('状態更新', licenseIdFor(sub.id), plan.name, sub.status, nowScheduled ? '解約予約あり' : '');
        return finish({});
      }

      return finish({ skipped: 'unhandled type' });
    } catch (e) {
      console.error('処理に失敗', e);
      res.status(500).send('internal error');
    }
  },
);

// ------------------------------------------------------------
// キー更新エンドポイント（ブラウザが定期的に叩く）
//   GET ?id=<ライセンスID>
//     200 { key, expiry }  … 契約中（プランを変えていれば新しい人数上限のキー）
//     410 { error }        … 解約済み・期限切れ（ブラウザは保存済みキーを消す）
//   送られてくるのはライセンスIDだけ。従業員のデータは一切扱わない。
// ------------------------------------------------------------
exports.yukyuponLicense = onRequest({ secrets: [stripeSecretKey, ypPrivateKey], region: 'asia-northeast1', cors: false }, async (req, res) => {
  const origin = req.headers.origin;
  if (origin && ALLOWED_ORIGINS.includes(origin)) {
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
    const snap = await db.collection(COLLECTION).doc(id).get();
    if (!snap.exists) {
      res.status(404).json({ error: 'not found' });
      return;
    }
    const d = snap.data();
    const today = new Date().toISOString().slice(0, 10);

    // Stripe に現在の契約状態を直接確認する（Webhook の取りこぼしがあっても正しく判定できる）
    let sub = null;
    try {
      const stripe = new Stripe(stripeSecretKey.value());
      sub = await stripe.subscriptions.retrieve(d.subscriptionId);
    } catch (e) {
      console.error('Stripe 参照に失敗、Firestore の値で判定します', e.message);
    }

    let entitledUntil = d.entitledUntil || null;
    let limit = d.limit === undefined ? 30 : d.limit; // 分からなければ狭い方（Pro）
    if (sub) {
      const plan = planOf(sub);
      if (plan) limit = plan.limit;
      const periodEnd = periodEndOf(sub);
      if (!ACTIVE.includes(sub.status)) {
        const end = sub.ended_at || periodEnd;
        entitledUntil = end ? expiryFromUnix(end, GRACE_DAYS) : today;
      } else if (periodEnd) {
        entitledUntil = expiryFromUnix(periodEnd, GRACE_DAYS);
      }
      await db.collection(COLLECTION).doc(id).set({ status: sub.status, entitledUntil, limit, updatedAt: new Date().toISOString() }, { merge: true });
    }

    if (!entitledUntil || entitledUntil < today) {
      res.status(410).json({ error: 'not entitled', entitledUntil: entitledUntil || null });
      return;
    }
    const soft = daysFromToday(MAX_OFFLINE_DAYS);
    const expiry = entitledUntil < soft ? entitledUntil : soft;
    res.json({ key: signKey(ypPrivateKey.value(), expiry, id, limit), expiry, status: sub ? sub.status : d.status || null });
  } catch (e) {
    console.error('更新に失敗', e);
    res.status(500).json({ error: 'internal error' });
  }
});
