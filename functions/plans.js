/*
 * Stripe の商品ID → プラン。商品を作ったら productId を埋める（docs/launch-checklist.md の手順3）。
 * 空のプランの契約にはキーを出さない（共用の Stripe アカウントで、ほかの製品の契約を誤って処理しないため）。
 * limit は在籍人数の上限（null = 無制限）。料金・上限を変えたら public/pricing.html・terms.html・tokushoho.html も直す。
 */
const PLANS = {
  pro: { productId: 'prod_VOaJ6ZLE0uy9LG', name: 'Pro', limit: 30 }, // 2026-10-07 作成（¥480/月・¥4,800/年、税込）
  business: { productId: 'prod_VOaMMPiqQQOP9R', name: 'ビジネス', limit: null }, // 2026-10-07 作成（¥980/月・¥9,800/年、税込）
};

module.exports = { PLANS };
