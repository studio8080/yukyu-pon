import { expect, it } from 'vitest'
import { buildReport, plannedCheck } from './engine'
import { defaultSettings } from './defaults'
import type { Employee, LeaveRecord } from './types'

const employee: Employee = {
  id: 'planned-fixture', code: 'TEST', name: '計画確認テスト（架空）', hireDate: '2026-04-01',
  contracts: [{ from: '2026-04-01', daysPerWeek: 5, over30h: true }],
  openingLots: [], adjustments: {}, extraGrants: [], memo: '',
}
const records = (confirmation?: LeaveRecord['confirmation'], future = false): LeaveRecord[] =>
  Array.from({ length: 5 }, (_, i) => ({
    id: `plan-${i}`, employeeId: employee.id, date: `2026-${future ? '11' : '10'}-0${i + 2}`,
    kind: 'full', source: 'planned', confirmation,
  }))
const report = (leaves: LeaveRecord[], asOf = '2026-10-25') => buildReport(employee, leaves, defaultSettings, asOf)

it('付与10日・過去未確認の計画5日は未来の計画1日を妨げない', () => {
  const r = report(records('pending'))
  expect(r.balance).toBe(10)
  expect(r.focus?.taken).toBe(0)
  expect(r.focus?.planned).toBe(0)
  expect(r.uses).toHaveLength(5) // 未確認を画面で確認するための明細は残す
  expect(plannedCheck(r, ['2026-11-01'])).toEqual({ ok: true, noRights: [], overFive: [], afterRetire: [] })
})

it('取得済み・旧形式・legacyの計画5日は従来どおり6日目を警告する', () => {
  for (const state of ['taken', 'legacy', undefined] as const) {
    const r = report(records(state))
    expect(r.balance).toBe(5)
    expect(plannedCheck(r, ['2026-11-01']).overFive).toEqual(['2026-11-01'])
  }
})

it('未来の未確認計画5日は見込みに数え、6日目を警告する', () => {
  const r = report(records('pending', true))
  expect(r.balance).toBe(10)
  expect(r.focus?.planned).toBe(5)
  expect(plannedCheck(r, ['2026-11-10']).overFive).toEqual(['2026-11-10'])
})

it('同じ未確認計画でも、予定日を過ぎると計画登録の見込みから外れる', () => {
  const leaves = records('pending')
  expect(plannedCheck(report(leaves, '2026-10-01'), ['2026-11-01']).overFive).toEqual(['2026-11-01'])
  expect(plannedCheck(report(leaves, '2026-10-06'), ['2026-11-01']).ok).toBe(true)
})

it('取消・延期元は過去でも未来でも計画登録の見込みに数えない', () => {
  for (const state of ['cancelled', 'postponed'] as const) for (const future of [false, true]) {
    expect(plannedCheck(report(records(state, future)), ['2026-11-10']).ok).toBe(true)
  }
})

it('すでに登録された過去未確認の日の再選択は新しい計画として二重に数えない', () => {
  const leaves = [...records('pending'), ...records('pending', true).map(l => ({ ...l, id: `future-${l.id}` }))]
  expect(plannedCheck(report(leaves), ['2026-10-02']).ok).toBe(true)
})
