/*
 * Stripe の商品ID → プラン。商品を作ったら productId を埋める（docs/launch-checklist.md の手順3）。
 * 空のプランの契約にはキーを出さない（共用の Stripe アカウントで、ほかの製品の契約を誤って処理しないため）。
 * limit は在籍人数の上限（null = 無制限）。料金・上限を変えたら public/pricing.html・terms.html・tokushoho.html も直す。
 */
const PLANS = {
  pro: { productId: 'prod_VOaJ6ZLE0uy9LG', name: 'Pro', limit: 30 }, // 2026-10-07 作成（¥480/月・¥4,800/年、税込）
  business: { productId: 'prod_VOaMMPiqQQOP9R', name: 'ビジネス', limit: null }, // 2026-10-07 作成（¥980/月・¥9,800/年、税込）
};

/*
 * Stripe のサンドボックス（テスト環境）の商品ID。決済の経路を本番と同じ関数のコードで通しで確かめるためのもの
 * （docs/launch-checklist.md 6章）。埋めると yukyuponSandboxWebhook / yukyuponSandboxLicense が作られる
 * （シークレット YP_SANDBOX_STRIPE_KEY・YP_SANDBOX_WEBHOOK_SECRET が要る）。空に戻してデプロイすれば消える。
 * テスト環境のキーは2日で切れる。Firestore は yukyuponSandbox* に分け、本番の記録に混ぜない。
 */
const SANDBOX_PLANS = {
  pro: { productId: 'prod_VRuymTZoORb3nY', name: 'Pro', limit: 30 }, // 「ここ企画サンドボックス」の 有休ポン Pro（テスト） ¥480/月
  business: { productId: 'prod_VRuyPKAIpyQI8l', name: 'ビジネス', limit: null }, // 有休ポン ビジネス（テスト） ¥980/月
};

module.exports = { PLANS, SANDBOX_PLANS };
