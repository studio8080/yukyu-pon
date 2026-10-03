import { ChevronLeft, ChevronRight, Plus, Trash2, Users } from 'lucide-react'
import { useMemo, useState } from 'react'
import { daysInMonth, fmt, fmtDays, isISODate, parts, ymd, type ISODate } from '../lib/dates'
import { recordDays } from '../lib/engine'
import { parseDateList } from '../lib/importer'
import { leaveLabel, LEAVE_LABEL, type LeaveKind, type LeaveRecord, type Settings } from '../lib/types'
import { useReports } from '../lib/view'
import { useStore } from '../store'
import { Button, Card, Field, inputCls, Notice } from './ui'

/** 区分の選択（設定で使わない区分は出さない）。時間単位のときは時間数も選ぶ */
export function KindPicker({ kind, hours, onChange, settings }: { kind: LeaveKind; hours: number; onChange: (k: LeaveKind, h: number) => void; settings: Settings }) {
  const kinds = (Object.keys(LEAVE_LABEL) as LeaveKind[]).filter(
    (k) => k === 'full' || ((k === 'am' || k === 'pm') && settings.halfDayEnabled) || (k === 'hours' && settings.hourlyEnabled),
  )
  return (
    <div className="flex flex-wrap items-center gap-1" role="radiogroup" aria-label="区分">
      {kinds.map((k) => (
        <button
          key={k}
          type="button"
          role="radio"
          aria-checked={kind === k}
          onClick={() => onChange(k, hours)}
          className={`rounded-lg border px-3 py-1.5 text-sm ${kind === k ? 'border-brand-600 bg-brand-600 text-white' : 'border-slate-300 bg-white text-slate-700'}`}
        >
          {LEAVE_LABEL[k]}
        </button>
      ))}
      {kind === 'hours' && (
        <label className="ml-1 flex items-center gap-1 text-sm">
          <input type="number" min={1} max={12} step={1} className={`${inputCls} !w-20 !py-1`} value={hours} onChange={(e) => onChange('hours', Math.max(1, Math.round(Number(e.target.value) || 1)))} aria-label="時間数" />
          時間
        </label>
      )}
    </div>
  )
}

const asRecord = (employeeId: string, date: ISODate, kind: LeaveKind, hours: number, note?: string): Omit<LeaveRecord, 'id'> =>
  kind === 'hours' ? { employeeId, date, kind, hours, note } : { employeeId, date, kind, note }

export function LeaveEntry({ onOpen }: { onOpen: (id: string) => void }) {
  const employees = useStore((s) => s.employees)
  const leaves = useStore((s) => s.leaves)
  const asOf = useStore((s) => s.asOf)
  const settings = useStore((s) => s.settings)
  const active = employees.filter((e) => !e.retireDate || e.retireDate >= asOf)
  const [empId, setEmpId] = useState('')
  const [text, setText] = useState('')
  const [kind, setKind] = useState<LeaveKind>('full')
  const [hours, setHours] = useState(1)
  const [msg, setMsg] = useState<{ tone: 'ok' | 'warn'; text: string } | null>(null)
  const [month, setMonth] = useState(asOf.slice(0, 7))

  const parsed = useMemo(() => parseDateList(text, parts(asOf)[0]), [text, asOf])

  const submit = () => {
    if (!empId || parsed.dates.length === 0) return
    const n = useStore.getState().addLeaves(parsed.dates.map((date) => asRecord(empId, date, kind, hours)))
    const name = employees.find((e) => e.id === empId)?.name
    const dup = parsed.dates.length - n
    setMsg({ tone: 'ok', text: `${name} さんに ${n}件 追加しました。${dup ? `（${dup}件は登録済みのため省きました）` : ''}` })
    setText('')
  }

  // 月のカレンダー
  const [y, m] = month.split('-').map(Number)
  const first = new Date(Date.UTC(y, m - 1, 1)).getUTCDay()
  const dim = daysInMonth(y, m)
  const byId = useMemo(() => new Map(employees.map((e) => [e.id, e])), [employees])
  const byDay = useMemo(() => {
    const map = new Map<ISODate, LeaveRecord[]>()
    for (const l of leaves) {
      if (!l.date.startsWith(month)) continue
      map.set(l.date, [...(map.get(l.date) ?? []), l])
    }
    return map
  }, [leaves, month])
  const monthTotal = [...byDay.values()].flat().reduce((s, l) => s + (byId.get(l.employeeId) ? recordDays(byId.get(l.employeeId)!, l) : 0), 0)
  const shift = (d: number) => {
    const t = y * 12 + (m - 1) + d
    setMonth(`${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}`)
  }

  if (employees.length === 0) {
    return (
      <Card>
        <p className="text-slate-600">先に従業員を入れてください（ホームの「サンプルで試す」でも試せます）。</p>
      </Card>
    )
  }

  const short = (l: LeaveRecord) => (l.kind === 'am' ? '前' : l.kind === 'pm' ? '後' : l.kind === 'hours' ? `${l.hours}h` : '')

  return (
    <div className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-[22rem_1fr]">
        <Card className="h-fit">
          <h2 className="mb-3 text-lg font-bold text-slate-800">休んだ日を入れる</h2>
          <div className="space-y-3">
            <Field label="だれが">
              <select className={inputCls} value={empId} onChange={(e) => setEmpId(e.target.value)}>
                <option value="">選んでください</option>
                {active.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.code ? `${e.code} ` : ''}
                    {e.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="いつ" hint="複数の日はカンマや改行で区切れます（例: 5/10, 5/11）。年を省くと集計日の年になります。">
              <textarea className={inputCls} rows={3} value={text} placeholder="例: 5/10, 5/11" onChange={(e) => setText(e.target.value)} />
            </Field>
            <KindPicker
              kind={kind}
              hours={hours}
              settings={settings}
              onChange={(k, h) => {
                setKind(k)
                setHours(h)
              }}
            />
            {text && (
              <p className="text-xs text-slate-600">
                読み取り: {parsed.dates.length ? parsed.dates.map((d) => fmt(d, true)).join('、') : 'なし'}
                {parsed.guessed && <span className="text-amber-700">（年を補いました）</span>}
                {parsed.bad.length > 0 && <span className="block text-red-700">読めない: {parsed.bad.join('、')}</span>}
              </p>
            )}
            <Button variant="primary" className="w-full" disabled={!empId || parsed.dates.length === 0 || parsed.bad.length > 0} onClick={submit}>
              <Plus size={16} /> 追加する
            </Button>
            {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
            <button type="button" className="text-sm text-brand-700 underline" onClick={() => setText(fmt(asOf))}>
              集計日（{fmt(asOf)}）を入れる
            </button>
          </div>
        </Card>

        <Card>
          <div className="mb-3 flex items-center justify-between gap-2">
            <Button size="sm" variant="ghost" onClick={() => shift(-1)} aria-label="前の月">
              <ChevronLeft size={18} />
            </Button>
            <h2 className="text-lg font-bold text-slate-800">
              {y}年{m}月 <span className="text-sm font-normal text-slate-500">合計 {fmtDays(Math.round(monthTotal * 10) / 10)}</span>
            </h2>
            <Button size="sm" variant="ghost" onClick={() => shift(1)} aria-label="次の月">
              <ChevronRight size={18} />
            </Button>
          </div>
          <div className="grid grid-cols-7 gap-px overflow-hidden rounded-xl border border-slate-200 bg-slate-200 text-xs">
            {['日', '月', '火', '水', '木', '金', '土'].map((w, i) => (
              <div key={w} className={`bg-slate-50 py-1 text-center font-medium ${i === 0 ? 'text-red-600' : i === 6 ? 'text-sky-700' : 'text-slate-600'}`}>
                {w}
              </div>
            ))}
            {Array.from({ length: first }, (_, i) => (
              <div key={`b${i}`} className="bg-white/60" />
            ))}
            {Array.from({ length: dim }, (_, i) => {
              const d = ymd(y, m, i + 1)
              const list = byDay.get(d) ?? []
              return (
                <div key={d} className={`min-h-16 min-w-0 bg-white p-1 ${d === asOf ? 'ring-2 ring-inset ring-brand-500' : ''}`}>
                  <div className="text-slate-500">{i + 1}</div>
                  <ul className="space-y-0.5">
                    {list.map((l) => {
                      const name = byId.get(l.employeeId)?.name ?? ''
                      return (
                        <li key={l.id} className="group flex items-center gap-0.5">
                          <button type="button" className="min-w-0 flex-1 truncate rounded bg-brand-100 px-1 text-left text-brand-900 hover:bg-brand-200" onClick={() => onOpen(l.employeeId)} title={`${name} ${leaveLabel(l)}${l.note ? `（${l.note}）` : ''}`}>
                            {name.split(/\s/)[0]}
                            <span className="text-[10px]">{short(l)}</span>
                          </button>
                          <button
                            type="button"
                            className="hidden shrink-0 text-slate-400 hover:text-red-600 group-hover:block"
                            aria-label={`${name} の ${d} を削除`}
                            onClick={() => useStore.getState().removeLeave(l.id)}
                          >
                            <Trash2 size={12} />
                          </button>
                        </li>
                      )
                    })}
                  </ul>
                  {empId && isISODate(d) && (
                    <button
                      type="button"
                      className="mt-0.5 w-full rounded text-[10px] text-slate-400 hover:bg-brand-50 hover:text-brand-700"
                      onClick={() => useStore.getState().addLeaves([asRecord(empId, d, kind, hours)])}
                      aria-label={`${d} に追加`}
                    >
                      ＋
                    </button>
                  )}
                </div>
              )
            })}
          </div>
          <p className="mt-2 text-xs text-slate-500">左で人を選ぶと、カレンダーの「＋」でその日を1クリックで追加できます。名前を押すとその人の画面が開きます。</p>
        </Card>
      </div>
      <BulkEntry />
    </div>
  )
}

/** 計画的付与・一斉休暇（夏季休暇など）を、まとめて何人にも登録する */
function BulkEntry() {
  const reports = useReports()
  const asOf = useStore((s) => s.asOf)
  const settings = useStore((s) => s.settings)
  const [text, setText] = useState('')
  const [kind, setKind] = useState<LeaveKind>('full')
  const [hours, setHours] = useState(1)
  const [note, setNote] = useState('計画的付与')
  const [picked, setPicked] = useState<Set<string> | null>(null)
  const [msg, setMsg] = useState('')
  const active = reports.filter((r) => r.active)
  const sel = picked ?? new Set(active.map((r) => r.employee.id))
  const parsed = useMemo(() => parseDateList(text, parts(asOf)[0]), [text, asOf])
  const toggle = (id: string) => {
    const n = new Set(sel)
    if (n.has(id)) n.delete(id)
    else n.add(id)
    setPicked(n)
  }
  const behind = active.filter((r) => r.focus?.status === 'active' && r.focus.needed > 0)

  return (
    <Card>
      <h2 className="mb-1 flex items-center gap-2 text-lg font-bold text-slate-800">
        <Users size={20} className="text-brand-600" /> まとめて登録（計画的付与・一斉休暇）
      </h2>
      <p className="mb-3 text-sm text-slate-600">
        夏季休暇や年末年始に年休をあてる「計画的付与」など、同じ日に何人も休むときに使います。計画的付与は労使協定が必要で、各人の5日を超える分だけが対象です（年5日の取得義務にも数えます）。
      </p>
      <div className="grid gap-4 md:grid-cols-[1fr_1.4fr]">
        <div className="space-y-3">
          <Field label="日付" hint="複数の日はカンマや改行で区切れます。">
            <textarea className={inputCls} rows={2} value={text} placeholder="例: 8/13, 8/14" onChange={(e) => setText(e.target.value)} />
          </Field>
          <KindPicker
            kind={kind}
            hours={hours}
            settings={settings}
            onChange={(k, h) => {
              setKind(k)
              setHours(h)
            }}
          />
          <Field label="メモ">
            <input className={inputCls} value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>
          {text && (
            <p className="text-xs text-slate-600">
              読み取り: {parsed.dates.map((d) => fmt(d, true)).join('、') || 'なし'}
              {parsed.bad.length > 0 && <span className="block text-red-700">読めない: {parsed.bad.join('、')}</span>}
            </p>
          )}
          <Button
            variant="primary"
            disabled={sel.size === 0 || parsed.dates.length === 0 || parsed.bad.length > 0}
            onClick={() => {
              const recs = [...sel].flatMap((id) => parsed.dates.map((d) => asRecord(id, d, kind, hours, note || undefined)))
              const n = useStore.getState().addLeaves(recs)
              setMsg(`${sel.size}人 × ${parsed.dates.length}日 のうち ${n}件を登録しました。`)
              setText('')
            }}
          >
            <Plus size={16} /> {sel.size}人に登録する
          </Button>
          {msg && <Notice tone="ok">{msg}</Notice>}
        </div>
        <div>
          <div className="mb-2 flex flex-wrap gap-2 text-sm">
            <Button size="sm" onClick={() => setPicked(new Set(active.map((r) => r.employee.id)))}>
              全員
            </Button>
            <Button size="sm" onClick={() => setPicked(new Set())}>
              全員はずす
            </Button>
            <Button size="sm" onClick={() => setPicked(new Set(behind.map((r) => r.employee.id)))}>
              年5日がまだの人だけ（{behind.length}）
            </Button>
          </div>
          <ul className="max-h-64 divide-y divide-slate-100 overflow-y-auto rounded-xl border border-slate-200">
            {active.map((r) => (
              <li key={r.employee.id}>
                <label className="flex cursor-pointer items-center gap-2 px-3 py-1.5 text-sm hover:bg-slate-50">
                  <input type="checkbox" className="h-4 w-4 accent-brand-600" checked={sel.has(r.employee.id)} onChange={() => toggle(r.employee.id)} />
                  <span className="flex-1">{r.employee.name}</span>
                  {r.focus?.status === 'active' && r.focus.needed > 0 && <span className="text-xs text-amber-800">あと{fmtDays(r.focus.needed)}</span>}
                  <span className="text-xs text-slate-500">残 {fmtDays(Math.round(r.balance * 10) / 10)}</span>
                </label>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </Card>
  )
}
