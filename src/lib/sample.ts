// 「サンプルで試す」のデータ。集計日（今日）からの相対で作るので、いつ開いても状況がそろう。

import { addDays, addMonthsCivil, type ISODate } from './dates'
import { defaultSettings, newId } from './defaults'
import { grantSchedule } from './engine'
import type { Employee, LeaveRecord } from './types'

export function makeSample(asOf: ISODate): { employees: Employee[]; leaves: LeaveRecord[] } {
  const m = (n: number) => addMonthsCivil(asOf, n)
  const base = (p: Partial<Employee> & { name: string; hireDate: ISODate }): Employee => ({
    id: newId(),
    code: '',
    retireDate: null,
    contracts: [{ from: p.hireDate, daysPerWeek: 5, over30h: true }],
    trackingStart: null,
    openingLots: [],
    adjustments: {},
    extraGrants: [],
    memo: '',
    ...p,
  })

  const sato = base({ code: '001', name: '佐藤 花子', hireDate: addMonthsCivil(m(-11), -6 - 12 * 3), memo: '店長' })
  const suzuki = base({ code: '002', name: '鈴木 一郎', hireDate: addMonthsCivil(m(-5), -6 - 12) })
  const tanaka = base({
    code: '003',
    name: '田中 美咲',
    hireDate: addMonthsCivil(m(-2), -6 - 12 * 2),
    contracts: [{ from: addMonthsCivil(m(-2), -6 - 12 * 2), daysPerWeek: 3, over30h: false }],
    memo: 'パート（週3日）',
  })
  const ito = base({ code: '004', name: '伊藤 健', hireDate: addMonthsCivil(m(-10), -6) })
  const watanabe = base({
    code: '005',
    name: '渡辺 さくら',
    hireDate: addMonthsCivil(m(-4), -6 - 12 * 2),
    contracts: [
      { from: addMonthsCivil(m(-4), -6 - 12 * 2), daysPerWeek: 3, over30h: false },
      { from: m(-6), daysPerWeek: 5, over30h: true },
    ],
    memo: 'パートから正社員へ',
  })
  const yamamoto = base({ code: '006', name: '山本 大輔', hireDate: m(-2), memo: '新人' })

  const leaves: LeaveRecord[] = []
  const add = (e: Employee, dates: ISODate[], kind: LeaveRecord['kind'] = 'full') =>
    dates.forEach((date) => leaves.push({ id: newId(), employeeId: e.id, date, kind }))

  // 佐藤: 期限まで1か月を切っているのに 2日だけ → 至急
  add(sato, [addDays(m(-9), 3), addDays(m(-4), 10)])
  // 鈴木: 達成済み
  add(suzuki, [addDays(m(-4), 2), addDays(m(-3), 5), addDays(m(-3), 6), addDays(m(-1), 14), addDays(m(-1), 15)])
  // 伊藤: 期限まで2か月、1.5日 → 注意
  add(ito, [addDays(m(-7), 8)])
  add(ito, [addDays(m(-5), 20)], 'am')
  // 渡辺: 正社員になってから付与12日、まだ1日 + 予定1日
  add(watanabe, [addDays(m(-2), 1), addDays(m(1), 2)])
  // 田中: パート週3日なので義務の対象外
  add(tanaka, [addDays(m(-1), 7)])

  const employees = [sato, suzuki, tanaka, ito, watanabe, yamamoto]
  // 終わった期間は、ちゃんと5日以上取れていたことにする（過去の未達で画面が埋まらないように）
  for (const e of employees) {
    for (const g of grantSchedule(e, defaultSettings, asOf)) {
      if (addMonthsCivil(g.date, 12) > asOf || !g.obligation) continue
      add(e, [20, 45, 120, 121, 200, 260].map((d) => addDays(g.date, d)))
    }
  }
  return { employees, leaves }
}
