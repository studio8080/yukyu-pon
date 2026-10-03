import { FileSpreadsheet, Printer } from 'lucide-react'
import { useMemo, useState } from 'react'
import { fmt, fmtDays } from '../lib/dates'
import { datesText, exportExcel, ledgerRows, type LedgerRange, type LedgerRow } from '../lib/exporter'
import { useStore } from '../store'
import { NoticeSlips } from './NoticeSlips'
import { Button, Card, Notice } from './ui'

export function LedgerView() {
  const [view, setView] = useState<'ledger' | 'slips'>('ledger')
  return (
    <div className="space-y-4">
      <div className="no-print flex gap-2" role="tablist">
        {(
          [
            ['ledger', '年次有給休暇管理簿'],
            ['slips', '本人へのお知らせ'],
          ] as const
        ).map(([k, l]) => (
          <button
            key={k}
            role="tab"
            aria-selected={view === k}
            onClick={() => setView(k)}
            className={`rounded-full px-4 py-1.5 text-sm font-medium ${view === k ? 'bg-brand-700 text-white' : 'bg-white text-slate-700 ring-1 ring-slate-200'}`}
          >
            {l}
          </button>
        ))}
      </div>
      {view === 'ledger' ? <Ledger /> : <NoticeSlips />}
    </div>
  )
}

function Ledger() {
  const employees = useStore((s) => s.employees)
  const leaves = useStore((s) => s.leaves)
  const settings = useStore((s) => s.settings)
  const asOf = useStore((s) => s.asOf)
  const [range, setRange] = useState<LedgerRange>('three')
  const [retired, setRetired] = useState(true)
  const [busy, setBusy] = useState(false)
  const rows = useMemo(() => ledgerRows(employees, leaves, settings, asOf, range, retired), [employees, leaves, settings, asOf, range, retired])

  const groups = useMemo(() => {
    const m = new Map<string, LedgerRow[]>()
    for (const r of rows) {
      const k = `${r.code}|${r.name}|${r.hireDate}`
      m.set(k, [...(m.get(k) ?? []), r])
    }
    return [...m.values()]
  }, [rows])

  return (
    <div className="space-y-4">
      <Card className="no-print">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold text-slate-800">年次有給休暇管理簿</h2>
            <p className="text-sm text-slate-600">労働者ごとに「基準日・日数・時季（取得した日）」をまとめた帳簿です。期間の満了後5年間（当分の間は3年間）保存します。</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="primary"
              disabled={rows.length === 0 || busy}
              onClick={async () => {
                setBusy(true)
                try {
                  await exportExcel(rows, employees, leaves, settings, asOf)
                } finally {
                  setBusy(false)
                }
              }}
            >
              <FileSpreadsheet size={16} /> Excel で保存
            </Button>
            <Button disabled={rows.length === 0} onClick={() => window.print()}>
              <Printer size={16} /> 印刷・PDF で保存
            </Button>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-4 text-sm">
          <label className="flex items-center gap-2">
            載せる期間
            <select className="rounded-lg border border-slate-300 px-2 py-1" value={range} onChange={(e) => setRange(e.target.value as LedgerRange)}>
              <option value="year">直近1年</option>
              <option value="three">直近3年（保存の目安）</option>
              <option value="all">すべて</option>
            </select>
          </label>
          <label className="flex items-center gap-1.5">
            <input type="checkbox" className="h-4 w-4 accent-brand-600" checked={retired} onChange={(e) => setRetired(e.target.checked)} />
            退職者も載せる
          </label>
        </div>
        <p className="mt-2 text-xs text-slate-500">PDF にするときは、印刷の画面で送信先を「PDF に保存」にしてください（用紙は A4 横）。</p>
      </Card>

      {rows.length === 0 ? (
        <Notice>まだ付与日を迎えた人がいません。</Notice>
      ) : (
        <div className="space-y-4">
          <div className="print-only mb-2">
            <h1 className="text-lg font-bold">年次有給休暇管理簿{settings.companyName && `（${settings.companyName}）`}</h1>
            <p className="text-xs">作成日 {fmt(asOf)}・有休ポンで作成</p>
          </div>
          {groups.map((g) => (
            <Card key={`${g[0].code}${g[0].name}${g[0].hireDate}`} className="print-break !p-0 print:!rounded-none print:!border-slate-400 print:!shadow-none">
              <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 border-b border-slate-100 px-4 py-2">
                <h3 className="font-bold text-slate-800">{g[0].name}</h3>
                {g[0].code && <span className="text-sm text-slate-500">社員番号 {g[0].code}</span>}
                <span className="text-sm text-slate-500">入社 {fmt(g[0].hireDate)}</span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[48rem] text-sm">
                  <thead className="bg-slate-50 text-left text-xs text-slate-600">
                    <tr>
                      <th className="px-3 py-1.5">基準日</th>
                      <th className="px-3 py-1.5">契約</th>
                      <th className="px-3 py-1.5 text-right">付与日数</th>
                      <th className="px-3 py-1.5">期間</th>
                      <th className="px-3 py-1.5">取得した日（時季）</th>
                      <th className="px-3 py-1.5 text-right">取得日数</th>
                      <th className="px-3 py-1.5 text-right">期間末の残</th>
                      <th className="px-3 py-1.5">年5日</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 tabular">
                    {g.map((r) => (
                      <tr key={r.grantDate} className="align-top">
                        <td className="whitespace-nowrap px-3 py-1.5">{fmt(r.grantDate)}</td>
                        <td className="whitespace-nowrap px-3 py-1.5">{r.contract}</td>
                        <td className="whitespace-nowrap px-3 py-1.5 text-right">{r.skipped ? '0（8割未満）' : fmtDays(r.days)}</td>
                        <td className="whitespace-nowrap px-3 py-1.5">〜{fmt(r.periodEnd)}</td>
                        <td className="px-3 py-1.5">{datesText(r.dates) || '—'}</td>
                        <td className="whitespace-nowrap px-3 py-1.5 text-right">{fmtDays(r.taken)}</td>
                        <td className="whitespace-nowrap px-3 py-1.5 text-right">
                          {fmtDays(r.balanceAtEnd)}
                          {r.periodEnd > asOf && <span className="block text-[10px] text-slate-500">現在</span>}
                        </td>
                        <td className="px-3 py-1.5 text-xs">{r.obligation}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
