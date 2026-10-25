import { useState } from 'react'
import { today } from '../lib/dates'
import { confirmation, CONFIRMATION_LABEL } from '../lib/leaveReview'
import { leaveLabel } from '../lib/types'
import { useStore } from '../store'
import { Button, Card, inputCls, Notice } from './ui'

export function MonthlyReview() {
  const leaves = useStore(s => s.leaves), employees = useStore(s => s.employees), asOf = useStore(s => s.asOf)
  const [month, setMonth] = useState(asOf.slice(0, 7)), [date, setDate] = useState<Record<string, string>>({}), [error, setError] = useState('')
  const due = leaves.filter(l => confirmation(l) === 'pending' && l.date <= asOf).length
  const list = leaves.filter(l => l.date.startsWith(month)).sort((a, b) => a.date.localeCompare(b.date))
  const act = (id: string, action: 'taken' | 'cancelled' | 'pending' | 'postponed') => {
    try { useStore.getState().reviewLeave(id, action, date[id]); setError('') } catch (e) { setError((e as Error).message) }
  }
  return <Card>
    <h2 className="mb-2 text-lg font-bold">月次の取得確認</h2>
    <p className="mb-3 text-sm text-slate-600">集計日までの未確認 {due}件。未確認は日付が過ぎても残高・年5日・管理簿の実績に入りません。旧記録は従来どおり計上します。延期元・取消は計上せず記録を残します。</p>
    <label className="block text-sm">確認する月<input type="month" className={inputCls} value={month} onChange={e => setMonth(e.target.value)} /></label>
    {error && <Notice tone="warn">{error}</Notice>}
    <ul className="divide-y divide-slate-200">
      {list.map(l => <li key={l.id} className="space-y-2 py-3">
        <p className="break-words text-sm">{l.date} / {employees.find(e => e.id === l.employeeId)?.name ?? '従業員不明'} / {leaveLabel(l)} / <b>{CONFIRMATION_LABEL[confirmation(l)]}</b>{l.postponedTo ? ` → ${l.postponedTo}` : ''}</p>
        {confirmation(l) !== 'postponed' && <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" disabled={l.date > today() || confirmation(l) === 'taken'} onClick={() => act(l.id, 'taken')}>取得</Button>
          <Button size="sm" disabled={confirmation(l) === 'cancelled'} onClick={() => act(l.id, 'cancelled')}>取消</Button>
          <Button size="sm" disabled={confirmation(l) === 'pending'} onClick={() => act(l.id, 'pending')}>未確認に戻す</Button>
          <input type="date" aria-label={`${l.date} の延期先`} className={`${inputCls} !w-auto max-w-full`} value={date[l.id] ?? ''} onChange={e => setDate({ ...date, [l.id]: e.target.value })} />
          <Button size="sm" disabled={!date[l.id]} onClick={() => act(l.id, 'postponed')}>延期</Button>
        </div>}
      </li>)}
    </ul>
    {!list.length && <p className="py-3 text-sm text-slate-500">この月の記録はありません。</p>}
    <p className="text-xs text-slate-500">旧記録や取得済みを変更すると集計も変わります。変更前の復元ポイントは設定から戻せます。取得確認は今日までの日だけです。確認状態を含むv3バックアップは旧版のアプリへ復元しないでください。</p>
  </Card>
}
