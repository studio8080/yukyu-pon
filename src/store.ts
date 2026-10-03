// 状態はこのブラウザの localStorage にだけ保存する。サーバーには送らない。

import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import { today, type ISODate } from './lib/dates'
import { defaultSettings, newId } from './lib/defaults'
import type { Employee, LeaveRecord, Settings } from './lib/types'

export const STORAGE_KEY = 'yukyu-pon:v1'
export const SNAPSHOT_KEY = 'yukyu-pon:snapshots'
export const BACKUP_FORMAT = 'yukyu-pon-backup'
const MAX_SNAPSHOTS = 12

export type Data = {
  settings: Settings
  employees: Employee[]
  leaves: LeaveRecord[]
}

type State = Data & {
  /** 集計日（保存しない。開くたびに今日） */
  asOf: ISODate
  /** 最後にバックアップを保存した日時 */
  lastBackupAt: string | null
  /** 最後にデータを変えた日時 */
  lastChangeAt: string | null
  /** 「計算結果は自分で確認して使う」に同意した日時 */
  acceptedAt: string | null
  /** Pro のライセンスキー */
  licenseKey: string
  setAsOf: (d: ISODate) => void
  updateSettings: (p: Partial<Settings>) => void
  addEmployee: (e: Omit<Employee, 'id'>) => string
  updateEmployee: (id: string, p: Partial<Employee> | ((e: Employee) => Employee)) => void
  removeEmployee: (id: string) => void
  addLeaves: (ls: Omit<LeaveRecord, 'id'>[]) => number
  removeLeave: (id: string) => void
  replaceAll: (d: Data) => void
  mergeImport: (employees: Employee[], leaves: Omit<LeaveRecord, 'id'>[]) => void
  markBackedUp: () => void
  accept: () => void
  setLicenseKey: (k: string) => void
  clearAll: () => void
}

const now = () => new Date().toISOString()

export const useStore = create<State>()(
  persist(
    (set, get) => ({
      settings: defaultSettings,
      employees: [],
      leaves: [],
      asOf: today(),
      lastBackupAt: null,
      lastChangeAt: null,
      acceptedAt: null,
      licenseKey: '',
      setAsOf: (asOf) => set({ asOf }),
      updateSettings: (p) => set((s) => ({ settings: { ...s.settings, ...p }, lastChangeAt: now() })),
      addEmployee: (e) => {
        const id = newId()
        set((s) => ({ employees: [...s.employees, { ...e, id }], lastChangeAt: now() }))
        return id
      },
      updateEmployee: (id, p) =>
        set((s) => ({
          employees: s.employees.map((e) => (e.id !== id ? e : typeof p === 'function' ? p(e) : { ...e, ...p })),
          lastChangeAt: now(),
        })),
      removeEmployee: (id) => {
        const e = get().employees.find((x) => x.id === id)
        takeSnapshot(`${e?.name ?? '従業員'}さんを削除する前`)
        set((s) => ({
          employees: s.employees.filter((e) => e.id !== id),
          leaves: s.leaves.filter((l) => l.employeeId !== id),
          lastChangeAt: now(),
        }))
      },
      addLeaves: (ls) => {
        // 同じ人・同じ日・同じ区分の重複は足さない（時間単位は時間数も含めて同じなら重複）
        const k = (l: Omit<LeaveRecord, 'id'>) => `${l.employeeId}|${l.date}|${l.kind}|${l.kind === 'hours' ? l.hours : ''}`
        const have = new Set(get().leaves.map(k))
        const fresh: LeaveRecord[] = []
        for (const l of ls) {
          if (have.has(k(l))) continue
          have.add(k(l))
          fresh.push({ ...l, id: newId() })
        }
        if (fresh.length) set((s) => ({ leaves: [...s.leaves, ...fresh], lastChangeAt: now() }))
        return fresh.length
      },
      removeLeave: (id) => set((s) => ({ leaves: s.leaves.filter((l) => l.id !== id), lastChangeAt: now() })),
      replaceAll: (d) => {
        takeSnapshot('バックアップから戻す前')
        set({ settings: { ...defaultSettings, ...d.settings }, employees: d.employees, leaves: d.leaves, lastChangeAt: now() })
      },
      mergeImport: (employees, leaves) => {
        takeSnapshot('取り込みの前')
        set((s) => {
          const byId = new Map(s.employees.map((e) => [e.id, e]))
          for (const e of employees) byId.set(e.id, e)
          return { employees: [...byId.values()], lastChangeAt: now() }
        })
        get().addLeaves(leaves)
      },
      markBackedUp: () => set({ lastBackupAt: now() }),
      accept: () => set({ acceptedAt: now() }),
      setLicenseKey: (licenseKey) => set({ licenseKey }),
      clearAll: () => {
        takeSnapshot('すべて消す前')
        set({ settings: defaultSettings, employees: [], leaves: [], lastBackupAt: null, lastChangeAt: now() })
      },
    }),
    {
      name: STORAGE_KEY,
      version: 2,
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({
        settings: s.settings,
        employees: s.employees,
        leaves: s.leaves,
        lastBackupAt: s.lastBackupAt,
        lastChangeAt: s.lastChangeAt,
        acceptedAt: s.acceptedAt,
        licenseKey: s.licenseKey,
      }),
      // 設定の項目が増えても、古い保存データに既定値を足して読む
      migrate: (persisted) => persisted as State,
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<State>
        return { ...current, ...p, settings: { ...defaultSettings, ...(p.settings ?? {}) } }
      },
    },
  ),
)

export function blankEmployee(hireDate: ISODate): Omit<Employee, 'id'> {
  return {
    code: '',
    name: '',
    hireDate,
    retireDate: null,
    contracts: [{ from: hireDate, daysPerWeek: 5, over30h: true, hoursPerDay: 8 }],
    trackingStart: null,
    openingLots: [],
    adjustments: {},
    extraGrants: [],
    memo: '',
  }
}

export function currentData(): Data {
  const s = useStore.getState()
  return { settings: s.settings, employees: s.employees, leaves: s.leaves }
}

// ---------------------------------------------------------------------------
// 復元ポイント（操作の取り消し用。同じブラウザの中に最大12件。ブラウザのデータを消すと一緒に消える）

export type Snapshot = { at: string; reason: string; employees: number; leaves: number; data: Data }

export function listSnapshots(): Snapshot[] {
  try {
    const j = JSON.parse(localStorage.getItem(SNAPSHOT_KEY) || '[]')
    return Array.isArray(j) ? j : []
  } catch {
    return []
  }
}

export function takeSnapshot(reason: string) {
  const d = currentData()
  if (d.employees.length === 0 && d.leaves.length === 0) return
  const list = [{ at: now(), reason, employees: d.employees.length, leaves: d.leaves.length, data: d }, ...listSnapshots()]
  // 容量オーバーなら古いものから捨てる
  for (let n = Math.min(list.length, MAX_SNAPSHOTS); n > 0; n--) {
    try {
      localStorage.setItem(SNAPSHOT_KEY, JSON.stringify(list.slice(0, n)))
      return
    } catch {
      /* 次は1件減らす */
    }
  }
}

/** 1日1回、最初の変更のときに自動で復元ポイントを取る */
export function dailySnapshot() {
  const last = listSnapshots().find((s) => s.reason === '毎日の自動保存')
  if (last && last.at.slice(0, 10) === today()) return
  takeSnapshot('毎日の自動保存')
}

export function restoreSnapshot(at: string) {
  const s = listSnapshots().find((x) => x.at === at)
  if (s) useStore.getState().replaceAll(s.data)
}

// ---------------------------------------------------------------------------
// バックアップファイル（JSON）

/** バックアップ（JSON）の形を確かめる。外から来たファイルなので型を信用しない */
export function parseBackup(text: string): Data {
  let j: Record<string, unknown>
  try {
    j = JSON.parse(text)
  } catch {
    throw new Error('ファイルを読めませんでした。有休ポンで保存したバックアップ（.json）を選んでください。')
  }
  if (j?.format !== BACKUP_FORMAT || !Array.isArray(j.employees) || !Array.isArray(j.leaves)) {
    throw new Error('有休ポンのバックアップファイルではありません。')
  }
  const str = (v: unknown) => (typeof v === 'string' ? v : '')
  const employees: Employee[] = (j.employees as Record<string, unknown>[]).map((e) => ({
    id: str(e.id) || newId(),
    code: str(e.code),
    name: str(e.name),
    hireDate: str(e.hireDate),
    retireDate: str(e.retireDate) || null,
    contracts: Array.isArray(e.contracts) ? e.contracts : [],
    trackingStart: str(e.trackingStart) || null,
    openingLots: Array.isArray(e.openingLots) ? e.openingLots : [],
    adjustments: e.adjustments && typeof e.adjustments === 'object' ? (e.adjustments as Employee['adjustments']) : {},
    extraGrants: Array.isArray(e.extraGrants) ? e.extraGrants : [],
    memo: str(e.memo),
  }))
  const ids = new Set(employees.map((e) => e.id))
  const leaves: LeaveRecord[] = (j.leaves as Record<string, unknown>[])
    .filter((l) => ids.has(str(l.employeeId)))
    .map((l) => ({
      id: str(l.id) || newId(),
      employeeId: str(l.employeeId),
      date: str(l.date),
      kind: l.kind === 'am' || l.kind === 'pm' || l.kind === 'hours' ? l.kind : 'full',
      hours: l.kind === 'hours' && typeof l.hours === 'number' ? l.hours : undefined,
      note: str(l.note) || undefined,
    }))
  return { settings: { ...defaultSettings, ...((j.settings as Partial<Settings>) ?? {}) }, employees, leaves }
}

export function makeBackup(d: Data): string {
  return JSON.stringify({ format: BACKUP_FORMAT, version: 2, savedAt: now(), ...d }, null, 1)
}
