import type { ISODate } from './dates'

/** 所定労働日数・時間の契約。変更したら行を足す（上書きしない）。付与日数は「基準日時点の契約」で決まる。 */
export type Contract = {
  /** この日から有効 */
  from: ISODate
  /** 週の所定労働日数 1〜5（5以上は5）。0 = 週で決まっていない（年間の所定労働日数で判定） */
  daysPerWeek: number
  /** daysPerWeek = 0 のときの年間所定労働日数 */
  annualDays?: number
  /** 週の所定労働時間が30時間以上 */
  over30h: boolean
  /** 1日の所定労働時間（時間単位の年休で、1日を何時間とみなすか。端数は切り上げて使う）。既定 8 */
  hoursPerDay?: number
}

/** 付与前の出勤率の確認 */
export type AttendanceCheck = {
  /** 確認した日 */
  checkedAt: ISODate
  /** 計算機で出した場合の値（任意） */
  workDays?: number
  presentDays?: number
}

/** 自動計算した付与に対する、人の手による上書き。キーは付与日 */
export type GrantAdjustment = {
  /** 付与日数を上書き（会社独自に多く付与する等）。法定を下回る値は警告する */
  days?: number
  /** 前の期間の出勤率が8割未満で、この回は付与しない */
  skipped?: boolean
  /** 出勤率8割以上を確認した */
  attendance?: AttendanceCheck
  note?: string
}

/** 会社独自の上乗せ（法定の付与とは別枠） */
export type ExtraGrant = {
  id: string
  date: ISODate
  days: number
  /** 有効期間（か月）。既定 24 */
  validMonths: number
  note: string
}

/** 管理を始めた日の時点で残っていた有休（Excel 等からの移行） */
export type OpeningLot = {
  id: string
  /** もともとの付与日（時効の計算に使う） */
  grantDate: ISODate
  /** 管理開始日の時点の残日数 */
  days: number
}

export type Employee = {
  id: string
  code: string
  name: string
  hireDate: ISODate
  /** 退職日（最終在籍日） */
  retireDate?: ISODate | null
  contracts: Contract[]
  /** 管理開始日。これより前の付与は計算に入れず、openingLots で残高を受け取る。未設定 = 入社日から */
  trackingStart?: ISODate | null
  openingLots: OpeningLot[]
  adjustments: Record<ISODate, GrantAdjustment>
  extraGrants: ExtraGrant[]
  memo: string
}

/** full = 1日、am/pm = 半日（0.5日）、hours = 時間単位 */
export type LeaveKind = 'full' | 'am' | 'pm' | 'hours'

export type LeaveRecord = {
  id: string
  employeeId: string
  date: ISODate
  kind: LeaveKind
  /** kind = 'hours' のときの時間数（1以上の整数） */
  hours?: number
  /** 会社が時季指定した・計画的付与 などのメモ */
  note?: string
}

export type FirstGrantRule = 'sixMonths' | 'firstUniform' | 'hire'

export type Settings = {
  companyName: string
  grantRule: 'statutory' | 'uniform'
  /** 一斉付与の基準日 "MM-DD" */
  uniformMonthDay: string
  /** 一斉付与に切り替えた日。空 = 最初から一斉付与 */
  uniformFrom: ISODate | ''
  /** 一斉付与のときの入社1回目の付与 */
  uniformFirst: FirstGrantRule
  /** 一斉付与のルールを就業規則と照らして確認した日時（未確認なら一斉付与にできない） */
  uniformConfirmedAt?: string
  /** 取得したときに、古い付与分と新しい付与分のどちらから使うか */
  consumeOrder: 'oldest' | 'newest'
  /** 5日の期限まで、この月数を切ったら赤 */
  redMonths: number
  /** 5日の期限まで、この月数を切ったら黄 */
  yellowMonths: number
  /** 半日単位の取得を使う */
  halfDayEnabled: boolean
  /** 時間単位の年休を使う（労使協定が必要） */
  hourlyEnabled: boolean
  /** 付与日の前後に、出勤率の確認を促す */
  attendanceCheck: boolean
}

export const FIXED_DAYS: Record<Exclude<LeaveKind, 'hours'>, number> = { full: 1, am: 0.5, pm: 0.5 }
export const LEAVE_LABEL: Record<LeaveKind, string> = { full: '全日', am: '午前半休', pm: '午後半休', hours: '時間単位' }

export function leaveLabel(r: Pick<LeaveRecord, 'kind' | 'hours'>): string {
  return r.kind === 'hours' ? `${r.hours ?? 0}時間` : LEAVE_LABEL[r.kind]
}
