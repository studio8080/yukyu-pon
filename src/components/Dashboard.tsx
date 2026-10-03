import { AlertTriangle, CalendarClock, CalendarPlus, CheckCircle2, ClipboardCheck, FileSpreadsheet, Hourglass, Plus, Sparkles, UserRound } from 'lucide-react'
import { useMemo, useState } from 'react'
import { addDays, addMonthsCivil, fmt, fmtBalance, fmtDays } from '../lib/dates'
import type { GrantEvent, Report } from '../lib/engine'
import { contractAt, contractLabel } from '../lib/engine'
import { makeSample } from '../lib/sample'
import { useReports, windowDetail, windowLabel } from '../lib/view'
import { usePlan, type Plan } from '../lib/plan'
import { FREE_LIMIT } from '../config'
import type { Employee } from '../lib/types'
import { blankEmployee, useStore } from '../store'
import { AttendanceDialog } from './AttendanceDialog'
import { Badge, Button, Card } from './ui'

type Filter = 'all' | 'action' | 'active' | 'retired'

export function Dashboard({ onOpen, onNavigate }: { onOpen: (id: string) => void; onNavigate: (tab: string) => void }) {
  const reports = useReports()
  const asOf = useStore((s) => s.asOf)
  const [filter, setFilter] = useState<Filter>('active')
  const plan = usePlan()
  const [att, setAtt] = useState<{ emp: Employee; grant: GrantEvent } | null>(null)
  const due = reports.filter((r) => r.active).flatMap((r) => r.attendanceDue.map((g) => ({ emp: r.employee, grant: g })))

  const stats = useMemo(() => {
    const act = reports.filter((r) => r.active)
    const soon = addMonthsCivil(asOf, 1)
    return {
      red: act.filter((r) => r.level === 'red' && r.focus?.status === 'active').length,
      missed: act.filter((r) => r.missed.length > 0).length,
      yellow: act.filter((r) => r.level === 'yellow').length,
      grants: act.filter((r) => r.nextGrant && r.nextGrant.date <= soon && r.nextGrant.days > 0).length,
      expiring: act.reduce((s, r) => s + r.expiringSoon.reduce((t, x) => t + x.days, 0), 0),
      warnings: act.filter((r) => r.warnings.length > 0).length,
      total: act.length,
    }
  }, [reports, asOf])

  if (reports.length === 0) return <Welcome onNavigate={onNavigate} onOpen={onOpen} plan={plan} />

  const shown = reports.filter((r) =>
    filter === 'all' ? true : filter === 'retired' ? !r.active : filter === 'action' ? r.active && (r.level === 'red' || r.level === 'yellow') : r.active,
  )
  shown.sort((a, b) => rank(b) - rank(a))

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat icon={<AlertTriangle size={18} />} tone="red" label="至急（5日の期限まで1か月以内）" value={`${stats.red}人`} onClick={() => setFilter('action')} />
        <Stat icon={<Hourglass size={18} />} tone="yellow" label="注意（期限まで3か月以内）" value={`${stats.yellow}人`} onClick={() => setFilter('action')} />
        <Stat icon={<CalendarPlus size={18} />} tone="brand" label="1か月以内に付与がある" value={`${stats.grants}人`} />
        <Stat icon={<CalendarClock size={18} />} tone="slate" label="3か月以内に時効で消える" value={fmtDays(stats.expiring)} />
      </div>

      {stats.missed > 0 && (
        <p className="flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-900">
          <AlertTriangle size={16} className="shrink-0" />
          この1年で、5日に届かないまま期限を過ぎた人が{stats.missed}人います。記録の漏れが無いか確かめ、今の期間で確実に取れるよう計画してください。
        </p>
      )}
      {due.length > 0 && (
        <Card className="!border-sky-200 !bg-sky-50/60">
          <h2 className="mb-1 flex items-center gap-2 font-bold text-sky-900">
            <ClipboardCheck size={18} /> 付与の前に、出勤率の確認（{due.length}件）
          </h2>
          <p className="mb-2 text-sm text-sky-900">
            前の期間の出勤率が8割以上なら付与、8割未満ならその回は付与しません。タイムカード等で確かめて記録してください。
          </p>
          <ul className="divide-y divide-sky-100 rounded-xl bg-white">
            {due.slice(0, 8).map(({ emp, grant }) => (
              <li key={emp.id + grant.date} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
                <span>
                  <strong>{emp.name}</strong>
                  <span className="ml-2 text-slate-600">
                    {fmt(grant.date)} に {grant.statutory}日 付与（対象期間 {fmt(grant.periodFrom)}〜{fmt(addDays(grant.date, -1))}）
                  </span>
                </span>
                <Button size="sm" onClick={() => setAtt({ emp, grant })}>
                  確認する
                </Button>
              </li>
            ))}
          </ul>
          {due.length > 8 && <p className="mt-1 text-xs text-sky-900">ほか {due.length - 8}件。各人の「付与と5日」からも確認できます。</p>}
          <AttendanceDialog emp={att?.emp ?? null} grant={att?.grant ?? null} onClose={() => setAtt(null)} />
        </Card>
      )}
      {stats.warnings > 0 && (
        <p className="flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          <AlertTriangle size={16} className="shrink-0" />
          {stats.warnings}人に確認してほしい点があります。名前の横の <span aria-hidden>⚠</span> から開いてください。
        </p>
      )}

      <Card className="!p-0">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-3">
          <div className="flex flex-wrap gap-1" role="tablist" aria-label="表示する人">
            {(
              [
                ['active', `在籍中（${stats.total}）`],
                ['action', '要対応だけ'],
                ['retired', '退職者'],
                ['all', 'すべて'],
              ] as [Filter, string][]
            ).map(([k, label]) => (
              <button
                key={k}
                role="tab"
                aria-selected={filter === k}
                onClick={() => setFilter(k)}
                className={`rounded-full px-3 py-1 text-sm ${filter === k ? 'bg-brand-700 text-white' : 'text-slate-600 hover:bg-slate-100'}`}
              >
                {label}
              </button>
            ))}
          </div>
          <AddButton plan={plan} onOpen={onOpen} size="sm" />
        </div>

        {shown.length === 0 ? (
          <p className="px-4 py-10 text-center text-slate-500">該当する人はいません。</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {shown.map((r) => (
              <Row key={r.employee.id} r={r} onOpen={onOpen} />
            ))}
          </ul>
        )}
      </Card>
    </div>
  )
}

function rank(r: Report): number {
  return { red: 4, yellow: 3, ok: 2, done: 1, none: 0 }[r.level] * 1000 - (r.focus?.daysLeft ?? 999)
}

function Row({ r, onOpen }: { r: Report; onOpen: (id: string) => void }) {
  const e = r.employee
  const c = contractAt(e, r.asOf)
  const w = r.focus
  const pct = w ? Math.min(100, (w.taken / 5) * 100) : 0
  const ppct = w ? Math.min(100 - pct, (w.planned / 5) * 100) : 0
  const hourly = useStore.getState().settings.hourlyEnabled
  return (
    <li>
      <button type="button" onClick={() => onOpen(e.id)} className="grid w-full grid-cols-1 gap-2 px-4 py-3 text-left hover:bg-brand-50/50 sm:grid-cols-[minmax(10rem,1.3fr)_7rem_minmax(8rem,1fr)_minmax(14rem,2fr)] sm:items-center sm:gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2 font-semibold text-slate-800">
            <span className="truncate">{e.name || '（名前なし）'}</span>
            {r.warnings.length > 0 && (
              <span title={r.warnings.join('\n')} className="text-amber-600" aria-label={`確認事項 ${r.warnings.length}件`}>
                ⚠
              </span>
            )}
            {!r.active && <Badge level="none">退職</Badge>}
            {r.active && r.missed.length > 0 && r.focus?.status !== 'missed' && <Badge level="red">過去に未達</Badge>}
          </div>
          <div className="text-xs text-slate-500">
            {e.code && <span className="mr-2">#{e.code}</span>}入社 {fmt(e.hireDate)}・{c ? contractLabel(c) : '契約未入力'}
          </div>
        </div>
        <div className="flex items-baseline gap-1 sm:block">
          <span className="text-xs text-slate-500 sm:block">残日数</span>
          <span className="tabular text-xl font-bold text-brand-800">{fmtBalance(r.balance, r.hoursPerDay, hourly)}</span>
        </div>
        <div className="text-sm">
          <span className="text-xs text-slate-500 sm:block">次の付与 </span>
          {r.nextGrant ? (
            <span className="tabular">
              {fmt(r.nextGrant.date)}・{r.nextGrant.skipped ? 'なし' : fmtDays(r.nextGrant.days)}
            </span>
          ) : (
            '—'
          )}
        </div>
        <div className="min-w-0">
          <div className="mb-1 flex items-center justify-between gap-2">
            <Badge level={r.level}>
              {r.level === 'done' ? <CheckCircle2 size={12} /> : null}
              {windowLabel(w)}
            </Badge>
            {w && <span className="tabular text-xs text-slate-500">{fmtDays(w.taken)} / 5日</span>}
          </div>
          {w ? (
            <>
              <div className="flex h-2 overflow-hidden rounded-full bg-slate-100" aria-hidden>
                <div className={r.level === 'red' ? 'bg-red-500' : r.level === 'yellow' ? 'bg-sun-500' : 'bg-brand-500'} style={{ width: `${pct}%` }} />
                <div className="bg-brand-200" style={{ width: `${ppct}%` }} />
              </div>
              <div className="mt-1 truncate text-xs text-slate-500">{windowDetail(w)}</div>
            </>
          ) : (
            <div className="text-xs text-slate-500">年10日以上の付与が無いため、5日の義務はありません</div>
          )}
        </div>
      </button>
    </li>
  )
}

function Stat({ icon, label, value, tone, onClick }: { icon: React.ReactNode; label: string; value: string; tone: 'red' | 'yellow' | 'brand' | 'slate'; onClick?: () => void }) {
  const c = { red: 'text-red-700 bg-red-50', yellow: 'text-amber-800 bg-sun-100', brand: 'text-brand-700 bg-brand-50', slate: 'text-slate-700 bg-slate-100' }[tone]
  const Tag = onClick ? 'button' : 'div'
  return (
    <Tag type={onClick ? 'button' : undefined} onClick={onClick} className="rounded-2xl border border-black/5 bg-white p-3 text-left shadow-sm sm:p-4">
      <div className={`mb-2 inline-flex rounded-lg p-1.5 ${c}`}>{icon}</div>
      <div className="tabular text-2xl font-bold text-slate-800">{value}</div>
      <div className="text-xs leading-snug text-slate-500">{label}</div>
    </Tag>
  )
}

/** 1人追加。Pro が必須の設定で、無料の人数を超えるときは追加させない（既存のデータはそのまま使える） */
export function AddButton({ plan, onOpen, size = 'md', className = '' }: { plan: Plan; onOpen: (id: string) => void; size?: 'sm' | 'md'; className?: string }) {
  const asOf = useStore((s) => s.asOf)
  const full = plan.room === 0
  return (
    <Button
      size={size}
      variant="primary"
      className={className}
      title={full ? `無料で管理できるのは${FREE_LIMIT}人までです。Pro にすると人数の上限がなくなります。` : undefined}
      onClick={() => {
        if (full) {
          alert(`無料で管理できる在籍中の人数（${FREE_LIMIT}人）に達しました。設定の「Pro」からライセンスキーを入れると追加できます。退職した人は数えません。`)
          return
        }
        onOpen(useStore.getState().addEmployee({ ...blankEmployee(asOf), name: '新しい人' }))
      }}
    >
      {size === 'sm' ? <Plus size={16} /> : <UserRound size={16} />} {size === 'sm' ? '1人追加' : '1人ずつ入れる'}
    </Button>
  )
}

function Welcome({ onNavigate, onOpen, plan }: { onNavigate: (tab: string) => void; onOpen: (id: string) => void; plan: Plan }) {
  const asOf = useStore((s) => s.asOf)
  const trySample = () => {
    const { employees, leaves } = makeSample(asOf)
    useStore.getState().mergeImport(employees, leaves.map(({ id: _id, ...l }) => l))
  }
  return (
    <div className="space-y-5">
      <Card className="overflow-hidden !p-0">
        <div className="bg-gradient-to-br from-brand-700 to-brand-900 px-5 py-8 text-white sm:px-8 sm:py-10">
          <p className="mb-2 inline-flex items-center gap-1 rounded-full bg-white/15 px-3 py-1 text-xs">
            <Sparkles size={14} /> 登録不要・データはこのブラウザの中だけ
          </p>
          <h1 className="text-2xl font-bold leading-snug sm:text-3xl">
            有休の残り日数と「年5日」の期限を、
            <br className="hidden sm:block" />
            名簿と休んだ日だけで。
          </h1>
          <p className="mt-3 max-w-2xl text-sm text-brand-100 sm:text-base">
            入社日と週の勤務日数を入れると、付与日・付与日数（パートの比例付与も）・2年の時効・年5日の取得義務を自動で計算します。
            半休・時間単位にも対応。例外の人だけ、手で直せます。{FREE_LIMIT}人までは無料です。
          </p>
          <div className="mt-5 flex flex-wrap gap-2">
            <Button variant="primary" className="!bg-sun-400 !text-brand-900 hover:!bg-sun-500" onClick={trySample}>
              <Sparkles size={16} /> サンプルで試す
            </Button>
            <Button className="!border-white/30 !bg-white/10 !text-white hover:!bg-white/20" onClick={() => onNavigate('import')}>
              <FileSpreadsheet size={16} /> Excel・CSV から取り込む
            </Button>
            <AddButton plan={plan} onOpen={onOpen} className="!border !border-white/30 !bg-white/10 !text-white hover:!bg-white/20 !shadow-none" />
          </div>
        </div>
      </Card>

      <div className="grid gap-3 sm:grid-cols-3">
        {[
          ['1', '会社のルールを選ぶ', '入社日ごとに付与（法律どおり）か、全員そろえて4/1などに付与か。迷ったら最初のままで大丈夫です。', 'settings'],
          ['2', '従業員を入れる', '必要なのは「氏名・入社日・週の勤務日数」だけ。Excel の名簿をそのまま貼り付けられます。', 'import'],
          ['3', '休んだ日を入れる', '日付を入れるだけ。半休は0.5日で数えます。あとは自動で計算します。', 'leave'],
        ].map(([n, t, d, tab]) => (
          <Card key={n}>
            <button type="button" className="text-left" onClick={() => onNavigate(tab)}>
              <span className="mb-2 inline-flex h-7 w-7 items-center justify-center rounded-full bg-brand-100 font-bold text-brand-800">{n}</span>
              <h2 className="font-bold text-slate-800">{t}</h2>
              <p className="mt-1 text-sm text-slate-600">{d}</p>
            </button>
          </Card>
        ))}
      </div>
    </div>
  )
}
