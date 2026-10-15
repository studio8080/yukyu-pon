import { useState } from 'react'
import { addDays, fmt, today } from '../lib/dates'
import type { GrantEvent } from '../lib/engine'
import type { Employee } from '../lib/types'
import { useStore } from '../store'
import { Button, Field, inputCls, Modal, Notice } from './ui'

/** 付与の前に、出勤率8割以上かを確かめて記録する。自動計算はしない（出勤日の記録を持たないため）。 */
export function AttendanceDialog({ emp, grant, onClose }: { emp: Employee | null; grant: GrantEvent | null; onClose: () => void }) {
  const [work, setWork] = useState('')
  const [present, setPresent] = useState('')
  const open = !!emp && !!grant
  const w = Number(work)
  const p = Number(present)
  const rate = w > 0 && p >= 0 ? p / w : null

  const save = (skipped: boolean) => {
    if (!emp || !grant) return
    useStore.getState().updateEmployee(emp.id, (e) => {
      const cur = { ...(e.adjustments[grant.date] ?? {}) }
      if (skipped) {
        cur.skipped = true
        delete cur.attendance
      } else {
        delete cur.skipped
        cur.attendance = { checkedAt: today(), ...(rate != null ? { workDays: w, presentDays: p } : {}) }
      }
      return { ...e, adjustments: { ...e.adjustments, [grant.date]: cur } }
    })
    setWork('')
    setPresent('')
    onClose()
  }

  return (
    <Modal open={open} onClose={onClose} title="出勤率の確認">
      {emp && grant && (
        <div className="space-y-4 text-sm">
          <p>
            <strong>{emp.name}</strong> さんの <strong>{fmt(grant.date)}</strong> の付与（{grant.statutory}日）の前に、
            <strong>
              {fmt(grant.periodFrom)}〜{fmt(addDays(grant.date, -1))}
            </strong>{' '}
            の出勤率が8割以上かを確かめてください。
          </p>
          {grant.advanced && <Notice>この回は前倒しの付与です。前倒しで短くなった期間は、すべて出勤したものとみなします。</Notice>}
          <div className="grid grid-cols-2 gap-3">
            <Field label="働く予定だった日（全労働日）" hint="休日に出勤した日は含めません。">
              <input type="number" min={0} className={inputCls} value={work} onChange={(e) => setWork(e.target.value)} placeholder="例: 120" />
            </Field>
            <Field label="そのうち出勤した日">
              <input type="number" min={0} className={inputCls} value={present} onChange={(e) => setPresent(e.target.value)} placeholder="例: 110" />
            </Field>
          </div>
          {rate != null && (
            <p className={`rounded-lg px-3 py-2 text-base font-semibold ${rate >= 0.8 ? 'bg-brand-50 text-brand-800' : 'bg-shu-50 text-shu-700'}`}>
              出勤率 {(rate * 100).toFixed(1)}% → {rate >= 0.8 ? '8割以上なので付与します' : '8割未満なので、この回は付与しません'}
            </p>
          )}
          <details className="rounded-lg bg-paper px-3 py-2 text-xs text-slate-600">
            <summary className="cursor-pointer font-medium text-slate-700">数え方（出勤とみなす日・数えない日）</summary>
            <ul className="mt-2 list-disc space-y-1 pl-4">
              <li>出勤したものとみなす: 年休を取った日、業務上のけが・病気の休業、産前産後の休業、育児・介護休業法の育児休業・介護休業（39条10項）</li>
              <li>出勤した日に数える: 遅刻・早退した日、本人の責めによらない理由で働けなかった日（解雇が無効とされた期間など。平25.7.10 基発0710第3号）</li>
              <li>
                全労働日から除く: 天災など不可抗力による休業日、会社側の経営・管理上の理由による休業日、休日に出勤した日、正当な争議行為で働かなかった日、代替休暇（月60時間を超える残業の割増賃金に代えた休暇）の日
              </li>
              <li>会社の定めによる: 生理休暇・慶弔休暇・子の看護等休暇・介護休暇など（法律で出勤とみなす対象ではないので、就業規則の扱いに合わせます）</li>
              <li>出勤しなかった日: 私用・私傷病の欠勤</li>
            </ul>
            <p className="mt-2">タイムカードや勤怠の記録から数えてください。迷う日は、就業規則の定めに合わせます。</p>
          </details>
          <div className="flex flex-wrap gap-2">
            <Button variant="primary" disabled={rate != null && rate < 0.8} onClick={() => save(false)}>
              8割以上を確認した
            </Button>
            <Button variant="danger" disabled={rate != null && rate >= 0.8} onClick={() => save(true)}>
              8割未満（この回は付与しない）
            </Button>
          </div>
          <p className="text-xs text-slate-500">日数を入れずに「確認した」を押すこともできます（ほぼ欠勤が無い人など）。記録は管理簿の確認に使えます。</p>
        </div>
      )}
    </Modal>
  )
}
