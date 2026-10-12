import * as XLSX from 'xlsx'
import { describe, expect, it } from 'vitest'
import { addDays } from './dates'
import { defaultSettings } from './defaults'
import { buildWorkbook, ledgerRows, takenText } from './exporter'
import { makeSample } from './sample'

describe('管理簿の出力', () => {
  const asOf = '2026-10-03'
  const { employees, leaves } = makeSample(asOf)
  const rows = ledgerRows(employees, leaves, defaultSettings, asOf, 'all', true)

  it('基準日・日数・時季（取得日）が人ごとに並ぶ', () => {
    const sato = rows.filter((r) => r.name === '佐藤 花子')
    expect(sato.map((r) => [r.grantDate, r.days])).toEqual([
      ['2022-11-03', 10], ['2023-11-03', 11], ['2024-11-03', 12], ['2025-11-03', 14],
    ])
    expect(sato[3].taken).toBe(2)
    expect(sato[3].balanceAtEnd).toBe(24)
  })

  it('作成日より後の予定は、取得した日（時季）に載せない', () => {
    const w = rows.filter((r) => r.name === '渡辺 さくら').at(-1)!
    expect(w.dates.every((d) => d.date <= asOf)).toBe(true)
    expect(w.taken).toBe(1)
  })

  it('保存期間は設定の年数で絞る（時効で消えた日から数えて多めに載せる）', () => {
    const sato = (years: 3 | 5, on: string) =>
      ledgerRows(employees, leaves, { ...defaultSettings, ledgerRetentionYears: years }, on, 'retention', true)
        .filter((r) => r.name === '佐藤 花子')
        .map((r) => r.grantDate)
    // 2022-11-03 付与分は 2024-11-03 に時効。3年なら 2027-11-03 まで、5年なら 2029-11-03 まで載せる
    expect(sato(3, '2027-11-02')[0]).toBe('2022-11-03')
    expect(sato(3, '2027-11-03')[0]).toBe('2023-11-03')
    expect(sato(5, '2029-11-02')[0]).toBe('2022-11-03')
  })

  it('時間単位の取得は「日」と「時間」を分けて書く', () => {
    const e = { ...employees[0], contracts: [{ ...employees[0].contracts[0], hoursPerDay: 8 }] }
    const g = rows.find((r) => r.name === e.name)!.grantDate
    const ls = [
      { id: 'h1', employeeId: e.id, date: addDays(g, 3), kind: 'hours' as const, hours: 3 },
      { id: 'f1', employeeId: e.id, date: addDays(g, 4), kind: 'full' as const },
    ]
    const r = ledgerRows([e], ls, { ...defaultSettings, hourlyEnabled: true }, asOf, 'all', true).find((x) => x.grantDate === g)!
    expect(takenText(r)).toBe('1日＋3時間')
  })

  it('Excel に3枚のシートを作り、読み戻せる', () => {
    const wb = buildWorkbook(XLSX, rows, employees, leaves, { ...defaultSettings, companyName: 'テスト商店' }, asOf)
    expect(wb.SheetNames).toEqual(['管理簿', '残日数', '取得記録'])
    const back = XLSX.read(XLSX.write(wb, { type: 'array', bookType: 'xlsx' }), { type: 'array' })
    const aoa = XLSX.utils.sheet_to_json<string[]>(back.Sheets['管理簿'], { header: 1 })
    expect(String(aoa[0][0])).toContain('テスト商店')
    expect(aoa.length).toBe(3 + rows.length)
    expect(String(aoa[3 + rows.findIndex((r) => r.name === '佐藤 花子')][10])).toMatch(/^2022\/11\/23/)
  })
})
