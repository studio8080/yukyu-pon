// 年次有給休暇管理簿（労基則24条の7: 基準日・日数・時季を労働者ごとに）を作る。

import { addMonthsCivil, fmt, fmtDays, minDate, type ISODate } from './dates'
import { buildReport, contractAt, contractLabel, recordDays, TENURE_LABEL, type Report } from './engine'
import { leaveLabel, type Employee, type LeaveRecord, type Settings } from './types'
import { windowLabel } from './view'

export type LedgerRow = {
  code: string
  name: string
  hireDate: ISODate
  contract: string
  grantDate: ISODate
  tenure: string
  statutory: number
  days: number
  skipped: boolean
  periodEnd: ISODate
  dates: LeaveRecord[]
  /** 取得日数（時間単位も日に換算して含む） */
  taken: number
  /** 全日・半休の日数（時間単位を除く） */
  takenFull: number
  /** 時間単位の時間数 */
  takenHours: number
  balanceAtEnd: number
  obligation: string
}

/** year = 直近1年、retention = 設定の保存期間に入る分、all = すべて */
export type LedgerRange = 'year' | 'retention' | 'all'

/**
 * 保存期間に入る付与か。労基則24条の7 の「期間の満了後」の起点を広めにとり、
 * その付与分が時効（2年）で消えた日から、設定の年数（5年 または 当分の間の3年）を数える。
 */
export function withinRetention(grantDate: ISODate, settings: Settings, asOf: ISODate): boolean {
  return addMonthsCivil(grantDate, 24 + 12 * settings.ledgerRetentionYears) > asOf
}

/** 管理簿の「取得日数」。時間単位は日に丸めず「1日＋3時間」と書く */
export function takenText(r: Pick<LedgerRow, 'takenFull' | 'takenHours'>): string {
  if (r.takenHours <= 0) return fmtDays(r.takenFull)
  return r.takenFull > 0 ? `${fmtDays(r.takenFull)}＋${r.takenHours}時間` : `${r.takenHours}時間`
}

export function ledgerRows(employees: Employee[], leaves: LeaveRecord[], settings: Settings, asOf: ISODate, range: LedgerRange, includeRetired: boolean): LedgerRow[] {
  const from = range === 'year' ? addMonthsCivil(asOf, -12) : '0000-01-01'
  const out: LedgerRow[] = []
  for (const e of employees) {
    const r = buildReport(e, leaves, settings, asOf)
    if (!includeRetired && !r.active) continue
    for (const p of r.periods) {
      if (p.periodEnd < from) continue
      if (range === 'retention' && !withinRetention(p.grant.date, settings, asOf)) continue
      const end = minDate(p.periodEnd, asOf)
      const atEnd: Report = end === asOf ? r : buildReport(e, leaves, settings, end)
      const w = r.windows.find((x) => x.grantDate === p.grant.date) ?? null
      out.push({
        code: e.code,
        name: e.name,
        hireDate: e.hireDate,
        contract: p.grant.contract ? contractLabel(p.grant.contract) : contractAt(e, p.grant.date) ? contractLabel(contractAt(e, p.grant.date)!) : '',
        grantDate: p.grant.date,
        tenure: TENURE_LABEL[Math.min(p.grant.step, 6)],
        statutory: p.grant.statutory,
        days: p.grant.days,
        skipped: p.grant.skipped,
        periodEnd: p.periodEnd,
        dates: p.dates,
        taken: p.takenDays,
        takenFull: Math.round(p.dates.filter((d) => d.kind !== 'hours').reduce((s, d) => s + recordDays(e, d), 0) * 10) / 10,
        takenHours: p.takenHours,
        balanceAtEnd: atEnd.balance,
        obligation: w ? `${windowLabel(w)}（期限 ${fmt(w.deadline)}）` : '対象外',
      })
    }
  }
  return out
}

export function datesText(ds: LeaveRecord[]): string {
  return ds.map((d) => `${fmt(d.date)}${d.kind === 'full' ? '' : d.kind === 'am' ? '午前' : d.kind === 'pm' ? '午後' : `(${d.hours}時間)`}`).join('、')
}

type XLSXModule = typeof import('xlsx')

export async function exportExcel(rows: LedgerRow[], employees: Employee[], leaves: LeaveRecord[], settings: Settings, asOf: ISODate) {
  const XLSX = await import('xlsx')
  XLSX.writeFile(buildWorkbook(XLSX, rows, employees, leaves, settings, asOf), `年次有給休暇管理簿_${asOf}.xlsx`)
}

export function buildWorkbook(XLSX: XLSXModule, rows: LedgerRow[], employees: Employee[], leaves: LeaveRecord[], settings: Settings, asOf: ISODate) {
  const companyName = settings.companyName
  const wb = XLSX.utils.book_new()

  const head = ['社員番号', '氏名', '入社日', '基準日（付与日）', '勤続', 'その日の契約', '法定の付与日数', '付与日数', '期間の終わり', '取得日数', '取得した日（時季）', '期間末の残日数', '年5日の取得義務']
  const body = rows.map((r) => [
    r.code,
    r.name,
    fmt(r.hireDate),
    fmt(r.grantDate),
    r.tenure,
    r.contract,
    r.statutory,
    r.skipped ? '0（出勤率8割未満）' : r.days,
    fmt(r.periodEnd),
    r.takenHours > 0 ? takenText(r) : r.taken,
    datesText(r.dates),
    r.periodEnd > asOf ? `${r.balanceAtEnd}（${fmt(asOf)}現在）` : r.balanceAtEnd,
    r.obligation,
  ])
  const title = [`年次有給休暇管理簿${companyName ? `（${companyName}）` : ''}`, '', `作成日 ${fmt(asOf)}`]
  const ws = XLSX.utils.aoa_to_sheet([title, [], head, ...body])
  ws['!cols'] = [8, 14, 11, 14, 9, 18, 8, 8, 12, 8, 50, 10, 30].map((wch) => ({ wch }))
  XLSX.utils.book_append_sheet(wb, ws, '管理簿')

  const bal = employees.map((e) => {
    const r = buildReport(e, leaves, settings, asOf)
    return [e.code, e.name, fmt(e.hireDate), r.active ? '在籍' : `退職 ${fmt(e.retireDate)}`, r.balance, r.nextGrant ? fmt(r.nextGrant.date) : '', r.nextGrant?.days ?? '', windowLabel(r.focus), r.focus ? fmt(r.focus.deadline) : '', r.focus?.taken ?? '']
  })
  const ws2 = XLSX.utils.aoa_to_sheet([[`${fmt(asOf)} 時点`], [], ['社員番号', '氏名', '入社日', '在籍', '残日数', '次の付与日', '次の付与日数', '年5日の状況', '期限', '取得済み'], ...bal])
  ws2['!cols'] = [8, 14, 11, 16, 8, 12, 10, 18, 12, 8].map((wch) => ({ wch }))
  XLSX.utils.book_append_sheet(wb, ws2, '残日数')

  const nameOf = new Map(employees.map((e) => [e.id, e]))
  const recs = [...leaves].sort((a, b) => (a.date < b.date ? -1 : 1)).map((l) => [nameOf.get(l.employeeId)?.code ?? '', nameOf.get(l.employeeId)?.name ?? '', fmt(l.date), leaveLabel(l), nameOf.get(l.employeeId) ? Math.round(recordDays(nameOf.get(l.employeeId)!, l) * 1000) / 1000 : '', l.note ?? ''])
  const ws3 = XLSX.utils.aoa_to_sheet([['社員番号', '氏名', '取得日', '区分', '日数', 'メモ'], ...recs])
  ws3['!cols'] = [8, 14, 12, 10, 6, 24].map((wch) => ({ wch }))
  XLSX.utils.book_append_sheet(wb, ws3, '取得記録')
  return wb
}
