// 日付は "YYYY-MM-DD" の文字列で扱う。文字列のまま大小比較できるので、タイムゾーンの事故が起きない。

export type ISODate = string

const pad = (n: number) => String(n).padStart(2, '0')

export function ymd(y: number, m: number, d: number): ISODate {
  return `${y}-${pad(m)}-${pad(d)}`
}

export function parts(date: ISODate): [number, number, number] {
  const [y, m, d] = date.split('-').map(Number)
  return [y, m, d]
}

export function isISODate(s: unknown): s is ISODate {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false
  const [y, m, d] = parts(s)
  return m >= 1 && m <= 12 && d >= 1 && d <= daysInMonth(y, m)
}

export function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate()
}

export function today(): ISODate {
  const now = new Date()
  return ymd(now.getFullYear(), now.getMonth() + 1, now.getDate())
}

/**
 * 「起算日から n か月」の期間が満了した翌日を返す（民法140〜143条の数え方）。
 * 4/1 入社 → 6か月後の 10/1 に年休が発生する。
 * 応当日が無い月（8/31 入社 → 2月）では、その月の末日で満了し、翌月1日に発生する。
 */
export function addMonthsCivil(date: ISODate, months: number): ISODate {
  const [y, m, d] = parts(date)
  const total = y * 12 + (m - 1) + months
  const ty = Math.floor(total / 12)
  const tm = (total % 12) + 1
  if (d <= daysInMonth(ty, tm)) return ymd(ty, tm, d)
  // 応当日が無い → 翌月1日
  return tm === 12 ? ymd(ty + 1, 1, 1) : ymd(ty, tm + 1, 1)
}

export function addDays(date: ISODate, days: number): ISODate {
  const [y, m, d] = parts(date)
  const t = new Date(Date.UTC(y, m - 1, d + days))
  return ymd(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate())
}

export function diffDays(a: ISODate, b: ISODate): number {
  const [ay, am, ad] = parts(a)
  const [by, bm, bd] = parts(b)
  return Math.round((Date.UTC(ay, am - 1, ad) - Date.UTC(by, bm - 1, bd)) / 86400000)
}

export const minDate = (a: ISODate, b: ISODate) => (a < b ? a : b)
export const maxDate = (a: ISODate, b: ISODate) => (a > b ? a : b)

/** "MM-DD" の基準日のうち、date より後（after=true）または以降で最初の日 */
export function nextMonthDay(date: ISODate, monthDay: string, strictlyAfter: boolean): ISODate {
  const [y] = parts(date)
  const [mm, dd] = monthDay.split('-').map(Number)
  for (const yy of [y, y + 1]) {
    const cand = ymd(yy, mm, Math.min(dd, daysInMonth(yy, mm)))
    if (strictlyAfter ? cand > date : cand >= date) return cand
  }
  return ymd(y + 2, mm, Math.min(dd, daysInMonth(y + 2, mm)))
}

const WEEK = ['日', '月', '火', '水', '木', '金', '土']

/** 2026-10-03 → 2026/10/03(土) */
export function fmt(date: ISODate | null | undefined, withWeekday = false): string {
  if (!date) return '—'
  const [y, m, d] = parts(date)
  const base = `${y}/${pad(m)}/${pad(d)}`
  if (!withWeekday) return base
  return `${base}(${WEEK[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]})`
}

/** 0.5 単位の日数表示 */
export function fmtDays(n: number): string {
  const v = Math.round(n * 10) / 10
  return Number.isInteger(v) ? `${v}日` : `${v.toFixed(1)}日`
}

/**
 * 残日数の表示。時間単位を使うときは端数を時間で出す（10.25日・8時間制 → 10日2時間）。
 * 0.5日はそのまま「10.5日」と出す。
 */
export function fmtBalance(days: number, hoursPerDay: number, hourly: boolean): string {
  const whole = Math.floor(days + 1e-9)
  const frac = days - whole
  if (!hourly || Math.abs(frac) < 1e-6 || Math.abs(frac - 0.5) < 1e-6) return fmtDays(days)
  const h = Math.round(frac * hoursPerDay * 10) / 10
  return whole > 0 ? `${whole}日${h}時間` : `${h}時間`
}

const ERA: Record<string, number> = { 令和: 2018, R: 2018, 平成: 1988, H: 1988, 昭和: 1925, S: 1925 }

/**
 * Excel や手入力の日付を ISO に直す。読めなければ null。
 * 対応: 2023-04-01 / 2023/4/1 / 2023.4.1 / 2023年4月1日 / 20230401 / 令和5年4月1日 / R5.4.1 / Excel のシリアル値 / Date
 */
export function parseLooseDate(input: unknown): ISODate | null {
  if (input == null || input === '') return null
  if (input instanceof Date && !isNaN(input.getTime())) {
    return ymd(input.getFullYear(), input.getMonth() + 1, input.getDate())
  }
  if (typeof input === 'number') {
    // Excel のシリアル値（1900年基準、1900/2/29 のバグ込み）
    if (input > 20000 && input < 80000) {
      const t = new Date(Date.UTC(1899, 11, 30) + Math.round(input) * 86400000)
      return ymd(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate())
    }
    if (input > 19000101 && input < 21001231) return parseLooseDate(String(input))
    return null
  }
  let s = String(input).trim().normalize('NFKC').replace(/\s+/g, '')
  if (!s) return null
  if (/^\d{8}$/.test(s)) s = `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6)}`
  let m = s.match(/^(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})日?$/)
  if (m) {
    const out = ymd(+m[1], +m[2], +m[3])
    return isISODate(out) ? out : null
  }
  m = s.match(/^(令和|平成|昭和|[RHS])(\d{1,2}|元)[-/.年](\d{1,2})[-/.月](\d{1,2})日?$/i)
  if (m) {
    const era = ERA[m[1].toUpperCase()] ?? ERA[m[1]]
    const yy = m[2] === '元' ? 1 : +m[2]
    const out = ymd(era + yy, +m[3], +m[4])
    return isISODate(out) ? out : null
  }
  return null
}
