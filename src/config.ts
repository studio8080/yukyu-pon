// 料金・プランの設定。料金を決めたらここと public/terms.html・README を同時に直す。

/** 無料で管理できる在籍中の人数 */
export const FREE_LIMIT = 5

/**
 * Pro を必須にするか。料金が決まるまでは false（全員が人数無制限で使える）。
 * true にしても、すでに入っているデータの閲覧・管理簿の出力・バックアップは止めない（データを人質にしない）。
 * 止めるのは「無料の人数を超えて新しく追加する」ことだけ。
 */
export const PRO_ENFORCED = false

/** 購入ページ（Stripe の支払いリンク）。空なら「準備中」と表示する */
export const PURCHASE_URL = ''
