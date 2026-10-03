// 読み取った表 → 取り込みの計画（新規・更新・エラー）。画面で確認してから反映する。

import { addMonthsCivil, parseLooseDate, parts, type ISODate } from './dates'
import { newId } from './defaults'
import { contractAt, grantSchedule } from './engine'
import { parseDateList, parseKind, parseNumber, parseOver30, type EmployeeField, type LeaveField, type Table } from './importer'
import type { Contract, Employee, LeaveRecord, OpeningLot, Settings } from './types'

export type PlanRow = {
  line: number
  label: string
  status: 'new' | 'update' | 'error'
  errors: string[]
  notes: string[]
  employee?: Employee
  leaves: Omit<LeaveRecord, 'id'>[]
}

const key = (s: string) => s.normalize('NFKC').replace(/\s+/g, '')

function finder(existing: Employee[]) {
  const byCode = new Map(existing.filter((e) => e.code).map((e) => [key(e.code), e]))
  const byName = new Map<string, Employee[]>()
  for (const e of existing) byName.set(key(e.name), [...(byName.get(key(e.name)) ?? []), e])
  return (code: string, name: string): { emp?: Employee; error?: string } => {
    if (code && byCode.has(key(code))) return { emp: byCode.get(key(code)) }
    const hit = byName.get(key(name)) ?? []
    if (hit.length > 1) return { error: `同じ名前の人が${hit.length}人います。社員番号の列を入れてください。` }
    return { emp: hit[0] }
  }
}

const cell = (row: string[], idx: number | undefined) => (idx == null ? '' : String(row[idx] ?? '').trim())

/** 残日数を、直近の付与から順に付与日ごとへ割り当てる（時効を計算するため） */
export function splitBalance(emp: Employee, settings: Settings, asOf: ISODate, balance: number): { lots: OpeningLot[]; note: string } {
  const grants = grantSchedule(emp, settings, asOf).filter((g) => g.days > 0 && addMonthsCivil(g.date, 24) > asOf)
  const lots: OpeningLot[] = []
  let rest = balance
  for (let i = grants.length - 1; i >= 0 && rest > 0; i--) {
    const g = grants[i]
    const take = i === 0 ? rest : Math.min(rest, g.days)
    lots.push({ id: newId(), grantDate: g.date, days: take })
    rest -= take
  }
  if (lots.length === 0 && balance > 0) {
    lots.push({ id: newId(), grantDate: asOf, days: balance })
    return { lots, note: `付与日が見当たらないため、残${balance}日を${asOf}付与として扱います。` }
  }
  const desc = lots.map((l) => `${l.grantDate}付与分 ${l.days}日`).join('、')
  return { lots: lots.reverse(), note: `残日数を直近の付与から順に割り当てました（推定: ${desc}）。` }
}

export function planEmployees(
  table: Table,
  headerRow: number,
  map: Partial<Record<EmployeeField, number>>,
  existing: Employee[],
  settings: Settings,
  asOf: ISODate,
  /** 移行（残日数の列）のときの管理開始日。既定は集計日 */
  trackingStart: ISODate = asOf,
): PlanRow[] {
  const find = finder(existing)
  const rows: PlanRow[] = []
  const seen = new Set<string>()
  for (let i = headerRow + 1; i < table.length; i++) {
    const r = table[i]
    const name = cell(r, map.name)
    const code = cell(r, map.code)
    if (!name && !code) continue
    const errors: string[] = []
    const notes: string[] = []
    const hire = parseLooseDate(cell(r, map.hire))
    if (!name) errors.push('氏名が空です')
    if (!hire) errors.push(cell(r, map.hire) ? `入社日「${cell(r, map.hire)}」が読めません` : '入社日が空です')
    const k = code ? `c:${key(code)}` : `n:${key(name)}`
    if (seen.has(k)) errors.push('同じ人が表の中に2回出てきます')
    seen.add(k)

    // 契約
    const daysRaw = cell(r, map.days)
    const annualRaw = cell(r, map.annual)
    let days = daysRaw ? parseNumber(daysRaw) : null
    const annual = annualRaw ? parseNumber(annualRaw) : null
    if (daysRaw && (days == null || days < 0 || days > 7)) errors.push(`週の勤務日数「${daysRaw}」が読めません`)
    if (days == null && annual == null) days = 5
    const over30Raw = cell(r, map.hours)
    let over30 = parseOver30(over30Raw)
    if (over30Raw && over30 == null) errors.push(`週の労働時間「${over30Raw}」が読めません`)
    if (over30 == null) {
      over30 = (days ?? 0) >= 5
      if (map.hours == null && days != null && days < 5) notes.push('労働時間の列が無いため、週30時間未満として計算します')
    }
    const retireRaw = cell(r, map.retire)
    const retire = retireRaw ? parseLooseDate(retireRaw) : null
    if (retireRaw && !retire) errors.push(`退職日「${retireRaw}」が読めません`)

    const found = find(code, name)
    if (found.error) errors.push(found.error)
    if (errors.length || !hire) {
      rows.push({ line: i + 1, label: name || code, status: 'error', errors, notes, leaves: [] })
      continue
    }

    const contract: Contract = {
      from: hire,
      daysPerWeek: days != null ? Math.min(5, Math.max(0, Math.round(days))) : 0,
      annualDays: days == null || days === 0 ? annual ?? undefined : undefined,
      over30h: over30,
    }
    let emp: Employee
    if (found.emp) {
      const cur = contractAt(found.emp, asOf)
      const changed = !cur || cur.daysPerWeek !== contract.daysPerWeek || cur.over30h !== contract.over30h || (cur.annualDays ?? 0) !== (contract.annualDays ?? 0)
      const contracts = changed ? [...found.emp.contracts.filter((c) => c.from < asOf), { ...contract, from: found.emp.contracts.length ? asOf : hire }] : found.emp.contracts
      if (changed && found.emp.contracts.length) notes.push(`契約の変更として ${asOf} から反映します`)
      if (found.emp.hireDate !== hire) notes.push(`入社日を ${found.emp.hireDate} → ${hire} に直します`)
      emp = { ...found.emp, name: name || found.emp.name, code: code || found.emp.code, hireDate: hire, retireDate: retire ?? found.emp.retireDate, contracts }
    } else {
      emp = {
        id: newId(),
        code,
        name,
        hireDate: hire,
        retireDate: retire,
        contracts: [contract],
        trackingStart: null,
        openingLots: [],
        adjustments: {},
        extraGrants: [],
        memo: '',
      }
    }

    // 移行（今の残日数）
    const balRaw = cell(r, map.balance)
    if (balRaw) {
      const bal = parseNumber(balRaw)
      if (bal == null || bal < 0) {
        rows.push({ line: i + 1, label: name, status: 'error', errors: [`残日数「${balRaw}」が読めません`], notes, leaves: [] })
        continue
      }
      const { lots, note } = splitBalance(emp, settings, trackingStart, bal)
      emp = { ...emp, trackingStart, openingLots: lots }
      notes.push(`${trackingStart} から管理を始めます。${note}`)
    }

    // 取得日（1つのセルに複数）
    const leaves: Omit<LeaveRecord, 'id'>[] = []
    const takenRaw = cell(r, map.taken)
    if (takenRaw) {
      const p = parseDateList(takenRaw, parts(asOf)[0])
      if (p.bad.length) {
        rows.push({ line: i + 1, label: name, status: 'error', errors: [`取得日「${p.bad.join('、')}」が読めません`], notes, leaves: [] })
        continue
      }
      if (p.guessed) notes.push(`年の無い取得日は ${parts(asOf)[0]}年として読みました`)
      for (const date of p.dates) leaves.push({ employeeId: emp.id, date, kind: 'full' })
    }
    rows.push({ line: i + 1, label: name, status: found.emp ? 'update' : 'new', errors: [], notes, employee: emp, leaves })
  }
  return rows
}

export function planLeaves(table: Table, headerRow: number, map: Partial<Record<LeaveField, number>>, existing: Employee[], asOf: ISODate): PlanRow[] {
  const find = finder(existing)
  const rows: PlanRow[] = []
  for (let i = headerRow + 1; i < table.length; i++) {
    const r = table[i]
    const name = cell(r, map.name)
    const code = cell(r, map.code)
    const dateRaw = cell(r, map.date)
    if (!name && !code && !dateRaw) continue
    const errors: string[] = []
    const f = find(code, name)
    if (f.error) errors.push(f.error)
    else if (!f.emp) errors.push(`「${name || code}」さんが従業員にいません（先に名簿を取り込んでください）`)
    const k = parseKind(cell(r, map.kind))
    if (!k) errors.push(`区分「${cell(r, map.kind)}」が読めません`)
    const p = parseDateList(dateRaw, parts(asOf)[0])
    if (!dateRaw) errors.push('取得日が空です')
    if (p.bad.length) errors.push(`取得日「${p.bad.join('、')}」が読めません`)
    if (errors.length || !f.emp || !k) {
      rows.push({ line: i + 1, label: name || code, status: 'error', errors, notes: [], leaves: [] })
      continue
    }
    const notes = p.guessed ? [`年の無い日付は ${parts(asOf)[0]}年として読みました`] : []
    rows.push({
      line: i + 1,
      label: f.emp.name,
      status: 'new',
      errors: [],
      notes,
      leaves: p.dates.map((date) => ({ employeeId: f.emp!.id, date, kind: k.kind, ...(k.hours ? { hours: k.hours } : {}) })),
    })
  }
  return rows
}
