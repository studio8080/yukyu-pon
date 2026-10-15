import { describe, expect, it } from 'vitest'
import { BACKUP_FORMAT, parseBackup } from './store'

const backup = (employees: unknown[], leaves: unknown[], settings: unknown = {}) => JSON.stringify({ format: BACKUP_FORMAT, version: 2, settings, employees, leaves })
const emp = (adjustments: unknown = {}) => ({ id: 'e1', code: '', name: 'テスト', hireDate: '2024-04-01', contracts: [], openingLots: [], adjustments, extraGrants: [], memo: '' })

describe('バックアップの読み込み', () => {
  it('古いバックアップ（経緯・事情の記録が無い）もそのまま読める', () => {
    const d = parseBackup(backup([emp({ '2024-10-01': { days: 12 } })], [{ id: 'l1', employeeId: 'e1', date: '2024-11-01', kind: 'full', note: '計画的付与' }]))
    expect(d.leaves[0].source).toBeUndefined()
    expect(d.leaves[0].note).toBe('計画的付与')
    expect(d.employees[0].adjustments['2024-10-01']).toEqual({ days: 12 })
    expect(d.settings.designationRuleConfirmedAt).toBeUndefined()
  })
  it('取得の経緯は3つの値だけを読み、ほかは捨てる', () => {
    const ls = ['request', 'designated', 'planned', 'boss', 3].map((source, i) => ({ id: `l${i}`, employeeId: 'e1', date: '2024-11-01', kind: 'full', source }))
    expect(parseBackup(backup([emp()], ls)).leaves.map((l) => l.source)).toEqual(['request', 'designated', 'planned', undefined, undefined])
  })
  it('休職・育休の記録は、理由が文字のときだけ読む', () => {
    const d = parseBackup(
      backup([emp({ '2024-10-01': { infeasible: { reason: '育児休業' } }, '2025-10-01': { infeasible: true, note: 'x' }, '2026-10-01': { infeasible: { reason: 5 } } })], []),
    )
    expect(d.employees[0].adjustments['2024-10-01'].infeasible).toEqual({ reason: '育児休業' })
    expect(d.employees[0].adjustments['2025-10-01']).toEqual({ note: 'x' })
    expect(d.employees[0].adjustments['2026-10-01']).toEqual({})
  })
})
