import { Printer } from 'lucide-react'
import { useState } from 'react'
import { addDays, fmt, fmtBalance, fmtDays } from '../lib/dates'
import { useReports } from '../lib/view'
import { useStore } from '../store'
import { Button, Card } from './ui'

/** 従業員本人に渡す「有休のお知らせ」。1人1枚の小さな紙（A4に3人分）を印刷する */
export function NoticeSlips() {
  const reports = useReports().filter((r) => r.active)
  const settings = useStore((s) => s.settings)
  const asOf = useStore((s) => s.asOf)
  const [picked, setPicked] = useState<Set<string> | null>(null)
  const sel = picked ?? new Set(reports.map((r) => r.employee.id))
  const shown = reports.filter((r) => sel.has(r.employee.id))
  const f = (n: number, h: number) => fmtBalance(n, h, settings.hourlyEnabled)

  return (
    <div className="space-y-4">
      <Card className="no-print">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="font-display text-lg text-ink">本人へのお知らせ</h2>
            <p className="text-sm text-slate-600">
              残日数・消える日・次の付与・年5日の進み具合を、1人1枚にまとめて印刷します（A4に3人分。切って渡せます）。年5日に届いていない人には、休みたい日を書いてもらう欄が付きます（会社が日を指定する前に希望を聞くため。労基則24条の6）。
            </p>
          </div>
          <Button variant="primary" disabled={shown.length === 0} onClick={() => window.print()}>
            <Printer size={16} /> 印刷・PDF で保存
          </Button>
        </div>
        <div className="mt-3 flex flex-wrap gap-2 text-sm">
          {reports.map((r) => (
            <label key={r.employee.id} className="flex items-center gap-1 rounded-full border border-line px-2 py-0.5">
              <input
                type="checkbox"
                className="h-3.5 w-3.5 accent-brand-500"
                checked={sel.has(r.employee.id)}
                onChange={() => {
                  const n = new Set(sel)
                  if (n.has(r.employee.id)) n.delete(r.employee.id)
                  else n.add(r.employee.id)
                  setPicked(n)
                }}
              />
              {r.employee.name}
            </label>
          ))}
        </div>
      </Card>

      <div className="grid gap-4 print:block">
        {shown.map((r) => {
          const lots = r.lots.filter((l) => l.remaining > 0 && l.expires > asOf)
          const w = r.focus?.status === 'active' ? r.focus : null
          return (
            <section key={r.employee.id} className="print-break rounded-[24px] border border-line bg-white p-6 print:mb-[6mm] print:rounded-none print:border-dashed">
              <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-line pb-2">
                <h3 className="text-lg font-bold">{r.employee.name} さん　年次有給休暇のお知らせ</h3>
                <span className="text-sm text-slate-600">
                  {fmt(asOf)} 現在{settings.companyName && `・${settings.companyName}`}
                </span>
              </div>
              <div className="mt-3 grid gap-4 sm:grid-cols-3 print:grid-cols-3">
                <div>
                  <p className="text-xs text-slate-500">いま使える日数</p>
                  <p className="text-3xl font-bold text-brand-800">{f(r.balance, r.hoursPerDay)}</p>
                </div>
                <div className="text-sm">
                  <p className="text-xs text-slate-500">内訳（使える期限）</p>
                  {lots.length ? (
                    <ul>
                      {lots.map((l) => (
                        <li key={l.key}>
                          {f(l.remaining, r.hoursPerDay)}　{fmt(addDays(l.expires, -1))} まで
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p>—</p>
                  )}
                  <p className="mt-1 text-xs text-slate-500">期限を過ぎると時効で消えます。</p>
                </div>
                <div className="text-sm">
                  <p className="text-xs text-slate-500">次の付与</p>
                  <p>
                    {!r.nextGrant
                      ? '—'
                      : r.nextGrant.skipped || r.nextGrant.days <= 0
                        ? `${fmt(r.nextGrant.date)} は付与なし`
                        : `${fmt(r.nextGrant.date)} に ${fmtDays(r.nextGrant.days)}（出勤率8割以上の場合）`}
                  </p>
                  {w && (
                    <>
                      <p className="mt-2 text-xs text-slate-500">年5日の取得</p>
                      <p>
                        {fmt(w.deadline)} までに あと <strong>{fmtDays(w.needed)}</strong>（取得済み {fmtDays(w.taken)}
                        {w.planned > 0 && `・予定 ${fmtDays(w.planned)}`}）
                      </p>
                    </>
                  )}
                </div>
              </div>
              {w && w.needed > w.planned && (
                <div className="mt-3 rounded-xl border border-dashed border-slate-400 p-3 text-sm">
                  <p>5日に届くよう、会社から休む日を指定することがあります。その前に希望を聞かせてください。</p>
                  <p className="mt-2 flex flex-wrap gap-x-5 leading-loose">
                    <span>希望日:</span>
                    {[1, 2, 3].map((i) => (
                      <span key={i} className="whitespace-nowrap">
                        {'　　月　　日'}
                      </span>
                    ))}
                    <span className="whitespace-nowrap">（　　月　　日までに担当者へ）</span>
                  </p>
                  <p className="flex flex-wrap gap-x-5 leading-loose">
                    <span className="whitespace-nowrap">提出日:　　年　　月　　日</span>
                    <span className="whitespace-nowrap">氏名:＿＿＿＿＿＿＿＿＿＿</span>
                  </p>
                </div>
              )}
              <p className="mt-3 text-xs text-slate-500">日数に心当たりのない点があれば、担当者に声をかけてください。</p>
            </section>
          )
        })}
      </div>
    </div>
  )
}
