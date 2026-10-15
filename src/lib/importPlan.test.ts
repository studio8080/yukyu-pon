import { describe, expect, it } from 'vitest'
import { defaultSettings } from './defaults'
import { planEmployees } from './importPlan'
import type { Employee } from './types'

const part: Employee = {
  id: 'p1',
  code: '003',
  name: '田中 美咲',
  hireDate: '2024-02-12',
  retireDate: null,
  contracts: [{ from: '2024-02-12', daysPerWeek: 4, over30h: false, hoursPerDay: 6 }],
  trackingStart: null,
  openingLots: [],
  adjustments: {},
  extraGrants: [],
  memo: '',
}
const asOf = '2026-10-12'

describe('名簿の取り込み（更新）', () => {
  it('週の勤務日数の列が無い名簿では、いまの契約を変えない', () => {
    const [row] = planEmployees([['氏名', '入社日', '社員番号'], ['田中 美咲', '2024/2/12', '003']], 0, { name: 0, hire: 1, code: 2 }, [part], defaultSettings, asOf)
    expect(row.status).toBe('update')
    expect(row.employee?.contracts).toEqual(part.contracts)
    expect(row.notes.join()).not.toContain('契約の変更')
    expect(row.notes.join()).toContain('いまの契約（週4日）のまま')
  })

  it('勤務日数の欄が空の行も、いまの契約を変えない', () => {
    const [row] = planEmployees([['氏名', '入社日', '週の勤務日数'], ['田中 美咲', '2024/2/12', '']], 0, { name: 0, hire: 1, days: 2 }, [part], defaultSettings, asOf)
    expect(row.employee?.contracts).toEqual(part.contracts)
  })

  it('労働時間の列が無くても、日数が同じなら週30時間以上の区分を引き継ぐ', () => {
    const over = { ...part, contracts: [{ from: '2024-02-12', daysPerWeek: 4, over30h: true }] }
    const [row] = planEmployees([['氏名', '入社日', '週の勤務日数'], ['田中 美咲', '2024/2/12', '4']], 0, { name: 0, hire: 1, days: 2 }, [over], defaultSettings, asOf)
    expect(row.employee?.contracts).toEqual(over.contracts)
  })

  it('日数が変わったときは契約の変更として足し、1日の所定労働時間は引き継ぐ', () => {
    const [row] = planEmployees([['氏名', '入社日', '週の勤務日数'], ['田中 美咲', '2024/2/12', '5']], 0, { name: 0, hire: 1, days: 2 }, [part], defaultSettings, asOf)
    expect(row.employee?.contracts).toEqual([part.contracts[0], { from: asOf, daysPerWeek: 5, over30h: true, hoursPerDay: 6 }])
    expect(row.notes.join()).toContain('契約の変更')
  })

  it('新しい人は、列が無ければ週5日として登録する', () => {
    const [row] = planEmployees([['氏名', '入社日'], ['新人 一郎', '2026/4/1']], 0, { name: 0, hire: 1 }, [part], defaultSettings, asOf)
    expect(row.status).toBe('new')
    expect(row.employee?.contracts).toEqual([{ from: '2026-04-01', daysPerWeek: 5, over30h: true }])
  })
})
