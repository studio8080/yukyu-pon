import { describe, expect, it, vi, afterEach } from 'vitest'
import { migrateLeaves, reviewRecord } from './leaveReview'
import { buildReport } from './engine'
import { ledgerRows } from './exporter'
import { defaultSettings } from './defaults'
import type { Employee, LeaveRecord } from './types'
import { makeBackup, parseBackup, useStore } from '../store'

const e: Employee = { id: 'e', code: '001', name: '架空の従業員', hireDate: '2025-01-01', contracts: [{ from: '2025-01-01', daysPerWeek: 5, over30h: true }], openingLots: [], adjustments: {}, extraGrants: [], memo: '' }
const l = (date: string, p: Partial<LeaveRecord> = {}): LeaveRecord => ({ id: date, employeeId: 'e', date, kind: 'full', ...p })
const report = (ls: LeaveRecord[], asOf = '2026-10-25') => buildReport(e, ls, defaultSettings, asOf)
afterEach(() => vi.useRealTimers())
describe('月次確認と後方互換', () => {
  it('旧過去記録の残高・年5日・管理簿を変更しない', () => {
    const old = [l('2026-08-01'), l('2026-09-01', { kind: 'am' })], migrated = migrateLeaves(old, '2026-10-25')
    const before = report(old), after = report(migrated)
    expect(after.balance).toBe(before.balance); expect(after.windows).toEqual(before.windows)
    expect(after.periods.map(p => [p.takenDays, p.takenHours])).toEqual(before.periods.map(p => [p.takenDays, p.takenHours]))
    expect(migrated.every(x => x.confirmation === 'legacy')).toBe(true)
  })
  it('旧未来予定は移行時に未確認になり日付経過だけで計上しない', () => {
    const ls = migrateLeaves([l('2026-10-26')], '2026-10-25')
    expect(ls[0].confirmation).toBe('pending')
    expect(report(ls, '2026-10-27').balance).toBe(report([], '2026-10-27').balance)
    expect(report(ls, '2026-10-27').focus?.taken).toBe(0)
    expect(report(ls, '2026-10-27').periods.flatMap(p => p.dates)).toHaveLength(0)
    expect(report(ls, '2026-10-25').focus?.planned).toBe(1)
    expect(report(ls, '2026-10-27').focus?.planned).toBe(0)
  })
  it('取得確認で初めて残高・年5日・管理簿に反映する', () => {
    const taken = reviewRecord(l('2026-10-01', { confirmation: 'pending' }), 'taken', undefined, '2026-10-25')
    expect(report([taken]).balance).toBe(report([]).balance - 1)
    expect(report([taken]).focus?.taken).toBe(1)
    expect(ledgerRows([e], [taken], defaultSettings, '2026-10-25', 'all', true).at(-1)?.taken).toBe(1)
  })
  it('取消・延期元は残高・実績・未来見込みに入れない', () => {
    for (const confirmation of ['cancelled', 'postponed'] as const) {
      for (const date of ['2026-10-01', '2026-10-26']) {
        const r = report([l(date, { confirmation })]); expect(r.balance).toBe(report([]).balance); expect(r.focus?.taken).toBe(0); expect(r.focus?.planned).toBe(0)
      }
    }
  })
  it('未来の取得確認と不正な延期日を拒否する', () => {
    expect(() => reviewRecord(l('2026-10-26'), 'taken', undefined, '2026-10-25')).toThrow()
    for (const d of ['2026-10-25', '2026-02-30', 'no']) expect(() => reviewRecord(l('2026-10-01'), 'postponed', d, '2026-10-25')).toThrow()
  })
  it('時間単位は取得確認しても年5日に入れない', () => {
    const r = buildReport(e, [l('2026-10-01', { confirmation: 'taken', kind: 'hours', hours: 2 })], { ...defaultSettings, hourlyEnabled: true }, '2026-10-25')
    expect(r.balance).toBe(report([]).balance - 0.25); expect(r.focus?.taken).toBe(0)
  })
  it('確認状態・延期先・確認日をバックアップで往復し、不明状態は未確認に倒す', () => {
    const leaves = [l('2026-10-01', { confirmation: 'postponed', postponedTo: '2026-11-01', reviewedAt: '2026-10-25' }), l('2026-11-01', { confirmation: 'pending', originId: '2026-10-01' })]
    const d = parseBackup(makeBackup({ settings: defaultSettings, employees: [e], leaves }))
    expect(d.leaves).toEqual(leaves)
    const corrupt = JSON.parse(makeBackup(d)); corrupt.leaves[0].confirmation = 'unknown'
    expect(parseBackup(JSON.stringify(corrupt)).leaves[0].confirmation).toBe('pending')
  })
  it('ストアの延期は元記録と新予定を残し、重複や二重延期を拒否する', () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-25T12:00:00Z'))
    useStore.setState({ employees: [e], leaves: [l('2026-10-01', { confirmation: 'pending' })] })
    const s = useStore.getState(); s.reviewLeave('2026-10-01', 'postponed', '2026-11-01')
    const ls = useStore.getState().leaves
    expect(ls).toHaveLength(2); expect(ls[0].confirmation).toBe('postponed'); expect(ls[1].originId).toBe(ls[0].id); expect(ls[1].confirmation).toBe('pending')
    expect(() => s.reviewLeave('2026-10-01', 'postponed', '2026-12-01')).toThrow()
    expect(() => s.reviewLeave('2026-10-01', 'taken')).toThrow()
    expect(s.addLeaves([l('2026-11-01')])).toBe(0)
  })
  it('新規未来と過去の記録を集計日から独立して登録する', () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-25T12:00:00Z'))
    useStore.setState({ employees: [e], leaves: [], asOf: '2030-01-01' })
    useStore.getState().addLeaves([l('2026-10-01'), l('2026-11-01')])
    expect(useStore.getState().leaves.map(l => l.confirmation)).toEqual(['taken', 'pending'])
  })
})
