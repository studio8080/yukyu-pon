import * as XLSX from 'xlsx'
import { describe, expect, it } from 'vitest'
import { defaultSettings } from './defaults'
import { buildWorkbook, ledgerRows } from './exporter'
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
