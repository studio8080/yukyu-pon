/*
 * Stripe の商品ID → プラン。商品を作ったら productId を埋める（docs/launch-checklist.md の手順3）。
 * 空のプランの契約にはキーを出さない（共用の Stripe アカウントで、ほかの製品の契約を誤って処理しないため）。
 * limit は在籍人数の上限（null = 無制限）。料金・上限を変えたら public/pricing.html・terms.html・tokushoho.html も直す。
 */
const PLANS = {
  pro: { productId: '', name: 'Pro', limit: 30 },
  business: { productId: '', name: 'ビジネス', limit: null },
};

module.exports = { PLANS };
