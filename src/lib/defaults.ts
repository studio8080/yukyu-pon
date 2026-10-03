import type { Settings } from './types'

export const defaultSettings: Settings = {
  companyName: '',
  grantRule: 'statutory',
  uniformMonthDay: '04-01',
  uniformFrom: '',
  uniformFirst: 'sixMonths',
  consumeOrder: 'oldest',
  redMonths: 1,
  yellowMonths: 3,
  halfDayEnabled: true,
  hourlyEnabled: false,
  attendanceCheck: true,
}

export function newId(): string {
  return crypto.randomUUID()
}
