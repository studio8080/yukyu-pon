// Excel / CSV / 貼り付けた表を読む。列は見出しの名前で推定し、画面で直せるようにする。
// ファイルの中身はブラウザの外に出さない。

import { parseLooseDate, type ISODate } from './dates'
import type { LeaveKind } from './types'

export type Table = string[][] // 1行目は見出しとは限らない
export type Cell = string | number | boolean | Date | null | undefined

export type EmployeeField = 'name' | 'code' | 'hire' | 'days' | 'hours' | 'annual' | 'retire' | 'balance' | 'taken'
export type LeaveField = 'name' | 'code' | 'date' | 'kind'

export const EMPLOYEE_FIELDS: { key: EmployeeField; label: string; required?: boolean; hint: string }[] = [
  { key: 'name', label: '氏名', required: true, hint: '' },
  { key: 'hire', label: '入社日', required: true, hint: '2023/4/1、R5.4.1 なども読めます' },
  { key: 'days', label: '週の勤務日数', hint: '空なら週5日' },
  { key: 'hours', label: '週の労働時間', hint: '30以上なら通常の付与。「○」「はい」でも可' },
  { key: 'annual', label: '年間の勤務日数', hint: 'シフト制で週の日数が決まっていない人だけ' },
  { key: 'code', label: '社員番号', hint: '同じ名前の人を区別するときに' },
  { key: 'retire', label: '退職日', hint: '' },
  { key: 'balance', label: '今の残日数', hint: 'Excel から引っ越すとき。管理開始日の時点の残り' },
  { key: 'taken', label: '取得日', hint: '「5/10, 8/15」のように1つのセルに複数でも可' },
]

export const LEAVE_FIELDS: { key: LeaveField; label: string; required?: boolean; hint: string }[] = [
  { key: 'name', label: '氏名', hint: '氏名か社員番号のどちらか' },
  { key: 'code', label: '社員番号', hint: '' },
  { key: 'date', label: '取得日', required: true, hint: '1つのセルに複数の日付でも可' },
  { key: 'kind', label: '区分', hint: '全日／午前／午後／半休／0.5／2時間。空なら全日' },
]

const PATTERNS: Record<EmployeeField | LeaveField, RegExp> = {
  name: /氏名|名前|従業員名|スタッフ|社員名|^name$/i,
  code: /社員番号|従業員番号|社員no|社員コード|^no\.?$|^id$|^code$/i,
  hire: /入社|雇入|雇い入れ|採用日|入職|勤務開始/,
  days: /週.*日|勤務日数|所定労働日数|出勤日数/,
  hours: /週.*時間|労働時間|勤務時間|30時間/,
  annual: /年間/,
  retire: /退職|離職/,
  balance: /残日数|残り|有休残|残高/,
  taken: /取得日|休んだ日|休暇日|有休日/,
  date: /取得日|日付|休んだ日|休暇日|年月日|^date$/i,
  kind: /区分|種類|単位|全日|半休/,
}

export function normalizeHeader(s: string): string {
  return String(s ?? '').normalize('NFKC').replace(/\s+/g, '')
}

/** 見出し行を探す（最初の10行のうち、知っている見出しが2つ以上ある行） */
export function findHeaderRow(table: Table, fields: readonly string[]): number {
  for (let i = 0; i < Math.min(10, table.length); i++) {
    const hits = table[i].filter((c) => fields.some((f) => PATTERNS[f as EmployeeField].test(normalizeHeader(c)))).length
    if (hits >= 2) return i
  }
  return 0
}

export function guessMapping<F extends string>(headers: string[], fields: readonly F[]): Partial<Record<F, number>> {
  const map: Partial<Record<F, number>> = {}
  const used = new Set<number>()
  // 「年間」を先に取らないと「週の勤務日数」に年間日数の列が当たる
  const order = [...fields].sort((a, b) => (a === 'annual' ? -1 : b === 'annual' ? 1 : 0))
  for (const f of order) {
    const idx = headers.findIndex((h, i) => !used.has(i) && PATTERNS[f as EmployeeField].test(normalizeHeader(h)))
    if (idx >= 0) {
      map[f] = idx
      used.add(idx)
    }
  }
  return map
}

/** 貼り付けたテキスト（Excel からのコピーはタブ区切り、CSV はカンマ区切り） */
export function parseText(text: string): Table {
  const t = text.replace(/^﻿/, '').replace(/\r\n?/g, '\n').replace(/\n+$/, '')
  if (!t.trim()) return []
  const tab = t.includes('\t')
  return tab ? t.split('\n').map((l) => l.split('\t').map((c) => c.trim())) : parseCSV(t)
}

export function parseCSV(text: string): Table {
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let q = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (q) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"'
        i++
      } else if (ch === '"') q = false
      else cell += ch
    } else if (ch === '"') q = true
    else if (ch === ',') {
      row.push(cell.trim())
      cell = ''
    } else if (ch === '\n') {
      row.push(cell.trim())
      rows.push(row)
      row = []
      cell = ''
    } else cell += ch
  }
  row.push(cell.trim())
  rows.push(row)
  return rows.filter((r) => r.some((c) => c !== ''))
}

/** Excel / CSV ファイルを読む。SheetJS は必要になったときだけ読み込む */
export async function readFile(file: File): Promise<Table> {
  if (/\.(csv|txt|tsv)$/i.test(file.name)) {
    const buf = await file.arrayBuffer()
    let text = new TextDecoder('utf-8', { fatal: false }).decode(buf)
    // 文字化け（Shift_JIS の CSV）なら読み直す
    if (text.includes('�')) text = new TextDecoder('shift_jis').decode(buf)
    return parseText(text)
  }
  const XLSX = await import('xlsx')
  const wb = XLSX.read(await file.arrayBuffer(), { type: 'array', cellDates: true })
  const ws = wb.Sheets[wb.SheetNames[0]]
  const rows = XLSX.utils.sheet_to_json<Cell[]>(ws, { header: 1, raw: true, defval: '' })
  return rows
    .map((r) => r.map((c) => (c instanceof Date ? isoFromLocalDate(c) : c == null ? '' : String(c).trim())))
    .filter((r) => r.some((c) => c !== ''))
}

function isoFromLocalDate(d: Date): string {
  // SheetJS は日付セルをローカル時刻の 0:00 前後で返す。秒の誤差を丸めてから日付にする
  const t = new Date(d.getTime() + 30_000)
  return parseLooseDate(t) ?? ''
}

// ---------------------------------------------------------------------------
// 値の読み取り

export function parseNumber(s: string): number | null {
  const t = String(s ?? '').normalize('NFKC').replace(/[日時間h,，\s]/gi, '')
  if (!t) return null
  const n = Number(t)
  return Number.isFinite(n) ? n : null
}

export function parseOver30(s: string): boolean | null {
  const t = String(s ?? '').normalize('NFKC').trim()
  if (!t) return null
  if (/^(○|〇|◯|はい|yes|true|y|1|あり|有|以上)$/i.test(t)) return true
  if (/^(×|x|いいえ|no|false|n|0|なし|無|未満|-)$/i.test(t)) return false
  const n = parseNumber(t)
  if (n != null) return n >= 30
  return null
}

/** 区分を読む。「全日」「午前」「午後」「半休」「0.5」「2時間」「2h」など */
export function parseKind(s: string): { kind: LeaveKind; hours?: number } | null {
  const t = String(s ?? '').normalize('NFKC').trim()
  const h = t.match(/^(\d+)\s*(時間|h|H|hour|hours)$/)
  if (h) return Number(h[1]) >= 1 ? { kind: 'hours', hours: Number(h[1]) } : null
  if (!t || /全日|全休|終日|^1(\.0)?$|1日/.test(t)) return { kind: 'full' }
  if (/午前|AM/i.test(t)) return { kind: 'am' }
  if (/午後|PM/i.test(t)) return { kind: 'pm' }
  if (/半|0\.5/.test(t)) return { kind: 'am' }
  return null
}

/**
 * 1つのセルの複数の日付を読む。「2026/5/10, 2026/8/15」「5/10・8/15」など。
 * 年が無い「5/10」は defaultYear を補う（推測した印 guessed を返す）。
 */
export function parseDateList(s: string, defaultYear: number): { dates: ISODate[]; bad: string[]; guessed: boolean } {
  const parts = String(s ?? '')
    .normalize('NFKC')
    .split(/[,、，・;\n\s]+/)
    .map((p) => p.trim())
    .filter(Boolean)
  const dates: ISODate[] = []
  const bad: string[] = []
  let guessed = false
  for (const p of parts) {
    let d = parseLooseDate(p)
    if (!d && /^\d{1,2}[/.月-]\d{1,2}日?$/.test(p)) {
      d = parseLooseDate(`${defaultYear}/${p.replace('月', '/').replace('日', '')}`)
      if (d) guessed = true
    }
    if (d) dates.push(d)
    else bad.push(p)
  }
  return { dates, bad, guessed }
}
