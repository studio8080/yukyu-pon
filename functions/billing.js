/*
 * billing.js — 契約の判定とメールの文面（外部モジュールを使わない純粋な処理）
 * index.js（Cloud Functions）・test/functions.test.js・tools/preflight.mjs から使う。
 *
 * Stripe の形の違いに備える:
 *   - API 2025-03-31.basil 以降、契約期間（current_period_start / end）はサブスクリプション直下から
 *     items.data[] に移った。Webhook（2026-08-26.dahlia）も SDK の照会（stripe-node 18.5 = 2025-08-27.basil）も items 側。
 *     古い形（直下）でも動くように両方を見る。
 *   - 請求書の subscription は basil 以降 parent.subscription_details.subscription。古い形は invoice.subscription。
 *   - 請求書の明細の商品は basil 以降 lines.data[].pricing.price_details.product。古い形は lines.data[].price.product。
 *   - 期間末の解約は cancel_at_period_end のほか、flexible billing では cancel_at（日時）で表されることがある。
 */
const { PLANS } = require('./plans');
const { expiryFromUnix, daysFromToday } = require('./sign');

const SITE = 'https://yukyu.kokokikaku.com';
const ALLOWED_ORIGINS = [SITE, 'http://localhost:5191', 'http://localhost:5192'];
// Stripe カスタマーポータルのログインリンク（有休ポン専用の構成 bpc_1UQl1d3C6tqke0fyU5cML6J2、2026-10-15 有効化）。
// 全銀ポンのリンク（デフォルトの構成）を使うと、プランの切り替え先に有休ポンの価格が出ない。
const PORTAL_URL = 'https://billing.stripe.com/p/login/bJecMY2tI5nC0f1dSz9R601';
const SENDER_NAME = '有休ポン（ここ企画）';
const REGION = 'asia-northeast1';

const GRACE_DAYS = 3; // 契約期間の末日を過ぎても数日は使える（更新の行き違い対策）
const MAX_OFFLINE_DAYS = 30; // キーの最長寿命
// 再請求中（past_due）でも使わせる上限。今の期間の初日から数える。
// Stripe 側は「再試行がすべて失敗したらキャンセル」（launch-checklist 3-5）なので通常はそちらで終わる。設定が変わったときの保険。
const PAST_DUE_DAYS = 30;
// 状態が「もう戻らない」もの。Webhook（Stripe の署名付き）でこれを受け取っていれば、Stripe に照会できなくても失効させてよい
const TERMINAL = ['canceled', 'incomplete_expired'];

const idOf = (v) => (typeof v === 'string' ? v : v && v.id) || null;
const firstItem = (sub) => (sub && sub.items && Array.isArray(sub.items.data) && sub.items.data[0]) || null;

/** 契約の商品からプランを決める。有休ポンの商品でなければ null（商品IDが空のプランには当てはめない） */
function planOf(subscription) {
  const items = (subscription && subscription.items && subscription.items.data) || [];
  for (const it of items) {
    const pid = idOf(it.price && it.price.product) || idOf(it.plan && it.plan.product);
    if (!pid) continue;
    for (const plan of Object.values(PLANS)) if (plan.productId && plan.productId === pid) return plan;
  }
  return null;
}

/** 契約期間の末日（Unix秒）。新しい形は items.data[].current_period_end、古い形は直下 */
function periodEndOf(sub) {
  const it = firstItem(sub);
  return (it && it.current_period_end) || sub.current_period_end || null;
}

/** 契約期間の初日（Unix秒） */
function periodStartOf(sub) {
  const it = firstItem(sub);
  return (it && it.current_period_start) || sub.current_period_start || null;
}

function intervalOf(sub) {
  const it = firstItem(sub);
  return (it && it.price && it.price.recurring && it.price.recurring.interval) || 'month';
}

const customerIdOf = (sub) => idOf(sub && sub.customer);

/** 請求書の契約ID（新旧どちらの形でも） */
function subscriptionIdOfInvoice(invoice) {
  const parent = invoice && invoice.parent;
  return idOf(invoice && invoice.subscription) || idOf(parent && parent.subscription_details && parent.subscription_details.subscription) || null;
}

/**
 * 請求書の明細の商品ID。明細が全部そろっていて全部読めたときだけ配列を返す（分からなければ null = 照会して確かめる）。
 * ほかの製品（全銀ポン・MiseFits）の請求書に Stripe の照会をしないため。
 */
function invoiceProductIds(invoice) {
  const lines = invoice && invoice.lines;
  if (!lines || !Array.isArray(lines.data) || !lines.data.length || lines.has_more) return null;
  const ids = [];
  for (const l of lines.data) {
    const pd = l.pricing && l.pricing.price_details;
    const pid = idOf(pd && pd.product) || idOf(l.price && l.price.product) || idOf(l.plan && l.plan.product);
    if (!pid) return null;
    ids.push(pid);
  }
  return ids;
}

const ourProductIds = () => Object.values(PLANS).map((p) => p.productId).filter(Boolean);

/** 明細から、有休ポンの商品が含まれないと分かる請求書か */
function isOtherProductInvoice(invoice) {
  const ids = invoiceProductIds(invoice);
  if (!ids) return false;
  const ours = ourProductIds();
  return !ids.some((id) => ours.includes(id));
}

/**
 * この契約で使ってよい最終日（'YYYY-MM-DD'、猶予込み）。使えない契約は null。
 *   active / trialing … 期間の末日（日付指定の解約 cancel_at が先ならそちら）
 *   past_due          … 期間の末日と「期間の初日 + PAST_DUE_DAYS」の早いほう
 *   canceled          … 終わった日（ended_at）
 *   unpaid / paused   … 支払い済みなのは今の期間の初日まで
 *   incomplete / incomplete_expired … 一度も支払われていない → null
 */
function entitledUntilOf(sub) {
  const status = sub.status || 'active';
  const start = periodStartOf(sub);
  let end = periodEndOf(sub);
  if (sub.cancel_at && (!end || sub.cancel_at < end)) end = sub.cancel_at;
  switch (status) {
    case 'active':
    case 'trialing':
      break;
    case 'past_due':
      if (start) end = Math.min(end || Infinity, start + PAST_DUE_DAYS * 86400);
      break;
    case 'canceled':
      end = sub.ended_at || sub.canceled_at || end;
      break;
    case 'unpaid':
    case 'paused':
      end = start || null;
      break;
    default:
      return null;
  }
  return end ? expiryFromUnix(end, GRACE_DAYS) : null;
}

/** 実際に配るキーの期限: min(使ってよい最終日, 今日 + MAX_OFFLINE_DAYS) */
function keyExpiry(entitledUntil) {
  const soft = daysFromToday(MAX_OFFLINE_DAYS);
  return entitledUntil < soft ? entitledUntil : soft;
}

const todayIso = () => new Date().toISOString().slice(0, 10);

// ------------------------------------------------------------
// メール（プレーンテキスト。Markdown を書かない）
// ------------------------------------------------------------
// MAIL_FROM は MiseFits と共用（「MiseFits <studio@…>」）。アドレスだけ使い、表示名は有休ポンにする。
function fromHeader(raw) {
  const s = String(raw || '').trim();
  const m = s.match(/<([^<>\s]+@[^<>\s]+)>/);
  return { name: SENDER_NAME, address: m ? m[1] : s };
}

/** Unix秒 → 日本時間の「2026年11月2日」 */
function jstDate(unix) {
  const d = new Date((Number(unix) + 9 * 3600) * 1000);
  return `${d.getUTCFullYear()}年${d.getUTCMonth() + 1}月${d.getUTCDate()}日`;
}

const FREE_LINE = '無料プラン（在籍5人まで）';
const SIGNATURE = `--
有休ポン（ここ企画）
${SITE}/`;

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

${SIGNATURE}
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

${SIGNATURE}
（ライセンスID: ${id}）`;
}

function cancelScheduledMail(endDate) {
  return `有休ポンの有料プランの解約を承りました。

${endDate} までは、これまでどおりご利用いただけます。
その後は自動的に${FREE_LINE}に戻ります。お手続きは不要です。
入力したデータはブラウザに残り、閲覧・管理簿の出力・バックアップはそのまま使えます。
期間中であれば、契約の管理ページから解約を取り消すこともできます。
${PORTAL_URL}

またのご利用をお待ちしています。ご不便な点がありましたら、
このメールにご返信いただけると今後の改善に役立ちます。

${SIGNATURE}`;
}

function canceledMail() {
  return `有休ポンの有料プランのご契約が終了しました。これまでのご利用ありがとうございました。

${FREE_LINE}は、これまでどおりお使いいただけます。
入力したデータはブラウザに残り、閲覧・管理簿の出力・バックアップはそのまま使えます。

またのご利用をお待ちしています。

${SIGNATURE}`;
}

/** 運営者あての「要対応」（購入者のメールアドレスが分からない・契約が有効でない など） */
function operatorMail(what, fields, key) {
  const lines = Object.entries(fields)
    .filter(([, v]) => v != null && v !== '')
    .map(([k, v]) => `${k}: ${v}`);
  return `${what}

${lines.join('\n')}
${key ? `\n発行したキー（購入者に手動で送る）:\n${key}\n` : ''}
Stripe のダッシュボードで顧客と契約を確かめてください。手順は docs/launch-checklist.md の8章。
（有休ポンの Cloud Functions から自動で送っています）`;
}

module.exports = {
  SITE,
  ALLOWED_ORIGINS,
  PORTAL_URL,
  SENDER_NAME,
  REGION,
  GRACE_DAYS,
  MAX_OFFLINE_DAYS,
  PAST_DUE_DAYS,
  TERMINAL,
  PLANS,
  planOf,
  periodEndOf,
  periodStartOf,
  intervalOf,
  customerIdOf,
  subscriptionIdOfInvoice,
  invoiceProductIds,
  isOtherProductInvoice,
  entitledUntilOf,
  keyExpiry,
  todayIso,
  fromHeader,
  jstDate,
  welcomeMail,
  renewalMail,
  cancelScheduledMail,
  canceledMail,
  operatorMail,
};
