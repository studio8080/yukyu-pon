import { describe, expect, it } from 'vitest'
import { addMonthsCivil, fmtBalance, parseLooseDate } from './dates'
import { buildReport, grantSchedule } from './engine'
import { defaultSettings } from './defaults'
import type { Employee, LeaveRecord, Settings } from './types'

function emp(p: Partial<Employee> & { hireDate: string }): Employee {
  return {
    id: 'e1',
    code: '',
    name: 'テスト',
    retireDate: null,
    contracts: [{ from: p.hireDate, daysPerWeek: 5, over30h: true }],
    trackingStart: null,
    openingLots: [],
    adjustments: {},
    extraGrants: [],
    memo: '',
    ...p,
  }
}
const S = (p: Partial<Settings> = {}): Settings => ({ ...defaultSettings, ...p })
const leave = (date: string, kind: LeaveRecord['kind'] = 'full'): LeaveRecord => ({
  id: date + kind,
  employeeId: 'e1',
  date,
  kind,
})
const hours = (date: string, h: number): LeaveRecord => ({ id: date + 'h' + h, employeeId: 'e1', date, kind: 'hours', hours: h })
const sched = (e: Employee, s: Settings, until: string) =>
  grantSchedule(e, s, until).map((g) => [g.date, g.days])

describe('日付', () => {
  it('6か月後は応当日。応当日が無ければ翌月1日', () => {
    expect(addMonthsCivil('2024-04-01', 6)).toBe('2024-10-01')
    expect(addMonthsCivil('2024-08-31', 6)).toBe('2025-03-01')
    expect(addMonthsCivil('2023-08-30', 6)).toBe('2024-03-01')
    expect(addMonthsCivil('2024-02-29', 12)).toBe('2025-03-01')
    expect(addMonthsCivil('2025-10-15', -1)).toBe('2025-09-15')
  })
  it('いろいろな書き方の日付を読む', () => {
    expect(parseLooseDate('R5.4.1')).toBe('2023-04-01')
    expect(parseLooseDate('令和元年5月1日')).toBe('2019-05-01')
    expect(parseLooseDate('2023/4/1')).toBe('2023-04-01')
    expect(parseLooseDate('２０２３年４月１日')).toBe('2023-04-01')
    expect(parseLooseDate(45017)).toBe('2023-04-01')
    expect(parseLooseDate('20230401')).toBe('2023-04-01')
    expect(parseLooseDate('2023/2/30')).toBeNull()
    expect(parseLooseDate('あした')).toBeNull()
  })
})

describe('付与の予定', () => {
  it('通常の労働者は 10,11,12,14,16,18,20,20', () => {
    const e = emp({ hireDate: '2019-04-01' })
    expect(sched(e, S(), '2027-12-31')).toEqual([
      ['2019-10-01', 10], ['2020-10-01', 11], ['2021-10-01', 12], ['2022-10-01', 14],
      ['2023-10-01', 16], ['2024-10-01', 18], ['2025-10-01', 20], ['2026-10-01', 20], ['2027-10-01', 20],
    ])
  })
  it('週3日（30時間未満）は比例付与', () => {
    const e = emp({ hireDate: '2020-04-01', contracts: [{ from: '2020-04-01', daysPerWeek: 3, over30h: false }] })
    expect(sched(e, S(), '2024-12-31').map((x) => x[1])).toEqual([5, 6, 6, 8, 9])
  })
  it('週4日でも30時間以上なら通常の労働者', () => {
    const e = emp({ hireDate: '2020-04-01', contracts: [{ from: '2020-04-01', daysPerWeek: 4, over30h: true }] })
    expect(sched(e, S(), '2021-12-31').map((x) => x[1])).toEqual([10, 11])
  })
  it('週で決まっていない人は年間日数で判定', () => {
    const e = emp({ hireDate: '2020-04-01', contracts: [{ from: '2020-04-01', daysPerWeek: 0, annualDays: 150, over30h: false }] })
    expect(sched(e, S(), '2020-12-31')).toEqual([['2020-10-01', 5]])
  })
  it('契約変更は、基準日時点の契約で決まる（過去の付与は変わらない）', () => {
    const e = emp({
      hireDate: '2023-04-01',
      contracts: [
        { from: '2023-04-01', daysPerWeek: 3, over30h: false },
        { from: '2025-01-01', daysPerWeek: 5, over30h: true },
      ],
    })
    const g = grantSchedule(e, S(), '2025-12-31')
    expect(g.map((x) => [x.date, x.days, x.obligation])).toEqual([
      ['2023-10-01', 5, false],
      ['2024-10-01', 6, false],
      ['2025-10-01', 12, true],
    ])
  })
  it('出勤率8割未満で付与なしにしても、勤続年数は進む', () => {
    const e = emp({ hireDate: '2020-04-01', adjustments: { '2021-10-01': { skipped: true } } })
    const g = grantSchedule(e, S(), '2022-12-31')
    expect(g.map((x) => [x.date, x.days, x.obligation])).toEqual([
      ['2020-10-01', 10, true],
      ['2021-10-01', 0, false],
      ['2022-10-01', 12, true],
    ])
  })
  it('退職日より後は付与しない', () => {
    const e = emp({ hireDate: '2020-04-01', retireDate: '2022-09-30' })
    expect(sched(e, S(), '2025-12-31').length).toBe(2)
  })
})

describe('一斉付与', () => {
  const uni = S({ grantRule: 'uniform', uniformMonthDay: '04-01' })
  it('1回目は6か月後、2回目から基準日に前倒し', () => {
    const e = emp({ hireDate: '2025-12-01' })
    const g = grantSchedule(e, { ...uni, uniformFirst: 'sixMonths' }, '2028-12-31')
    expect(g.map((x) => [x.date, x.days, x.advanced])).toEqual([
      ['2026-06-01', 10, false],
      ['2027-04-01', 11, true],
      ['2028-04-01', 12, true],
    ])
  })
  it('6か月以内に基準日が来るなら、そこで前倒しで10日', () => {
    const e = emp({ hireDate: '2025-12-01' })
    expect(sched(e, { ...uni, uniformFirst: 'firstUniform' }, '2027-12-31')).toEqual([
      ['2026-04-01', 10],
      ['2027-04-01', 11],
    ])
  })
  it('入社日に付与', () => {
    const e = emp({ hireDate: '2025-12-01' })
    expect(sched(e, { ...uni, uniformFirst: 'hire' }, '2026-12-31')).toEqual([
      ['2025-12-01', 10],
      ['2026-04-01', 11],
    ])
  })
  it('途中から一斉付与に切り替えると、次の付与が基準日へ前倒しになる', () => {
    const e = emp({ hireDate: '2020-07-01' })
    const g = grantSchedule(e, { ...uni, uniformFrom: '2026-04-01' }, '2027-12-31')
    expect(g.map((x) => [x.date, x.days])).toEqual([
      ['2021-01-01', 10], ['2022-01-01', 11], ['2023-01-01', 12], ['2024-01-01', 14],
      ['2025-01-01', 16], ['2026-01-01', 18], ['2026-04-01', 20], ['2027-04-01', 20],
    ])
  })
  it('前倒しの日付は、法定の基準日より遅れない', () => {
    for (const hire of ['2024-01-15', '2024-03-31', '2024-04-01', '2024-04-02', '2024-09-30', '2024-10-01', '2024-11-30']) {
      for (const first of ['sixMonths', 'firstUniform', 'hire'] as const) {
        const g = grantSchedule(emp({ hireDate: hire }), { ...uni, uniformFirst: first }, '2033-12-31')
        g.forEach((x, i) => {
          expect(x.date <= addMonthsCivil(hire, 6 + 12 * i)).toBe(true)
          if (i > 0) expect(x.date <= addMonthsCivil(g[i - 1].date, 12)).toBe(true)
        })
      }
    }
  })
})

describe('残高と時効', () => {
  const e = emp({ hireDate: '2020-04-01' })
  it('付与から2年で消える', () => {
    expect(buildReport(e, [], S(), '2022-09-30').balance).toBe(21)
    expect(buildReport(e, [], S(), '2022-10-01').balance).toBe(23)
  })
  it('古い付与分から使う（既定）', () => {
    const ls = [leave('2022-01-10'), leave('2022-01-11'), leave('2022-01-12', 'am')]
    const r = buildReport(e, ls, S(), '2022-10-01')
    expect(r.lots[0].used).toBe(2.5)
    expect(r.lots[0].lapsed).toBe(7.5)
    expect(r.balance).toBe(23)
  })
  it('新しい付与分から使う設定', () => {
    const ls = [leave('2022-01-10'), leave('2022-01-11'), leave('2022-01-12', 'am')]
    const r = buildReport(e, ls, S({ consumeOrder: 'newest' }), '2022-10-01')
    expect(r.lots[0].lapsed).toBe(10)
    expect(r.balance).toBe(20.5)
  })
  it('残高を超える取得は警告', () => {
    const r = buildReport(e, [leave('2020-09-01')], S(), '2020-12-01')
    expect(r.warnings.some((w) => w.includes('足りません'))).toBe(true)
  })
  it('同じ日に全日と半休は警告。午前と午後は問題なし', () => {
    const ok = buildReport(e, [leave('2021-01-05', 'am'), leave('2021-01-05', 'pm')], S(), '2021-02-01')
    expect(ok.warnings).toEqual([])
    const ng = buildReport(e, [leave('2021-01-05'), leave('2021-01-05', 'pm')], S(), '2021-02-01')
    expect(ng.warnings.some((w) => w.includes('1日を超えて'))).toBe(true)
  })
  it('Excel からの移行: 管理開始日より前の取得は残高から引かないが、5日には数える', () => {
    const m = emp({
      hireDate: '2018-04-01',
      trackingStart: '2026-04-01',
      openingLots: [
        { id: 'a', grantDate: '2024-10-01', days: 4 },
        { id: 'b', grantDate: '2025-10-01', days: 18 },
      ],
    })
    const r = buildReport(m, [leave('2026-03-10'), leave('2026-05-01')], S(), '2026-06-01')
    expect(r.balance).toBe(21)
    const w = r.windows.find((x) => x.grantDate === '2025-10-01')!
    expect(w.taken).toBe(2)
    // 管理開始前に終わった期間は、記録が無くても未達にしない
    expect(r.windows.find((x) => x.grantDate === '2024-10-01')!.status).toBe('untracked')
    expect(r.missed).toEqual([])
  })
  it('会社独自の上乗せは別枠で残高に足す（5日義務の判定には使わない）', () => {
    const p = emp({
      hireDate: '2020-04-01',
      contracts: [{ from: '2020-04-01', daysPerWeek: 3, over30h: false }],
      extraGrants: [{ id: 'x', date: '2020-10-01', days: 5, validMonths: 24, note: '創業記念' }],
    })
    const r = buildReport(p, [], S(), '2020-10-01')
    expect(r.balance).toBe(10)
    expect(r.windows.length).toBe(0)
  })
})

describe('年5日の取得義務', () => {
  const e = emp({ hireDate: '2024-04-01' })
  const ls = [leave('2025-01-06'), leave('2025-05-01')]
  it('期限まで3か月を切ると黄、1か月を切ると赤', () => {
    expect(buildReport(e, ls, S(), '2025-06-30').level).toBe('ok')
    expect(buildReport(e, ls, S(), '2025-07-01').level).toBe('yellow')
    const r = buildReport(e, ls, S(), '2025-09-01')
    expect(r.level).toBe('red')
    expect(r.focus?.needed).toBe(3)
    expect(r.focus?.deadline).toBe('2025-09-30')
  })
  it('期限を過ぎて未達なら missed', () => {
    const r = buildReport(e, ls, S(), '2025-10-01')
    expect(r.windows[0].status).toBe('missed')
    expect(r.missed.length).toBe(1)
    expect(r.focus?.grantDate).toBe('2025-10-01') // 同じ日に次の期間が始まるので、そちらを主に見せる
  })
  it('過去の未達があっても、主に見せるのは進行中の期間', () => {
    const r = buildReport(e, ls, S(), '2026-01-10')
    expect(r.focus?.grantDate).toBe('2025-10-01')
    expect(r.level).toBe('ok')
    expect(r.missed.map((w) => w.grantDate)).toEqual(['2024-10-01'])
  })
  it('5日取れば達成。半休は0.5日で数える', () => {
    const more = [...ls, leave('2025-06-02'), leave('2025-06-03'), leave('2025-06-04', 'am'), leave('2025-06-04', 'pm')]
    const r = buildReport(e, more, S(), '2025-09-01')
    expect(r.windows[0].status).toBe('done')
  })
  it('予定（集計日より後の取得）は別に数える', () => {
    const r = buildReport(e, [...ls, leave('2025-09-20'), leave('2025-09-21')], S(), '2025-09-01')
    expect(r.focus?.taken).toBe(2)
    expect(r.focus?.planned).toBe(2)
  })
  it('期間の途中で退職したら対象外', () => {
    const r = buildReport({ ...e, retireDate: '2025-03-31' }, ls, S(), '2025-09-01')
    expect(r.windows[0].status).toBe('retired')
  })
  it('一斉付与で期間が重なったら、それぞれの期間で5日を見る', () => {
    const u = S({ grantRule: 'uniform', uniformMonthDay: '04-01', uniformFirst: 'sixMonths' })
    const h = emp({ hireDate: '2025-07-01' }) // 2026-01-01 に10日、2026-04-01 に11日
    const r = buildReport(h, [leave('2026-02-02')], u, '2026-05-01')
    expect(r.windows.filter((w) => w.status !== 'upcoming').map((w) => [w.grantDate, w.taken])).toEqual([
      ['2026-01-01', 1],
      ['2026-04-01', 0],
    ])
  })
})

describe('時間単位の年休', () => {
  const HS = S({ hourlyEnabled: true })
  const e = emp({ hireDate: '2024-04-01', contracts: [{ from: '2024-04-01', daysPerWeek: 5, over30h: true, hoursPerDay: 7.5 }] })
  it('1日は所定労働時間を切り上げた時間（7.5時間 → 8時間）で換算する', () => {
    const r = buildReport(e, [hours('2024-11-05', 2), hours('2024-11-06', 3)], HS, '2024-12-01')
    expect(r.hoursPerDay).toBe(8)
    expect(r.balance).toBeCloseTo(10 - 5 / 8)
    expect(fmtBalance(r.balance, 8, true)).toBe('9日3時間')
  })
  it('時間単位は年5日の取得義務に数えない', () => {
    const r = buildReport(e, [hours('2024-11-05', 8), hours('2024-11-06', 8), leave('2024-12-02')], HS, '2025-01-10')
    expect(r.focus?.taken).toBe(1)
  })
  it('1年に5日分（40時間）を超えたら警告', () => {
    const ls = Array.from({ length: 11 }, (_, i) => hours(`2024-12-${String(i + 1).padStart(2, '0')}`, 4))
    const r = buildReport(e, ls, HS, '2025-01-10')
    expect(r.warnings.some((w) => w.includes('5日分を超えて'))).toBe(true)
  })
  it('設定で使わないのに時間単位の記録があれば警告', () => {
    const r = buildReport(e, [hours('2024-11-05', 2)], S(), '2024-12-01')
    expect(r.warnings.some((w) => w.includes('時間単位'))).toBe(true)
  })
  it('時間単位と全日を合わせて1日を超える日は警告', () => {
    const r = buildReport(e, [hours('2024-11-05', 2), leave('2024-11-05')], HS, '2024-12-01')
    expect(r.warnings.some((w) => w.includes('1日を超えて'))).toBe(true)
  })
})

describe('出勤率の確認', () => {
  const e = emp({ hireDate: '2024-04-01' })
  it('付与日の1か月前から、確認がまだの付与を知らせる', () => {
    expect(buildReport(e, [], S(), '2024-08-30').attendanceDue).toEqual([])
    const r = buildReport(e, [], S(), '2024-09-01')
    expect(r.attendanceDue.map((g) => [g.date, g.periodFrom])).toEqual([['2024-10-01', '2024-04-01']])
  })
  it('確認したら消える。2回目の期間は前回の付与日から', () => {
    const done = { ...e, adjustments: { '2024-10-01': { attendance: { checkedAt: '2024-09-20' } } } }
    expect(buildReport(done, [], S(), '2024-10-15').attendanceDue).toEqual([])
    const r = buildReport(done, [], S(), '2025-09-15')
    expect(r.attendanceDue.map((g) => [g.date, g.periodFrom])).toEqual([['2025-10-01', '2024-10-01']])
  })
  it('設定で切れば知らせない', () => {
    expect(buildReport(e, [], S({ attendanceCheck: false }), '2024-09-15').attendanceDue).toEqual([])
  })
})
