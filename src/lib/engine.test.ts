import { describe, expect, it } from 'vitest'
import { addDays, addMonthsCivil, fmtBalance, parseLooseDate } from './dates'
import { buildReport, grantSchedule, isPlanned, plannedCheck } from './engine'
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
  it('2回目以降は6か月経過日から1年ごと（閏年をまたいでも 2/29 にしない。39条2項）', () => {
    const e = emp({ hireDate: '2025-08-29' })
    expect(sched(e, S(), '2028-12-31').map((x) => x[0])).toEqual(['2026-03-01', '2027-03-01', '2028-03-01'])
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
  it('半休を使わない設定なのに半休の記録があれば警告', () => {
    const e = emp({ hireDate: '2024-04-01' })
    const r = buildReport(e, [leave('2024-11-05', 'am')], S({ halfDayEnabled: false }), '2024-12-01')
    expect(r.warnings.some((w) => w.includes('半日単位'))).toBe(true)
    expect(buildReport(e, [leave('2024-11-05', 'am')], S(), '2024-12-01').warnings).toEqual([])
  })
  it('警告の日付は 2024/11/05 の形で出す', () => {
    const e = emp({ hireDate: '2024-04-01' })
    const r = buildReport(e, [leave('2024-09-05')], S(), '2024-12-01')
    expect(r.warnings.some((w) => w.startsWith('2024/09/05 の取得の時点で'))).toBe(true)
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
  it('期間の途中で退職し、5日に届かなかった期間は判定しない（退職後）', () => {
    const r = buildReport({ ...e, retireDate: '2025-03-31' }, ls, S(), '2025-09-01')
    expect(r.windows[0].status).toBe('retired')
    expect(r.missed).toEqual([])
  })
  it('退職日を先に入れても、在籍中は退職日を期限として知らせる（パンフ Q13・Q14（休職・育休で履行不能な場合）を参考にした有休ポンの扱い）', () => {
    const quitting = { ...e, retireDate: '2025-08-31' }
    const before = buildReport(quitting, ls, S(), '2025-07-15')
    expect(before.windows[0].status).toBe('active')
    expect(before.windows[0].deadline).toBe('2025-08-31')
    expect(before.level).toBe('yellow')
    expect(before.focus?.needed).toBe(3)
    expect(buildReport(quitting, ls, S(), '2025-08-05').level).toBe('red')
    expect(buildReport(quitting, ls, S(), '2025-09-01').windows[0].status).toBe('retired')
  })
  it('休職・育休で取らせられなかった記録があれば、期限を過ぎても未達にしない（パンフ Q13・Q14 を参考にした有休ポンの扱い）', () => {
    const e1 = { ...e, adjustments: { '2024-10-01': { infeasible: { reason: '育児休業で期間中ずっと休業' } } } }
    const after = buildReport(e1, ls, S(), '2025-10-01')
    expect(after.windows[0].status).toBe('infeasible')
    expect(after.windows[0].level).toBe('none')
    expect(after.missed).toEqual([])
    // 期間の途中は、記録があっても知らせ続ける（途中で復帰したら5日が要る。Q14）
    const during = buildReport(e1, ls, S(), '2025-09-01')
    expect(during.windows[0].status).toBe('active')
    expect(during.level).toBe('red')
    // 5日取れていれば達成のまま
    const five = [...ls, leave('2025-06-02'), leave('2025-06-03'), leave('2025-06-04')]
    expect(buildReport(e1, five, S(), '2025-10-01').windows[0].status).toBe('done')
  })
  it('残日数が足りない取得は、年休ではないので5日に数えない', () => {
    const many = Array.from({ length: 12 }, (_, i) => leave(`2024-11-${String(i + 1).padStart(2, '0')}`))
    const r = buildReport(e, many, S(), '2025-01-10')
    expect(r.focus?.taken).toBe(10)
    expect(r.warnings.some((w) => w.includes('足りません'))).toBe(true)
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

describe('計画的付与の確認（39条6項: 5日を超える部分だけ）', () => {
  const days = (from: string, n: number) => Array.from({ length: n }, (_, i) => addDays(from, i))
  const planned = (date: string, how: 'source' | 'note' = 'source'): LeaveRecord =>
    how === 'source' ? { id: date + 'p', employeeId: 'e1', date, kind: 'full', source: 'planned' } : { id: date + 'n', employeeId: 'e1', date, kind: 'full', note: '計画的付与' }

  it('計画的付与の記録は、経緯（source）か、メモの「計画的付与」で見分ける', () => {
    expect(isPlanned(planned('2025-01-01'))).toBe(true)
    expect(isPlanned(planned('2025-01-01', 'note'))).toBe(true)
    expect(isPlanned({ ...planned('2025-01-01', 'note'), source: 'request' })).toBe(false)
    expect(isPlanned(leave('2025-01-01'))).toBe(false)
  })
  it('まだ付与が無い人（入社6か月前）は、年休として登録できない', () => {
    const r = buildReport(emp({ hireDate: '2026-06-01' }), [], S(), '2026-08-01')
    expect(plannedCheck(r, ['2026-08-13', '2026-08-14'])).toEqual({ ok: false, noRights: ['2026-08-13', '2026-08-14'], overFive: [], afterRetire: [] })
  })
  it('10日の人は5日まで。6日目からは、自由に使える日が5日を下回る', () => {
    const r = buildReport(emp({ hireDate: '2024-04-01' }), [], S(), '2024-11-01')
    expect(plannedCheck(r, days('2024-12-25', 5))).toEqual({ ok: true, noRights: [], overFive: [], afterRetire: [] })
    expect(plannedCheck(r, days('2024-12-25', 6)).overFive).toEqual(['2024-12-30'])
  })
  it('半日で登録するときは0.5日ずつ数える', () => {
    const r = buildReport(emp({ hireDate: '2024-04-01' }), [], S(), '2024-11-01')
    expect(plannedCheck(r, days('2024-12-20', 10), 0.5).ok).toBe(true)
    expect(plannedCheck(r, days('2024-12-20', 11), 0.5).overFive).toEqual(['2024-12-30'])
  })
  it('比例付与で5日の人は、計画的付与にできる日が無い', () => {
    const p = emp({ hireDate: '2024-04-01', contracts: [{ from: '2024-04-01', daysPerWeek: 3, over30h: false }] })
    const r = buildReport(p, [], S(), '2024-11-01')
    expect(plannedCheck(r, ['2024-12-28']).overFive).toEqual(['2024-12-28'])
  })
  it('前年からの繰越分も含めて数える（10日繰越＋11日＝21日なら16日まで）', () => {
    const r = buildReport(emp({ hireDate: '2023-04-01' }), [], S(), '2024-11-01')
    expect(plannedCheck(r, days('2024-12-01', 16)).ok).toBe(true)
    expect(plannedCheck(r, days('2024-12-01', 17)).overFive).toEqual(['2024-12-17'])
  })
  it('同じ期間にすでにある計画的付与（メモの記録も）と合わせて数える', () => {
    const before = [planned('2024-11-05'), planned('2024-11-06', 'note'), leave('2024-11-07')]
    const r = buildReport(emp({ hireDate: '2024-04-01' }), before, S(), '2024-11-10')
    // 10日 − 本人の取得1日は関係なく、計画的付与の合計で見る: 既存2日＋新しく3日 = 5日
    expect(plannedCheck(r, days('2024-12-25', 3)).ok).toBe(true)
    expect(plannedCheck(r, days('2024-12-25', 4)).overFive).toEqual(['2024-12-28'])
    // 登録済みの日をもう一度選んでも、二重に数えない
    expect(plannedCheck(r, ['2024-11-05', ...days('2024-12-25', 3)]).ok).toBe(true)
  })
  it('次の付与より後の日は、次の付与＋繰越（それまでの予定を引いた残り）で見る', () => {
    const e = emp({ hireDate: '2024-04-01' }) // 2024-10-01 に10日、2025-10-01 に11日
    const r = buildReport(e, [], S(), '2025-08-01')
    expect(plannedCheck(r, days('2025-08-11', 6)).overFive).toEqual(['2025-08-16'])
    expect(plannedCheck(r, days('2025-12-01', 16)).ok).toBe(true)
    // 次の付与までに5日の予定（本人の請求）があると、繰越は5日になる → 11＋5＝16日、計画的付与は11日まで
    const r2 = buildReport(e, days('2025-09-01', 5).map((d) => leave(d)), S(), '2025-08-01')
    expect(plannedCheck(r2, days('2025-12-01', 11)).ok).toBe(true)
    expect(plannedCheck(r2, days('2025-12-01', 12)).overFive).toEqual(['2025-12-12'])
  })
  it('退職日より後の日は登録しない', () => {
    const r = buildReport(emp({ hireDate: '2024-04-01', retireDate: '2024-12-26' }), [], S(), '2024-11-01')
    expect(plannedCheck(r, ['2024-12-26', '2024-12-27'])).toEqual({ ok: false, noRights: [], overFive: [], afterRetire: ['2024-12-27'] })
  })
})
