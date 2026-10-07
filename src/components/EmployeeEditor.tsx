import { AlertTriangle, Plus, Trash2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import { addDays, fmt, fmtBalance, fmtDays, isISODate, type ISODate } from '../lib/dates'
import { newId } from '../lib/defaults'
import { buildReport, categoryLabel, categoryOf, contractLabel, TENURE_LABEL, type GrantEvent } from '../lib/engine'
import { leaveLabel, type Contract, type Employee, type LeaveKind } from '../lib/types'
import { windowDetail, windowLabel } from '../lib/view'
import { useStore } from '../store'
import { AttendanceDialog } from './AttendanceDialog'
import { KindPicker } from './LeaveEntry'
import { Badge, Button, Field, inputCls, Modal, Notice } from './ui'

type Tab = 'basic' | 'contract' | 'grants' | 'leaves' | 'balance'

export function EmployeeEditor({ id, onClose }: { id: string | null; onClose: () => void }) {
  const emp = useStore((s) => s.employees.find((e) => e.id === id))
  const [tab, setTab] = useState<Tab>('basic')
  return (
    <Modal open={!!emp} onClose={onClose} title={emp?.name || '従業員'} wide>
      {emp && (
        <>
          <div className="-mx-1 mb-4 flex gap-1 overflow-x-auto pb-1" role="tablist">
            {(
              [
                ['basic', '基本'],
                ['contract', '契約'],
                ['grants', '付与と5日'],
                ['leaves', '休んだ日'],
                ['balance', '残高・移行'],
              ] as [Tab, string][]
            ).map(([k, l]) => (
              <button
                key={k}
                role="tab"
                aria-selected={tab === k}
                onClick={() => setTab(k)}
                className={`shrink-0 min-h-9 rounded-full px-4 py-1.5 text-sm font-bold ${tab === k ? 'bg-brand-500 text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'}`}
              >
                {l}
              </button>
            ))}
          </div>
          <Warnings emp={emp} />
          {tab === 'basic' && <Basic emp={emp} onDeleted={onClose} />}
          {tab === 'contract' && <Contracts emp={emp} />}
          {tab === 'grants' && <Grants emp={emp} />}
          {tab === 'leaves' && <Leaves emp={emp} />}
          {tab === 'balance' && <Balance emp={emp} />}
        </>
      )}
    </Modal>
  )
}

function useReport(emp: Employee) {
  const leaves = useStore((s) => s.leaves)
  const settings = useStore((s) => s.settings)
  const asOf = useStore((s) => s.asOf)
  return useMemo(() => buildReport(emp, leaves, settings, asOf), [emp, leaves, settings, asOf])
}

function Warnings({ emp }: { emp: Employee }) {
  const r = useReport(emp)
  if (r.warnings.length === 0) return null
  return (
    <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-sun-700">
      <p className="mb-1 flex items-center gap-1 font-semibold">
        <AlertTriangle size={16} /> 確認してください
      </p>
      <ul className="list-disc space-y-0.5 pl-5">
        {r.warnings.map((w) => (
          <li key={w}>{w}</li>
        ))}
      </ul>
    </div>
  )
}

function Basic({ emp, onDeleted }: { emp: Employee; onDeleted: () => void }) {
  const update = useStore((s) => s.updateEmployee)
  const set = (p: Partial<Employee>) => update(emp.id, p)
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Field label="氏名">
        <input className={inputCls} value={emp.name} onChange={(e) => set({ name: e.target.value })} />
      </Field>
      <Field label="社員番号（任意）">
        <input className={inputCls} value={emp.code} onChange={(e) => set({ code: e.target.value })} />
      </Field>
      <Field label="入社日" hint="雇い入れた日。最初の付与はこの6か月後です（会社のルールで前倒しもできます）。">
        <input
          type="date"
          className={inputCls}
          value={emp.hireDate}
          onChange={(e) => {
            const d = e.target.value
            if (!isISODate(d)) return
            // 入社日を直したら、最初の契約の開始日もそろえる
            const contracts = [...emp.contracts].sort((a, b) => (a.from < b.from ? -1 : 1))
            if (contracts[0] && contracts[0].from > d) contracts[0] = { ...contracts[0], from: d }
            if (contracts[0] && contracts[0].from === emp.hireDate) contracts[0] = { ...contracts[0], from: d }
            set({ hireDate: d, contracts })
          }}
        />
      </Field>
      <Field label="退職日（任意）" hint="最後に在籍した日。これより後は付与しません。">
        <input type="date" className={inputCls} value={emp.retireDate ?? ''} onChange={(e) => set({ retireDate: e.target.value || null })} />
      </Field>
      <Field label="メモ" className="sm:col-span-2">
        <textarea className={inputCls} rows={2} value={emp.memo} onChange={(e) => set({ memo: e.target.value })} />
      </Field>
      <div className="sm:col-span-2">
        <Button
          variant="danger"
          size="sm"
          onClick={() => {
            if (confirm(`${emp.name} さんと、その人の休んだ日の記録をすべて削除します。よろしいですか？`)) {
              useStore.getState().removeEmployee(emp.id)
              onDeleted()
            }
          }}
        >
          <Trash2 size={14} /> この人を削除
        </Button>
      </div>
    </div>
  )
}

function ContractInputs({ c, onChange }: { c: Contract; onChange: (c: Contract) => void }) {
  const hourly = useStore((s) => s.settings.hourlyEnabled)
  return (
    <div className="flex flex-wrap items-center gap-2">
      <select
        className={`${inputCls} !w-auto`}
        value={c.daysPerWeek}
        onChange={(e) => onChange({ ...c, daysPerWeek: Number(e.target.value), over30h: Number(e.target.value) >= 5 ? true : c.over30h })}
        aria-label="週の勤務日数"
      >
        {[5, 4, 3, 2, 1].map((n) => (
          <option key={n} value={n}>
            週{n}日{n === 5 ? '以上' : ''}
          </option>
        ))}
        <option value={0}>シフト制（年間の日数で決める）</option>
      </select>
      {c.daysPerWeek === 0 && (
        <label className="flex items-center gap-1 text-sm">
          年
          <input
            type="number"
            min={0}
            max={366}
            className={`${inputCls} !w-24`}
            value={c.annualDays ?? ''}
            onChange={(e) => onChange({ ...c, annualDays: Number(e.target.value) })}
          />
          日
        </label>
      )}
      <label className="flex items-center gap-1.5 text-sm">
        <input type="checkbox" className="h-4 w-4 accent-brand-500" checked={c.over30h} onChange={(e) => onChange({ ...c, over30h: e.target.checked })} />
        週30時間以上
      </label>
      {hourly && (
        <label className="flex items-center gap-1 text-sm">
          1日
          <input
            type="number"
            min={1}
            max={24}
            step={0.25}
            className={`${inputCls} !w-20 !py-1`}
            value={c.hoursPerDay ?? 8}
            onChange={(e) => onChange({ ...c, hoursPerDay: Number(e.target.value) || 8 })}
            aria-label="1日の所定労働時間"
          />
          時間
        </label>
      )}
    </div>
  )
}

function Contracts({ emp }: { emp: Employee }) {
  const update = useStore((s) => s.updateEmployee)
  const asOf = useStore((s) => s.asOf)
  const list = [...emp.contracts].sort((a, b) => (a.from < b.from ? -1 : 1))
  const setList = (contracts: Contract[]) => update(emp.id, { contracts })
  return (
    <div className="space-y-4">
      <Notice>
        付与日数は<strong>付与する日（基準日）の時点の契約</strong>で決まります。週3日のパートが正社員になったときは、上書きせずに「契約を変更する」で行を足してください。
        過去の付与はそのまま残り、次の付与から新しい契約で計算します。
      </Notice>
      <ol className="space-y-3">
        {list.map((c, i) => (
          <li key={`${c.from}-${i}`} className="rounded-2xl border border-line p-3">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <label className="flex items-center gap-2 text-sm">
                <span className="font-medium">{i === 0 ? '入社時の契約' : '変更後の契約'}</span>
                {i > 0 && (
                  <input
                    type="date"
                    className={`${inputCls} !w-auto !py-1`}
                    value={c.from}
                    onChange={(e) => isISODate(e.target.value) && setList(list.map((x, j) => (j === i ? { ...x, from: e.target.value } : x)))}
                  />
                )}
                {i > 0 && <span className="text-slate-500">から</span>}
              </label>
              {i > 0 && (
                <Button size="sm" variant="ghost" onClick={() => setList(list.filter((_, j) => j !== i))}>
                  <Trash2 size={14} /> 削除
                </Button>
              )}
            </div>
            <ContractInputs c={c} onChange={(nc) => setList(list.map((x, j) => (j === i ? nc : x)))} />
            <p className="mt-2 text-xs text-slate-500">付与の区分: {categoryLabel(categoryOf(c))}</p>
          </li>
        ))}
      </ol>
      <Button
        size="sm"
        onClick={() => {
          const last = list[list.length - 1]
          setList([...list, { ...(last ?? { daysPerWeek: 5, over30h: true }), from: asOf > (last?.from ?? '') ? asOf : addDays(last.from, 1) }])
        }}
      >
        <Plus size={14} /> 契約を変更する
      </Button>
      <p className="text-xs text-slate-500">
        {useStore.getState().settings.hourlyEnabled && '1日の時間は、時間単位の年休で「1日＝何時間」とみなすのに使います（7.5時間なら8時間に切り上げ）。'}
        判定: 週5日以上、または週30時間以上 → 通常の付与（10日〜）。週4日以下かつ30時間未満 → 比例付与。シフト制で週の日数が決まっていない人は年間の所定労働日数で判定します（217日以上は通常）。
      </p>
    </div>
  )
}

function Grants({ emp }: { emp: Employee }) {
  const r = useReport(emp)
  const update = useStore((s) => s.updateEmployee)
  const rows = r.schedule.filter((g, i) => g.date <= r.asOf || i === r.schedule.findIndex((x) => x.date > r.asOf))
  const setAdj = (date: ISODate, p: { days?: number | null; skipped?: boolean; note?: string }) =>
    update(emp.id, (e) => {
      const cur = { ...(e.adjustments[date] ?? {}) }
      if ('days' in p) {
        if (p.days == null || Number.isNaN(p.days)) delete cur.days
        else cur.days = p.days
      }
      if ('skipped' in p) cur.skipped = p.skipped || undefined
      if ('note' in p) cur.note = p.note || undefined
      const adjustments = { ...e.adjustments }
      if (cur.days == null && !cur.skipped && !cur.note) delete adjustments[date]
      else adjustments[date] = cur
      return { ...e, adjustments }
    })
  const winOf = (date: ISODate) => r.windows.find((w) => w.grantDate === date)
  const [att, setAtt] = useState<GrantEvent | null>(null)
  const clearAtt = (date: ISODate) =>
    update(emp.id, (e) => {
      const cur = { ...(e.adjustments[date] ?? {}) }
      delete cur.attendance
      const adjustments = { ...e.adjustments }
      if (cur.days == null && !cur.skipped && !cur.note) delete adjustments[date]
      else adjustments[date] = cur
      return { ...e, adjustments }
    })

  return (
    <div className="space-y-4">
      <div className="overflow-x-auto rounded-2xl border border-line">
        <table className="w-full min-w-[44rem] text-sm">
          <thead className="bg-paper text-left text-xs font-bold text-slate-600">
            <tr>
              <th className="px-3 py-2">付与日</th>
              <th className="px-3 py-2">勤続</th>
              <th className="px-3 py-2">その日の契約</th>
              <th className="px-3 py-2 text-right">法定</th>
              <th className="px-3 py-2">付与する日数</th>
              <th className="px-3 py-2">出勤率</th>
              <th className="px-3 py-2">年5日</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {rows.map((g) => {
              const w = winOf(g.date)
              const future = g.date > r.asOf
              return (
                <tr key={g.date} className={future ? 'bg-brand-50/40' : ''}>
                  <td className="px-3 py-2 tabular whitespace-nowrap">
                    {fmt(g.date)}
                    {future && <span className="ml-1 text-xs text-brand-700">次回</span>}
                    {g.advanced && <span className="ml-1 text-xs text-slate-500">前倒し</span>}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">{TENURE_LABEL[Math.min(g.step, 6)]}</td>
                  <td className="px-3 py-2 whitespace-nowrap">{g.contract ? contractLabel(g.contract) : '—'}</td>
                  <td className="px-3 py-2 text-right tabular">{g.statutory}日</td>
                  <td className="px-3 py-2">
                    <input
                      type="number"
                      step={0.5}
                      min={0}
                      max={40}
                      disabled={g.skipped}
                      aria-label={`${g.date} に付与する日数`}
                      className={`${inputCls} !w-20 !py-1 ${g.adjusted && !g.skipped ? '!border-amber-400 !bg-amber-50' : ''}`}
                      value={g.skipped ? 0 : g.days}
                      onChange={(e) => {
                        const v = e.target.value === '' ? null : Number(e.target.value)
                        setAdj(g.date, { days: v === g.statutory ? null : v })
                      }}
                    />
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    {g.skipped ? (
                      <button type="button" className="rounded bg-red-50 px-1.5 text-xs text-red-800 underline" onClick={() => setAdj(g.date, { skipped: false })} title="押すと取り消します">
                        8割未満
                      </button>
                    ) : g.attendance ? (
                      <button
                        type="button"
                        className="rounded bg-brand-50 px-1.5 text-xs text-brand-800 underline"
                        onClick={() => confirm('出勤率の確認を取り消しますか？') && clearAtt(g.date)}
                        title={g.attendance.workDays ? `${g.attendance.presentDays}/${g.attendance.workDays}日` : ''}
                      >
                        確認済み
                      </button>
                    ) : g.date > g.periodFrom && g.statutory > 0 ? (
                      <Button size="sm" onClick={() => setAtt(g)}>
                        確認する
                      </Button>
                    ) : (
                      <span className="text-xs text-slate-400">—</span>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    {w ? (
                      <span title={windowDetail(w)}>
                        <Badge level={w.status === 'done' ? 'done' : w.level}>{windowLabel(w)}</Badge>
                      </span>
                    ) : (
                      <span className="text-xs text-slate-500">対象外</span>
                    )}
                  </td>
                </tr>
              )
            })}
            {rows.length === 0 && (
              <tr>
                <td colSpan={7} className="px-3 py-6 text-center text-slate-500">
                  まだ付与日が来ていません。
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <AttendanceDialog emp={att ? emp : null} grant={att} onClose={() => setAtt(null)} />
      <ul className="list-disc space-y-1 pl-5 text-xs text-slate-600">
        <li>付与日数は自動計算です。会社独自に多く付与するときだけ、数字を書き換えてください（黄色になります）。法定より少なくはできません。</li>
        <li>付与の前に「確認する」で出勤率8割以上かを確かめて記録します。8割未満なら、その回は付与なしになります（勤続年数は進みます）。</li>
        <li>年5日の義務は、法定の付与が10日以上の回だけにかかります（パートの比例付与で10日未満なら対象外）。</li>
      </ul>
      <ExtraGrants emp={emp} />
    </div>
  )
}

function ExtraGrants({ emp }: { emp: Employee }) {
  const update = useStore((s) => s.updateEmployee)
  const asOf = useStore((s) => s.asOf)
  const [date, setDate] = useState(asOf)
  const [days, setDays] = useState(1)
  const [note, setNote] = useState('')
  return (
    <div className="rounded-2xl border border-line p-3">
      <h3 className="mb-1 font-bold text-ink">会社独自の上乗せ</h3>
      <p className="mb-3 text-xs text-slate-500">創業記念の+1日など、法定とは別に付与した年休。残日数に足します（時効は2年として計算）。</p>
      {emp.extraGrants.length > 0 && (
        <ul className="mb-3 divide-y divide-line text-sm">
          {emp.extraGrants.map((x) => (
            <li key={x.id} className="flex items-center justify-between gap-2 py-1.5">
              <span>
                {fmt(x.date)}・{fmtDays(x.days)}
                {x.note && <span className="text-slate-500">（{x.note}）</span>}
              </span>
              <Button size="sm" variant="ghost" aria-label="削除" onClick={() => update(emp.id, { extraGrants: emp.extraGrants.filter((y) => y.id !== x.id) })}>
                <Trash2 size={14} />
              </Button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-wrap items-end gap-2">
        <input type="date" className={`${inputCls} !w-auto`} value={date} onChange={(e) => setDate(e.target.value)} aria-label="付与日" />
        <input type="number" min={0.5} step={0.5} className={`${inputCls} !w-20`} value={days} onChange={(e) => setDays(Number(e.target.value))} aria-label="日数" />
        <input className={`${inputCls} !w-48`} placeholder="メモ（例: 創業記念）" value={note} onChange={(e) => setNote(e.target.value)} />
        <Button
          size="sm"
          disabled={!isISODate(date) || !(days > 0)}
          onClick={() => {
            update(emp.id, { extraGrants: [...emp.extraGrants, { id: newId(), date, days, validMonths: 24, note }] })
            setNote('')
          }}
        >
          <Plus size={14} /> 追加
        </Button>
      </div>
    </div>
  )
}

function Leaves({ emp }: { emp: Employee }) {
  const all = useStore((s) => s.leaves)
  const asOf = useStore((s) => s.asOf)
  const r = useReport(emp)
  const list = all.filter((l) => l.employeeId === emp.id).sort((a, b) => (a.date < b.date ? 1 : -1))
  const [date, setDate] = useState(asOf)
  const [kind, setKind] = useState<LeaveKind>('full')
  const [hours, setHours] = useState(1)
  const settings = useStore((s) => s.settings)
  const [note, setNote] = useState('')
  const shortfall = new Set(r.uses.filter((u) => u.shortfall > 0).map((u) => u.record.id))
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-2 rounded-2xl bg-brand-50 p-4">
        <Field label="休んだ日">
          <input type="date" className={`${inputCls} !w-auto`} value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <div>
          <span className="mb-1 block text-sm font-medium text-slate-700">区分</span>
          <KindPicker
            kind={kind}
            hours={hours}
            settings={settings}
            onChange={(k, h) => {
              setKind(k)
              setHours(h)
            }}
          />
        </div>
        <Field label="メモ（任意）">
          <input className={`${inputCls} !w-44`} placeholder="時季指定・計画付与など" value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
        <Button
          variant="primary"
          disabled={!isISODate(date)}
          onClick={() => {
            useStore.getState().addLeaves([{ employeeId: emp.id, date, kind, ...(kind === 'hours' ? { hours } : {}), note: note || undefined }])
            setNote('')
          }}
        >
          <Plus size={16} /> 追加
        </Button>
      </div>
      {list.length === 0 ? (
        <p className="py-6 text-center text-slate-500">まだ記録がありません。</p>
      ) : (
        <ul className="divide-y divide-line rounded-2xl border border-line">
          {list.map((l) => (
            <li key={l.id} className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
              <span className="tabular">
                {fmt(l.date, true)}
                <span className="ml-2 text-slate-600">{leaveLabel(l)}</span>
                {l.date > asOf && <span className="ml-2 rounded bg-sky-50 px-1.5 text-xs text-sky-800">予定</span>}
                {shortfall.has(l.id) && <span className="ml-2 rounded bg-amber-100 px-1.5 text-xs text-sun-700">残日数不足</span>}
                {l.note && <span className="ml-2 text-slate-500">{l.note}</span>}
              </span>
              <Button size="sm" variant="ghost" aria-label={`${l.date} の記録を削除`} onClick={() => useStore.getState().removeLeave(l.id)}>
                <Trash2 size={14} />
              </Button>
            </li>
          ))}
        </ul>
      )}
      <p className="text-xs text-slate-500">
        半休は0.5日として年5日に数えます。時間単位の年休は残日数からは引きますが、年5日の義務には数えません。
        {!settings.hourlyEnabled && ' 時間単位は「設定」で使うにすると入れられます（労使協定が必要です）。'}
      </p>
    </div>
  )
}

function Balance({ emp }: { emp: Employee }) {
  const r = useReport(emp)
  const update = useStore((s) => s.updateEmployee)
  const asOf = useStore((s) => s.asOf)
  const [migrate, setMigrate] = useState(!!emp.trackingStart)
  const hourly = useStore((s) => s.settings.hourlyEnabled)
  const f = (n: number) => fmtBalance(n, r.hoursPerDay, hourly)
  return (
    <div className="space-y-5">
      <div>
        <p className="mb-2 text-sm text-slate-600">
          {fmt(asOf)} の時点の残日数: <strong className="text-lg text-brand-800">{f(r.balance)}</strong>
        </p>
        <div className="overflow-x-auto rounded-2xl border border-line">
          <table className="w-full min-w-[36rem] text-sm">
            <thead className="bg-paper text-left text-xs font-bold text-slate-600">
              <tr>
                <th className="px-3 py-2">付与日</th>
                <th className="px-3 py-2">内容</th>
                <th className="px-3 py-2 text-right">付与</th>
                <th className="px-3 py-2 text-right">使用</th>
                <th className="px-3 py-2 text-right">時効</th>
                <th className="px-3 py-2 text-right">残り</th>
                <th className="px-3 py-2">使える期限</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line tabular">
              {r.lots.map((l) => (
                <tr key={l.key} className={l.expires <= asOf ? 'text-slate-400' : ''}>
                  <td className="px-3 py-2">{fmt(l.grantDate)}</td>
                  <td className="px-3 py-2">{l.label}</td>
                  <td className="px-3 py-2 text-right">{f(l.granted)}</td>
                  <td className="px-3 py-2 text-right">{f(l.used)}</td>
                  <td className="px-3 py-2 text-right">{l.lapsed ? f(l.lapsed) : '—'}</td>
                  <td className="px-3 py-2 text-right font-semibold">{f(l.remaining)}</td>
                  <td className="px-3 py-2">{fmt(addDays(l.expires, -1))}</td>
                </tr>
              ))}
              {r.lots.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-3 py-6 text-center text-slate-500">
                    まだ付与がありません。
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <p className="mt-1 text-xs text-slate-500">年休は付与日から2年で時効になります。取得した日は{useStore.getState().settings.consumeOrder === 'newest' ? '新しい' : '古い'}付与分から引いています（設定で変えられます）。</p>
      </div>

      <div className="rounded-2xl border border-line p-3">
        <label className="flex items-center gap-2 font-bold text-ink">
          <input
            type="checkbox"
            className="h-4 w-4 accent-brand-500"
            checked={migrate}
            onChange={(e) => {
              setMigrate(e.target.checked)
              if (!e.target.checked) update(emp.id, { trackingStart: null, openingLots: [] })
            }}
          />
          Excel などから引っ越す（途中から管理を始める）
        </label>
        {migrate && (
          <div className="mt-3 space-y-3">
            <Notice tone="warn">入れる前に、Excel や賃金台帳の残日数・付与日と照らし合わせてください。ここに入れた数字がそのまま残高の出発点になります。</Notice>
            <p className="text-sm text-slate-600">
              管理開始日より前の付与と取得は計算に入れず、その日の時点の残日数を「付与日ごと」に入れてもらいます。
              付与日がわかると、2年の時効を正しく計算できます。
            </p>
            <Field label="管理開始日" hint="この日より前に休んだ日も記録できます（年5日の集計にだけ使い、残日数からは引きません）。">
              <input
                type="date"
                className={`${inputCls} !w-auto`}
                value={emp.trackingStart ?? ''}
                onChange={(e) => update(emp.id, { trackingStart: e.target.value || null })}
              />
            </Field>
            <div>
              <p className="mb-1 text-sm font-medium text-slate-700">管理開始日の時点の残り</p>
              {r.schedule.filter((g) => g.date < (emp.trackingStart || '') && g.date >= addDays(emp.trackingStart || '', -731)).length === 0 && (
                <p className="text-xs text-slate-500">管理開始日の前2年に付与日がありません。</p>
              )}
              <ul className="space-y-2">
                {r.schedule
                  .filter((g) => emp.trackingStart && g.date < emp.trackingStart && g.date >= addDays(emp.trackingStart, -731))
                  .map((g) => {
                    const lot = emp.openingLots.find((o) => o.grantDate === g.date)
                    return (
                      <li key={g.date} className="flex flex-wrap items-center gap-2 text-sm">
                        <span className="w-48 tabular">
                          {fmt(g.date)} 付与分（{fmtDays(g.days)}）
                        </span>
                        <span>残り</span>
                        <input
                          type="number"
                          min={0}
                          step={0.5}
                          className={`${inputCls} !w-24 !py-1`}
                          value={lot?.days ?? ''}
                          placeholder="0"
                          onChange={(e) => {
                            const v = e.target.value === '' ? null : Number(e.target.value)
                            const rest = emp.openingLots.filter((o) => o.grantDate !== g.date)
                            update(emp.id, { openingLots: v == null ? rest : [...rest, { id: lot?.id ?? newId(), grantDate: g.date, days: v }] })
                          }}
                        />
                        <span>日</span>
                      </li>
                    )
                  })}
              </ul>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
