import { useMemo } from 'react'
import { useStore } from '../store'
import { fmt, fmtDays } from './dates'
import { buildReport, type ObligationWindow, type Report } from './engine'

export function useReports(): Report[] {
  const employees = useStore((s) => s.employees)
  const leaves = useStore((s) => s.leaves)
  const settings = useStore((s) => s.settings)
  const asOf = useStore((s) => s.asOf)
  return useMemo(
    () =>
      employees
        .map((e) => buildReport(e, leaves, settings, asOf))
        .sort((a, b) => (a.employee.code || '').localeCompare(b.employee.code || '', 'ja', { numeric: true }) || a.employee.hireDate.localeCompare(b.employee.hireDate)),
    [employees, leaves, settings, asOf],
  )
}

export function windowLabel(w: ObligationWindow | null): string {
  if (!w) return '対象外'
  switch (w.status) {
    case 'done':
      return '達成'
    case 'missed':
      return '期限切れ・未達'
    case 'retired':
      return '退職で対象外'
    case 'upcoming':
      return '開始前'
    case 'untracked':
      return '管理開始前（判定なし）'
    case 'active':
      return w.level === 'red' ? `至急 あと${fmtDays(w.needed)}` : w.level === 'yellow' ? `注意 あと${fmtDays(w.needed)}` : `進行中 あと${fmtDays(w.needed)}`
  }
}

export function windowDetail(w: ObligationWindow): string {
  const range = `${fmt(w.grantDate)}〜${fmt(w.deadline)}`
  const planned = w.planned > 0 ? `（予定 ${fmtDays(w.planned)}）` : ''
  if (w.status === 'active') return `${range}・取得 ${fmtDays(w.taken)}${planned}・期限まで${w.daysLeft}日`
  return `${range}・取得 ${fmtDays(w.taken)}${planned}`
}
