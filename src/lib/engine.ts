// 有休の計算エンジン。画面から切り離してあり、ここだけでテストできる。
// 法令の根拠は README の「計算のルール」に、条文と一緒にまとめてある。

import {
  addDays,
  addMonthsCivil,
  minDate,
  nextMonthDay,
  type ISODate,
} from './dates'
import {
  FIXED_DAYS,
  type AttendanceCheck,
  type Contract,
  type Employee,
  type LeaveRecord,
  type Settings,
} from './types'

// ---------------------------------------------------------------------------
// 付与日数の表（労基法39条2項・3項、労基則24条の3）

/** 勤続 0.5年, 1.5年, 2.5年, 3.5年, 4.5年, 5.5年, 6.5年以上 */
export const GRANT_TABLE: Record<1 | 2 | 3 | 4 | 5, readonly number[]> = {
  5: [10, 11, 12, 14, 16, 18, 20], // 通常の労働者（週5日以上 または 週30時間以上）
  4: [7, 8, 9, 10, 12, 13, 15], // 週4日 / 年169〜216日
  3: [5, 6, 6, 8, 9, 10, 11], // 週3日 / 年121〜168日
  2: [3, 4, 4, 5, 6, 6, 7], // 週2日 / 年73〜120日
  1: [1, 2, 2, 2, 3, 3, 3], // 週1日 / 年48〜72日
}

export const TENURE_LABEL = ['0.5年', '1.5年', '2.5年', '3.5年', '4.5年', '5.5年', '6.5年以上']

/** 付与区分。5 = 通常の労働者、1〜4 = 比例付与、0 = 付与の対象外（年48日未満） */
export type Category = 0 | 1 | 2 | 3 | 4 | 5

export function categoryOf(c: Contract): Category {
  if (c.over30h) return 5
  if (c.daysPerWeek >= 5) return 5
  if (c.daysPerWeek >= 1) return c.daysPerWeek as Category
  const a = c.annualDays ?? 0
  if (a >= 217) return 5
  if (a >= 169) return 4
  if (a >= 121) return 3
  if (a >= 73) return 2
  if (a >= 48) return 1
  return 0
}

export function categoryLabel(cat: Category): string {
  if (cat === 5) return '通常（週5日以上または週30時間以上）'
  if (cat === 0) return '対象外（年48日未満）'
  return `比例付与（週${cat}日相当）`
}

export function contractLabel(c: Contract): string {
  const base = c.daysPerWeek > 0 ? `週${c.daysPerWeek}日` : `年${c.annualDays ?? 0}日`
  return c.over30h ? `${base}・週30時間以上` : base
}

/** その日に有効な契約。最初の契約より前なら最初の契約を使う（入社時の契約とみなす） */
export function contractAt(emp: Employee, date: ISODate): Contract | null {
  if (emp.contracts.length === 0) return null
  const sorted = [...emp.contracts].sort((a, b) => (a.from < b.from ? -1 : 1))
  let cur = sorted[0]
  for (const c of sorted) if (c.from <= date) cur = c
  return cur
}

/** 時間単位の年休で「1日」とみなす時間数（1日の所定労働時間。1時間未満は切り上げ。労基則24条の4） */
export function hoursPerDayAt(emp: Employee, date: ISODate): number {
  const h = contractAt(emp, date)?.hoursPerDay ?? 8
  return Math.max(1, Math.ceil(h))
}

/** 1件の取得が何日分か。時間単位はその日の契約の時間数で割る */
export function recordDays(emp: Employee, r: LeaveRecord): number {
  if (r.kind === 'hours') return round((r.hours ?? 0) / hoursPerDayAt(emp, r.date))
  return FIXED_DAYS[r.kind]
}

export function statutoryDays(cat: Category, step: number): number {
  if (cat === 0) return 0
  return GRANT_TABLE[cat][Math.min(step, 6)]
}

// ---------------------------------------------------------------------------
// 付与の予定（基準日の並び）

export type GrantEvent = {
  date: ISODate
  /** 何回目の付与か（0 = 初回）。勤続年数の段階 */
  step: number
  contract: Contract | null
  category: Category
  /** 法定の付与日数 */
  statutory: number
  /** 実際に付与する日数（上書き・付与なしを反映） */
  days: number
  skipped: boolean
  adjusted: boolean
  note?: string
  /** 年5日の取得義務がかかるか（法定の付与が10日以上で、付与なしでない） */
  obligation: boolean
  /** 法定どおりの基準日より前倒しになっているか */
  advanced: boolean
  /** 出勤率を見る期間の始まり（入社日か、前回の付与日）。終わりは付与日の前日 */
  periodFrom: ISODate
  /** 出勤率の確認（人が記録） */
  attendance?: AttendanceCheck
}

function uniformActive(settings: Settings, date: ISODate): boolean {
  return settings.grantRule === 'uniform' && (!settings.uniformFrom || date >= settings.uniformFrom)
}

/**
 * 付与の予定を until まで作る。
 *
 * 法定どおり: 入社から6か月後、以降1年ごと。
 * 一斉付与:   前の付与から1年以内に来る基準日（MM-DD）へ前倒しする。前倒しした回は
 *            「次の段階の日数」を付与し、その後もずっと1段ずつ進む。法定より遅れることはない
 *            （平6.1.4 基発1号の前倒しの考え方）。
 */
export function grantSchedule(emp: Employee, settings: Settings, until: ISODate): GrantEvent[] {
  const hire = emp.hireDate
  const md = settings.uniformMonthDay
  let first = addMonthsCivil(hire, 6)
  if (uniformActive(settings, hire)) {
    if (settings.uniformFirst === 'hire') first = hire
    else if (settings.uniformFirst === 'firstUniform') {
      const u = nextMonthDay(hire, md, true)
      if (u < first) first = u
    }
  }

  const events: GrantEvent[] = []
  let date = first
  let step = 0
  let prev = hire
  while (date <= until && (!emp.retireDate || date <= emp.retireDate) && step < 80) {
    const contract = contractAt(emp, date)
    const category = contract ? categoryOf(contract) : 0
    const statutory = statutoryDays(category, step)
    const adj = emp.adjustments[date]
    const skipped = !!adj?.skipped
    const days = skipped ? 0 : adj?.days ?? statutory
    events.push({
      date,
      step,
      contract,
      category,
      statutory,
      days,
      skipped,
      adjusted: !!adj && (adj.skipped || adj.days != null),
      note: adj?.note,
      obligation: !skipped && statutory >= 10,
      advanced: date < addMonthsCivil(hire, 6 + 12 * step),
      periodFrom: prev,
      attendance: adj?.attendance,
    })
    prev = date

    // 次の基準日: 法定の期限（前回から1年 かつ 入社から 6+12n か月）より遅れない
    const deadline = minDate(addMonthsCivil(date, 12), addMonthsCivil(hire, 6 + 12 * (step + 1)))
    let next = deadline
    if (settings.grantRule === 'uniform') {
      const u = nextMonthDay(date, md, true)
      if (uniformActive(settings, u) && u <= deadline) next = u
    }
    date = next
    step++
  }
  return events
}

// ---------------------------------------------------------------------------
// 残高（付与ごとのかたまり＝ロットで管理。2年で時効）

export type Lot = {
  key: string
  source: 'auto' | 'opening' | 'extra'
  label: string
  grantDate: ISODate
  /** この日から使えない（付与日から2年。労基法115条） */
  expires: ISODate
  granted: number
  used: number
  lapsed: number
  remaining: number
}

export type LeaveUse = {
  record: LeaveRecord
  amount: number
  /** 残高から引いたか（管理開始日より前・予定は引かない） */
  deducted: boolean
  shortfall: number
}

/** untracked = 管理開始日より前に終わった期間で、記録が足りない（判定しない） */
export type WindowStatus = 'upcoming' | 'active' | 'done' | 'missed' | 'retired' | 'untracked'
export type Level = 'red' | 'yellow' | 'ok' | 'done' | 'none'

export type ObligationWindow = {
  grantDate: ISODate
  /** この日の前日までに5日（end は含まない） */
  end: ISODate
  deadline: ISODate
  taken: number
  planned: number
  needed: number
  status: WindowStatus
  level: Level
  daysLeft: number
}

export type PeriodRow = {
  grant: GrantEvent
  /** この付与から次の付与の前日まで（管理簿の1行） */
  periodEnd: ISODate
  dates: LeaveRecord[]
  takenDays: number
}

export type Report = {
  employee: Employee
  asOf: ISODate
  active: boolean
  schedule: GrantEvent[]
  lots: Lot[]
  uses: LeaveUse[]
  balance: number
  nextGrant: GrantEvent | null
  windows: ObligationWindow[]
  /** いちばん気にすべき5日の期間（進行中で一番急ぐもの。なければ今の期間の達成分か、直近の未達） */
  focus: ObligationWindow | null
  /** 1年以内に期限を迎えて5日に届かなかった期間 */
  missed: ObligationWindow[]
  level: Level
  periods: PeriodRow[]
  /** 3か月以内に時効で消える日数 */
  expiringSoon: { date: ISODate; days: number }[]
  /** 出勤率の確認がまだの付与（前後の期間内） */
  attendanceDue: GrantEvent[]
  /** 集計日の時点の「1日＝何時間」 */
  hoursPerDay: number
  warnings: string[]
}

// 時間単位（1/7日など）があるので細かく丸める。表示は別に丸める
function round(n: number): number {
  return Math.round(n * 1e6) / 1e6
}

export function buildReport(
  emp: Employee,
  leaves: LeaveRecord[],
  settings: Settings,
  asOf: ISODate,
): Report {
  const warnings: string[] = []
  const start = emp.trackingStart || emp.hireDate
  const schedule = grantSchedule(emp, settings, addMonthsCivil(asOf, 24))
  const mine = leaves
    .filter((l) => l.employeeId === emp.id)
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.kind.localeCompare(b.kind)))

  if (emp.contracts.length === 0) warnings.push('契約（週の勤務日数）が入っていません。付与日数を計算できません。')
  for (const g of schedule) {
    if (g.date > asOf) break
    if (g.category === 0 && !g.skipped && g.contract)
      warnings.push(`${g.date} の時点の契約は年48日未満のため、年休の付与対象外です。`)
    if (!g.skipped && g.adjusted && g.days < g.statutory)
      warnings.push(`${g.date} の付与を ${g.days}日 に上書きしていますが、法定の ${g.statutory}日 より少なくなっています。`)
  }
  const scheduleDates = new Set(schedule.map((g) => g.date))
  for (const key of Object.keys(emp.adjustments)) {
    if (!scheduleDates.has(key))
      warnings.push(`${key} の手動調整は、いまの付与ルールでは付与日に当たりません（設定を変えた可能性があります）。`)
  }

  // --- ロットを作る
  const lots: Lot[] = []
  for (const o of emp.openingLots) {
    const expires = addMonthsCivil(o.grantDate, 24)
    if (expires <= start) warnings.push(`移行残（${o.grantDate} 付与分）は管理開始日より前に時効を迎えています。`)
    lots.push({
      key: `opening:${o.id}`,
      source: 'opening',
      label: `移行時の残り（${o.grantDate} 付与分）`,
      grantDate: o.grantDate,
      expires,
      granted: o.days,
      used: 0,
      lapsed: 0,
      remaining: o.days,
    })
  }
  for (const g of schedule) {
    if (g.date < start || g.date > asOf || g.days <= 0) continue
    lots.push({
      key: `auto:${g.date}`,
      source: 'auto',
      label: `${g.advanced ? '前倒し付与' : '法定付与'}（勤続${TENURE_LABEL[Math.min(g.step, 6)]}）`,
      grantDate: g.date,
      expires: addMonthsCivil(g.date, 24),
      granted: g.days,
      used: 0,
      lapsed: 0,
      remaining: g.days,
    })
  }
  for (const x of emp.extraGrants) {
    if (x.date < start) {
      warnings.push(`会社独自の付与（${x.date}）は管理開始日より前です。移行残に含めてください。`)
      continue
    }
    if (x.date > asOf) continue
    lots.push({
      key: `extra:${x.id}`,
      source: 'extra',
      label: x.note ? `会社独自: ${x.note}` : '会社独自の付与',
      grantDate: x.date,
      expires: addMonthsCivil(x.date, x.validMonths || 24),
      granted: x.days,
      used: 0,
      lapsed: 0,
      remaining: x.days,
    })
  }
  lots.sort((a, b) => (a.grantDate < b.grantDate ? -1 : a.grantDate > b.grantDate ? 1 : 0))

  const expireUntil = (date: ISODate) => {
    for (const lot of lots) {
      if (lot.expires <= date && lot.remaining > 0) {
        lot.lapsed = round(lot.lapsed + lot.remaining)
        lot.remaining = 0
      }
    }
  }

  // --- 取得を古い順に引く
  const uses: LeaveUse[] = []
  const seen = new Map<ISODate, number>()
  if (!settings.hourlyEnabled && mine.some((r) => r.kind === 'hours'))
    warnings.push('時間単位の取得が記録されていますが、設定で時間単位の年休が「使わない」になっています。')
  for (const r of mine) {
    const amount = recordDays(emp, r)
    if (r.kind === 'hours' && !(Number.isInteger(r.hours) && (r.hours ?? 0) >= 1))
      warnings.push(`${r.date} の時間単位の取得は、1時間以上の整数で入れてください。`)
    const sameDay = round((seen.get(r.date) ?? 0) + amount)
    seen.set(r.date, sameDay)
    if (sameDay > 1) warnings.push(`${r.date} の取得が1日を超えています（重複していないか確認してください）。`)
    if (r.date < emp.hireDate) warnings.push(`${r.date} の取得は入社日より前です。`)
    if (emp.retireDate && r.date > emp.retireDate) warnings.push(`${r.date} の取得は退職日より後です。`)

    if (r.date < start || r.date > asOf) {
      uses.push({ record: r, amount, deducted: false, shortfall: 0 })
      continue
    }
    expireUntil(r.date)
    let need = amount
    const usable = lots
      .filter((l) => l.grantDate <= r.date && l.expires > r.date && l.remaining > 0)
      .sort((a, b) =>
        settings.consumeOrder === 'newest'
          ? a.grantDate < b.grantDate ? 1 : -1
          : a.grantDate < b.grantDate ? -1 : 1,
      )
    for (const lot of usable) {
      if (need <= 0) break
      const take = Math.min(lot.remaining, need)
      lot.remaining = round(lot.remaining - take)
      lot.used = round(lot.used + take)
      need = round(need - take)
    }
    if (need > 0) warnings.push(`${r.date} の取得の時点で残日数が ${need}日 足りません（欠勤や特別休暇の記録が混ざっていないか確認してください）。`)
    uses.push({ record: r, amount, deducted: true, shortfall: need })
  }
  expireUntil(asOf) // 集計日の時点で時効になった分（expires <= asOf）を消す

  const balance = round(lots.filter((l) => l.expires > asOf).reduce((s, l) => s + l.remaining, 0))

  // --- 年5日の取得義務（労基法39条7項）
  const windows: ObligationWindow[] = []
  for (const g of schedule) {
    if (!g.obligation) continue
    const end = addMonthsCivil(g.date, 12)
    const inWin = mine.filter((r) => r.date >= g.date && r.date < end)
    // 時間単位の年休は年5日に数えない（平30.12.28 基発1228第15号）
    const counted = inWin.filter((r) => r.kind !== 'hours')
    const taken = round(counted.filter((r) => r.date <= asOf).reduce((s, r) => s + recordDays(emp, r), 0))
    const planned = round(counted.filter((r) => r.date > asOf).reduce((s, r) => s + recordDays(emp, r), 0))
    const deadline = addDays(end, -1)
    let status: WindowStatus
    let level: Level = 'none'
    if (emp.retireDate && emp.retireDate < deadline && taken < 5) status = 'retired'
    else if (g.date > asOf) status = 'upcoming'
    else if (taken >= 5) {
      status = 'done'
      level = 'done'
    } else if (end <= start && start !== emp.hireDate) {
      status = 'untracked'
    } else if (end <= asOf) {
      status = 'missed'
      level = 'red'
    } else {
      status = 'active'
      if (asOf >= addMonthsCivil(end, -settings.redMonths)) level = 'red'
      else if (asOf >= addMonthsCivil(end, -settings.yellowMonths)) level = 'yellow'
      else level = 'ok'
    }
    const d1 = Date.UTC(+deadline.slice(0, 4), +deadline.slice(5, 7) - 1, +deadline.slice(8, 10))
    const d0 = Date.UTC(+asOf.slice(0, 4), +asOf.slice(5, 7) - 1, +asOf.slice(8, 10))
    windows.push({
      grantDate: g.date,
      end,
      deadline,
      taken,
      planned,
      needed: Math.max(0, round(5 - taken)),
      status,
      level,
      daysLeft: Math.round((d1 - d0) / 86400000),
    })
  }

  const active = !emp.retireDate || emp.retireDate >= asOf
  const rank: Record<Level, number> = { red: 4, yellow: 3, ok: 2, done: 1, none: 0 }
  const live = windows.filter((w) => w.status === 'active')
  // 主に見せるのは「いま進行中」の期間。過去の未達は直せないので、別に知らせる（1年以内に締め切られたもの）
  const missed = windows.filter((w) => w.status === 'missed' && w.end > addMonthsCivil(asOf, -12))
  let focus: ObligationWindow | null = null
  for (const w of live) {
    if (!focus || rank[w.level] > rank[focus.level] || (rank[w.level] === rank[focus.level] && w.end < focus.end)) focus = w
  }
  if (!focus) {
    const doneNow = windows.filter((w) => w.status === 'done' && w.grantDate <= asOf && w.end > asOf)
    focus = doneNow[doneNow.length - 1] ?? missed[missed.length - 1] ?? null
  }
  const level: Level = !active ? 'none' : focus ? focus.level : 'none'

  // --- 管理簿の行（基準日ごと）
  const periods: PeriodRow[] = []
  const past = schedule.filter((g) => g.date <= asOf)
  past.forEach((g, i) => {
    const nextDate = past[i + 1]?.date ?? schedule.find((s) => s.date > g.date)?.date ?? addMonthsCivil(g.date, 12)
    const periodEnd = addDays(minDate(nextDate, addMonthsCivil(g.date, 12)), -1)
    const dates = mine.filter((r) => r.date >= g.date && r.date <= periodEnd)
    periods.push({
      grant: g,
      periodEnd,
      dates,
      takenDays: round(dates.reduce((s, r) => s + recordDays(emp, r), 0)),
    })
    // 時間単位は1年に5日分まで（労基法39条4項）
    const hourly = dates.filter((r) => r.kind === 'hours')
    const hourlyDays = round(hourly.reduce((s, r) => s + recordDays(emp, r), 0))
    if (hourlyDays > 5)
      warnings.push(`${g.date} からの1年で、時間単位の取得が5日分を超えています（${hourly.reduce((s, r) => s + (r.hours ?? 0), 0)}時間）。`)
  })

  // 出勤率の確認: 付与日の1か月前から、付与後2か月まで（付与なし・確認済み・管理開始前は除く）
  const attendanceDue = settings.attendanceCheck
    ? schedule.filter(
        (g) =>
          g.date >= start &&
          g.date > g.periodFrom &&
          g.statutory > 0 &&
          !g.skipped &&
          !g.attendance &&
          g.date <= addMonthsCivil(asOf, 1) &&
          g.date > addMonthsCivil(asOf, -2),
      )
    : []

  const soon = addMonthsCivil(asOf, 3)
  const expiringSoon = lots
    .filter((l) => l.remaining > 0 && l.expires > asOf && l.expires <= soon)
    .map((l) => ({ date: addDays(l.expires, -1), days: l.remaining }))

  return {
    employee: emp,
    asOf,
    active,
    schedule,
    lots,
    uses,
    balance,
    nextGrant: schedule.find((g) => g.date > asOf) ?? null,
    windows,
    focus,
    missed,
    level,
    periods,
    expiringSoon,
    attendanceDue,
    hoursPerDay: hoursPerDayAt(emp, asOf),
    warnings: [...new Set(warnings)],
  }
}
