// 料金・プランの設定。料金を変えたら README 4章の「同時に直すもの」を全部直す。

/** 無料で管理できる在籍中の人数 */
export const FREE_LIMIT = 5

/**
 * 無料の人数を超えたら Pro を必須にするか。
 * 支払いリンク4本を入れ、`node tools/preflight.mjs --sale` が通ってから true にする（docs/launch-checklist.md 7章。テスト購入はしない方針）。
 * true にしても、すでに入っているデータの閲覧・管理簿の出力・バックアップは止めない（データを人質にしない）。
 */
export const PRO_ENFORCED = false

/** キーの更新先（Cloud Functions。functions/index.js の yukyuponLicense）。送るのはライセンスIDだけ */
export const LICENSE_API = 'https://asia-northeast1-misefits.cloudfunctions.net/yukyuponLicense'

/** 料金表（画面の表示用。正本は public/pricing.html と Stripe の価格） */
export const PLANS = [
  { key: 'free', name: '無料', limit: FREE_LIMIT, month: 0, year: 0 },
  { key: 'pro', name: 'Pro', limit: 30, month: 480, year: 4800 },
  { key: 'business', name: 'ビジネス', limit: null, month: 980, year: 9800 },
] as const

/** キーの人数上限からプラン名を出す */
export function planName(limit: number | null | undefined): string {
  if (limit == null) return 'ビジネス（人数無制限）'
  if (limit === 30) return 'Pro（在籍30人まで）'
  return `Pro（在籍${limit}人まで）`
}
