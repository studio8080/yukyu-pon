// 料金・プランの設定。料金を変えたら README 4章の「同時に直すもの」を全部直す。
import { today } from './lib/dates'

/** 無料で管理できる在籍中の人数 */
export const FREE_LIMIT = 5

/**
 * 無料の人数を超えたら有料プランを必須にする日（この日から）。
 * 申し込みの受け付けは 2026-10-16 に始め、利用規約8条の「1か月前の告知」をはさんでこの日から人数の制限を始める（2026-10-16 運営者の決定）。
 * 変えるときは public/pricing.html の #status・public/llms.txt・README 4章も直す。`node tools/preflight.mjs --sale` で照合する。
 */
export const ENFORCE_FROM = '2026-11-16'

/** 「2026年11月16日」の形（画面・お知らせ用） */
export const ENFORCE_FROM_TEXT = ENFORCE_FROM.replace(/^(\d+)-0?(\d+)-0?(\d+)$/, '$1年$2月$3日')

/**
 * 無料の人数を超えたら有料プランを必須にするか（ENFORCE_FROM 以降。端末の日付で判定し、画面を開いた時点で決まる）。
 * 必須になっても、すでに入っているデータの閲覧・管理簿の出力・バックアップは止めない（データを人質にしない）。
 */
export const PRO_ENFORCED = today() >= ENFORCE_FROM

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
