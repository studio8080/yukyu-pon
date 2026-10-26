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
  /**
   * 休職・育休などで、この回の年5日を取らせることができなかった（履行不能）事情の記録。
   * 期限を過ぎて5日に届かなかった期間を「未達」にせず「判定なし」にする（厚労省パンフ Q13・Q14 を参考にした有休ポンの扱い）
   */
  infeasible?: { reason: string }
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
  /** 顔写真（任意）。96px 四方の JPEG の data URL。このブラウザとバックアップにだけ入る（src/lib/photo.ts） */
  photo?: string | null
}

/** full = 1日、am/pm = 半日（0.5日）、hours = 時間単位 */
export type LeaveKind = 'full' | 'am' | 'pm' | 'hours'

/** 取得の経緯。request = 本人の請求、designated = 会社の時季指定（39条7項）、planned = 計画的付与（39条6項） */
export type LeaveSource = 'request' | 'designated' | 'planned'

export const LEAVE_SOURCE_LABEL: Record<LeaveSource, string> = { request: '本人の請求', designated: '会社の指定', planned: '計画的付与' }
/** 管理簿の取得日に付ける短い印（本人の請求には付けない） */
export const LEAVE_SOURCE_MARK: Record<LeaveSource, string> = { request: '', designated: '指定', planned: '計画' }

/** 経緯ごとの注意。会社の指定・計画的付与には時間単位を使わない（時季指定は半日単位まで。厚労省パンフ Q3） */
export const SOURCE_NOTE: Record<LeaveSource, string> = {
  request: '',
  designated: '会社が指定する前に、本人の希望を聞いてください（労基則24条の6）。指定は半日単位まで（時間単位は不可）。',
  planned: '労使協定で決めた日だけ。年休のうち5日を超える分だけが対象です（39条6項）。',
}

export const NOT_LEAVE_NOTE = '買い上げた日数・特別休暇（慶弔・夏季など）・欠勤は「休んだ日」に入れないでください（年5日に数えられません）。'

export type LeaveRecord = {
  /** 未設定は旧形式。移行時点の過去記録は従来どおり計上する */
  confirmation?: import('./leaveReview').Confirmation
  reviewedAt?: ISODate
  postponedTo?: ISODate
  originId?: string
  id: string
  employeeId: string
  date: ISODate
  kind: LeaveKind
  /** kind = 'hours' のときの時間数（1以上の整数） */
  hours?: number
  /** 取得の経緯（任意。古い記録には無い。無いときはメモの「時季指定」「計画的付与」で見分ける） */
  source?: LeaveSource
  /** メモ */
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
  /** 時間単位をオンにする前に、労使協定と就業規則を確認した日時 */
  hourlyConfirmedAt?: string
  /** 年5日の時季指定について、対象者と方法を就業規則に書いたことを確認した日時（任意） */
  designationRuleConfirmedAt?: string
  /** ホームの「時季指定の就業規則」の案内を閉じた日時（一度だけ出す） */
  designationHintClosedAt?: string
  /** 付与日の前後に、出勤率の確認を促す */
  attendanceCheck: boolean
  /** 管理簿の保存年数（労基則24条の7は5年、附則71条で当分の間3年）。利用者が選ぶ */
  ledgerRetentionYears: 3 | 5
}

export const FIXED_DAYS: Record<Exclude<LeaveKind, 'hours'>, number> = { full: 1, am: 0.5, pm: 0.5 }
export const LEAVE_LABEL: Record<LeaveKind, string> = { full: '全日', am: '午前半休', pm: '午後半休', hours: '時間単位' }

export function leaveLabel(r: Pick<LeaveRecord, 'kind' | 'hours'>): string {
  return r.kind === 'hours' ? `${r.hours ?? 0}時間` : LEAVE_LABEL[r.kind]
}
