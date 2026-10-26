import { isISODate, today, type ISODate } from './dates'
import type { LeaveRecord } from './types'

export type Confirmation = 'legacy' | 'pending' | 'taken' | 'postponed' | 'cancelled'
export const CONFIRMATION_LABEL: Record<Confirmation, string> = { legacy: '旧記録（従来どおり計上）', pending: '未確認', taken: '取得', postponed: '延期', cancelled: '取消' }
export const confirmation = (l: LeaveRecord): Confirmation => l.confirmation ?? 'legacy'
export const isActual = (l: LeaveRecord, asOf: ISODate) => l.date <= asOf && ['legacy', 'taken'].includes(confirmation(l))
export const isScheduled = (l: LeaveRecord) => !['cancelled', 'postponed'].includes(confirmation(l))

/** 過去は従来の集計を保ち、移行時点の未来だけを未確認にする。集計日の変更には依存しない。 */
export function migrateLeaves(leaves: LeaveRecord[], cutoff = today()): LeaveRecord[] {
  return leaves.map(l => {
    const status = l.confirmation;
    if (status && Object.hasOwn(CONFIRMATION_LABEL, status)) return l;
    return { ...l, confirmation: status != null ? 'pending' : l.date > cutoff ? 'pending' : 'legacy' };
  })
}

export function reviewRecord(l: LeaveRecord, action: 'taken' | 'cancelled' | 'pending' | 'postponed', date: ISODate | undefined, at = today()): LeaveRecord {
  if (!isISODate(l.date)) throw new Error('記録の日付を確認してください')
  if (action === 'taken' && l.date > at) throw new Error('未来の日は取得確認できません')
  if (action === 'postponed' && (!date || !isISODate(date) || date <= at || date <= l.date)) throw new Error('延期先は元の日と今日より後の日を選んでください')
  return { ...l, confirmation: action, reviewedAt: at, postponedTo: action === 'postponed' ? date : undefined }
}
