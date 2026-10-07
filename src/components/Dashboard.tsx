import { AlertTriangle, CalendarClock, CalendarPlus, ClipboardCheck, FileSpreadsheet, Hourglass, Lock, Plus, UserRound } from 'lucide-react'
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
import { Badge, Button, Card, PageHead, Stamp } from './ui'

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

  const [y, m, d] = asOf.split('-').map(Number)
  return (
    <div className="space-y-5">
      <PageHead label="ホーム" aside={<AddButton plan={plan} onOpen={onOpen} />}>
        {m}<small>月</small>
        {d}
        <small>日の時点の</small>有休<small>の状況</small>
        <span className="sr-only">（{y}年）</span>
      </PageHead>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat icon={<AlertTriangle size={16} />} tone="red" label="至急" sub="5日の期限まで1か月以内" value={stats.red} unit="人" onClick={() => setFilter('action')} />
        <Stat icon={<Hourglass size={16} />} tone="yellow" label="注意" sub="期限まで3か月以内" value={stats.yellow} unit="人" onClick={() => setFilter('action')} />
        <Stat icon={<CalendarPlus size={16} />} tone="brand" label="もうすぐ付与" sub="1か月以内に付与がある" value={stats.grants} unit="人" />
        <Stat icon={<CalendarClock size={16} />} tone="slate" label="もうすぐ時効" sub="3か月以内に消える日数" value={Math.round(stats.expiring * 10) / 10} unit="日" />
      </div>

      {stats.missed > 0 && (
        <p className="flex items-start gap-2 rounded-2xl bg-shu-50 px-4 py-3 text-sm leading-relaxed text-shu-700">
          <AlertTriangle size={16} className="mt-1 shrink-0" />
          この1年で、5日に届かないまま期限を過ぎた人が{stats.missed}人います。記録の漏れが無いか確かめ、今の期間で確実に取れるよう計画してください。
        </p>
      )}
      {due.length > 0 && (
        <section className="rounded-[28px] bg-brand-100/70 p-5 sm:p-7">
          <p className="sq-label">付与の前に</p>
          <h2 className="font-display mt-1 flex items-center gap-2 text-xl">
            <ClipboardCheck size={20} className="shrink-0 text-brand-500" aria-hidden />
            <span>
              出勤率<small>の</small>確認<small>が</small>
              {due.length}
              <small>件あります</small>
            </span>
          </h2>
          <p className="mt-1 mb-4 text-sm leading-relaxed text-brand-900">前の期間の出勤率が8割以上なら付与、8割未満ならその回は付与しません。タイムカード等で確かめて記録してください。</p>
          <ul className="space-y-2">
            {due.slice(0, 8).map(({ emp, grant }) => (
              <li key={emp.id + grant.date} className="flex flex-wrap items-center justify-between gap-2 rounded-2xl bg-white px-4 py-3 text-sm">
                <span>
                  <strong className="text-ink">{emp.name}</strong>
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
          {due.length > 8 && <p className="mt-2 text-xs text-brand-900">ほか {due.length - 8}件。各人の「付与と5日」からも確認できます。</p>}
          <AttendanceDialog emp={att?.emp ?? null} grant={att?.grant ?? null} onClose={() => setAtt(null)} />
        </section>
      )}
      {stats.warnings > 0 && (
        <p className="flex items-center gap-2 rounded-2xl bg-sun-100 px-4 py-3 text-sm text-sun-700">
          <AlertTriangle size={16} className="shrink-0" />
          {stats.warnings}人に確認してほしい点があります。名前の横に <AlertTriangle size={14} className="inline align-[-2px]" aria-label="注意" /> が付いた人を開いてください。
        </p>
      )}

      <Card className="!p-0">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3 sm:px-6">
          <div className="flex flex-wrap gap-1 rounded-full bg-paper p-1" role="tablist" aria-label="表示する人">
            {(
              [
                ['active', `在籍中 ${stats.total}`],
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
                className={`min-h-8 rounded-full px-3.5 text-sm font-bold transition ${filter === k ? 'bg-white text-brand-600 shadow-[0_1px_4px_rgba(12,59,46,0.12)]' : 'text-slate-600 hover:text-brand-600'}`}
              >
                {label}
              </button>
            ))}
          </div>
          <p className="hidden text-xs text-slate-500 sm:block">名前を押すと、その人の付与・休んだ日・残高を開きます</p>
        </div>

        {shown.length === 0 ? (
          <p className="px-4 py-12 text-center text-slate-500">該当する人はいません。</p>
        ) : (
          <ul className="divide-y divide-line">
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
  const bar = r.level === 'red' ? 'bg-shu-500' : r.level === 'yellow' ? 'bg-sun-400' : 'bg-brand-500'
  return (
    <li>
      <button
        type="button"
        onClick={() => onOpen(e.id)}
        className="grid w-full grid-cols-[auto_1fr] gap-x-3 gap-y-3 px-4 py-4 text-left transition hover:bg-brand-50/60 sm:px-6 md:grid-cols-[auto_minmax(10rem,1.3fr)_6.5rem_minmax(8rem,1fr)_minmax(15rem,2fr)] md:items-center md:gap-x-5"
      >
        <span aria-hidden className={`font-display grid h-11 w-11 place-items-center rounded-full text-base ${r.active ? 'bg-brand-50 text-brand-600' : 'bg-slate-100 text-slate-400'}`}>
          {(e.name || '？').trim().charAt(0)}
        </span>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 font-bold text-ink">
            <span className="truncate text-base">{e.name || '（名前なし）'}</span>
            {r.warnings.length > 0 && (
              <span title={r.warnings.join('\n')} className="inline-flex text-sun-500" aria-label={`確認事項 ${r.warnings.length}件`}>
                <AlertTriangle size={15} aria-hidden />
              </span>
            )}
            {!r.active && <Badge level="none">退職</Badge>}
            {r.active && r.missed.length > 0 && r.focus?.status !== 'missed' && <Badge level="red">過去に未達</Badge>}
          </div>
          <div className="text-xs text-slate-500">
            {e.code && <span className="mr-2">#{e.code}</span>}入社 {fmt(e.hireDate)}・{c ? contractLabel(c) : '契約未入力'}
          </div>
        </div>
        <div className="col-start-2 flex items-baseline gap-2 md:col-start-auto md:block">
          <span className="text-xs text-slate-500 md:block">残日数</span>
          <span className="font-display tabular text-2xl text-ink">{fmtBalance(r.balance, r.hoursPerDay, hourly)}</span>
        </div>
        <div className="col-start-2 text-sm md:col-start-auto">
          <span className="text-xs text-slate-500 md:block">次の付与 </span>
          {r.nextGrant ? (
            <span className="tabular font-bold text-ink">
              {fmt(r.nextGrant.date)}
              <span className="ml-1 font-normal text-slate-600">{r.nextGrant.skipped ? 'なし' : fmtDays(r.nextGrant.days)}</span>
            </span>
          ) : (
            '—'
          )}
        </div>
        <div className="col-start-2 min-w-0 md:col-start-auto">
          {w ? (
            <div className="flex items-center gap-3">
              <div className="min-w-0 flex-1">
                <div className="mb-1.5 flex items-center justify-between gap-2">
                  {r.level === 'done' ? <span className="text-xs font-bold text-brand-600">年5日 {windowLabel(w)}</span> : <Badge level={r.level}>{windowLabel(w)}</Badge>}
                  <span className="tabular text-xs font-bold text-slate-500">{fmtDays(w.taken)} / 5日</span>
                </div>
                <div className="flex h-2.5 overflow-hidden rounded-full bg-paper" aria-hidden>
                  <div className={bar} style={{ width: `${pct}%` }} />
                  <div className="bg-brand-200" style={{ width: `${ppct}%` }} />
                </div>
                <div className="mt-1 truncate text-xs text-slate-500">{windowDetail(w)}</div>
              </div>
              {r.level === 'done' && <Stamp size={42} />}
            </div>
          ) : (
            <div className="text-xs text-slate-500">年10日以上の付与が無いため、5日の義務はありません</div>
          )}
        </div>
      </button>
    </li>
  )
}

function Stat({ icon, label, sub, value, unit, tone, onClick }: { icon: React.ReactNode; label: string; sub: string; value: number; unit: string; tone: 'red' | 'yellow' | 'brand' | 'slate'; onClick?: () => void }) {
  const hot = value > 0
  const c = {
    red: hot ? 'bg-shu-500 text-white' : 'bg-white',
    yellow: hot ? 'bg-sun-100' : 'bg-white',
    brand: 'bg-white',
    slate: 'bg-white',
  }[tone]
  const ic = {
    red: hot ? 'text-white' : 'text-shu-500',
    yellow: 'text-sun-700',
    brand: 'text-brand-600',
    slate: 'text-slate-600',
  }[tone]
  const Tag = onClick ? 'button' : 'div'
  return (
    <Tag
      type={onClick ? 'button' : undefined}
      onClick={onClick}
      className={`rounded-[20px] p-4 text-left transition sm:p-5 ${c} ${tone === 'red' && hot ? '' : 'border border-line'} ${onClick ? 'hover:-translate-y-0.5' : ''}`}
    >
      <div className="flex items-center gap-1.5">
        <span className={`inline-flex ${ic}`}>{icon}</span>
        <span className={`text-sm font-bold ${tone === 'red' && hot ? 'text-white' : 'text-ink'}`}>{label}</span>
      </div>
      <div className={`font-display tabular mt-2 text-4xl leading-none ${tone === 'red' && hot ? 'text-white' : 'text-ink'}`}>
        {value}
        <small className="ml-0.5">{unit}</small>
      </div>
      <div className={`mt-1.5 text-xs leading-snug ${tone === 'red' && hot ? 'text-white/85' : 'text-slate-500'}`}>{sub}</div>
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
      {size === 'sm' ? <Plus size={16} /> : <UserRound size={16} />} {size === 'sm' ? '1人追加' : className.includes('welcome') ? '1人ずつ入れる' : '1人追加'}
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
    <div className="space-y-12">
      {/* ヒーロー: 鮮やかな緑の角丸パネル、下端は波 */}
      <section className="relative -mx-2 overflow-hidden rounded-t-[28px] bg-brand-500 px-6 pt-10 pb-24 text-white sm:mx-0 sm:px-12 sm:pt-14 lg:pb-28">
        {/* 背景の大きなハンコ（「休」） */}
        <div aria-hidden className="font-display pointer-events-none absolute -top-14 -right-14 grid h-80 w-80 rotate-[-12deg] place-items-center rounded-full border-[16px] border-white/12 text-[160px] leading-none text-white/12">
          休
        </div>
        <div aria-hidden className="pointer-events-none absolute -bottom-px left-[-10%] h-20 w-[120%] rounded-[50%_50%_0_0/100%_100%_0_0] bg-paper" />
        <div className="relative grid items-center gap-10 lg:grid-cols-[1.1fr_0.9fr]">
          <div>
            <p className="inline-flex items-center gap-1.5 rounded-full bg-white/15 px-3 py-1 text-xs font-bold">
              <Lock size={13} aria-hidden /> 登録不要・データはこのブラウザの中だけ
            </p>
            <h1 className="font-display mt-4 text-[34px] leading-[1.3] !text-white sm:text-5xl sm:leading-[1.25]">
              有休<small>の</small>残り<small>と</small>
              <br />
              「年5日」<small>の期限が、</small>
              <br />
              ポン<small>とわかる。</small>
            </h1>
            <p className="mt-5 max-w-xl text-[15px] leading-loose font-bold text-white/90">
              入社日と週の勤務日数を入れると、付与日・付与日数（パートの比例付与も）・2年の時効・年5日の取得義務を自動で計算します。半休・時間単位にも対応。例外の人だけ、手で直せます。
            </p>
            <div className="mt-7 flex flex-wrap gap-2.5">
              <button
                type="button"
                onClick={trySample}
                className="group inline-flex min-h-12 items-center gap-3 rounded-full bg-white py-1.5 pr-1.5 pl-6 font-bold text-brand-600 transition hover:bg-brand-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
              >
                サンプルで試す
                <span aria-hidden className="grid h-9 w-9 place-items-center rounded-full bg-brand-500 text-white transition group-hover:translate-x-0.5">
                  →
                </span>
              </button>
              <button
                type="button"
                onClick={() => onNavigate('import')}
                className="inline-flex min-h-12 items-center gap-2 rounded-full border-2 border-white/50 px-5 font-bold text-white transition hover:bg-white/10"
              >
                <FileSpreadsheet size={17} aria-hidden /> Excel・CSV から取り込む
              </button>
              <AddButton plan={plan} onOpen={onOpen} className="welcome !min-h-12 !border-2 !border-white/50 !bg-transparent !text-white hover:!bg-white/10" />
            </div>
            <dl className="mt-9 grid max-w-md grid-cols-3 gap-2 sm:flex sm:max-w-none sm:gap-x-8">
              {[
                ['登録', '不要'],
                ['料金', `${FREE_LIMIT}人まで0円`],
                ['データ', '外に出さない'],
              ].map(([k, v]) => (
                <div key={k} className="text-center">
                  <dt className="text-[11px] font-bold text-white/80 sm:text-xs">&lt; {k} &gt;</dt>
                  <dd className="font-display text-base leading-tight sm:text-2xl">{v}</dd>
                </div>
              ))}
            </dl>
          </div>
          <HeroSample />
        </div>
      </section>

      <section>
        <p className="sq-label">はじめかた</p>
        <h2 className="font-display mt-1 mb-6 text-2xl sm:text-3xl">
          3<small>つの</small>ステップ<small>で、</small>すぐ使える
        </h2>
        {/* 書類の手順のように、番号のハンコを点線でつなぐ（スマホは縦、広い画面は横） */}
        <ol className="relative grid gap-8 md:grid-cols-3 md:gap-6">
          <span aria-hidden className="absolute top-8 bottom-8 left-8 border-l-2 border-dashed border-brand-200 md:top-8 md:right-[16%] md:bottom-auto md:left-[8%] md:border-t-2 md:border-l-0" />
          {[
            ['1', '会社のルールを選ぶ', '入社日ごとに付与（法律どおり）か、全員そろえて4/1などに付与か。迷ったら最初のままで大丈夫です。', 'settings'],
            ['2', '従業員を入れる', '必要なのは「氏名・入社日・週の勤務日数」だけ。Excel の名簿をそのまま貼り付けられます。', 'import'],
            ['3', '休んだ日を入れる', '日付を入れるだけ。半休は0.5日で数えます。あとは自動で計算します。', 'leave'],
          ].map(([n, t, d, tab]) => (
            <li key={n} className="relative">
              <button type="button" className="group grid w-full grid-cols-[64px_1fr] gap-4 text-left md:grid-cols-1" onClick={() => onNavigate(tab)}>
                <span aria-hidden className="stamp h-16 w-16 bg-paper text-[28px] text-brand-500 transition group-hover:rotate-0">
                  {n}
                </span>
                <span>
                  <span className="font-display block text-lg text-ink">{t}</span>
                  <span className="mt-1.5 block text-sm leading-relaxed text-slate-600">{d}</span>
                  <span className="mt-3 inline-flex items-center gap-1 text-sm font-bold text-brand-600 underline-offset-4 group-hover:underline">
                    ひらく <span className="transition group-hover:translate-x-0.5">→</span>
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ol>
      </section>

      <section className="grid items-center gap-6 rounded-[28px] bg-brand-100/70 p-6 sm:p-10 md:grid-cols-[auto_1fr]">
        <span aria-hidden className="stamp h-24 w-24 bg-white text-center text-[15px] leading-tight text-brand-500">
          外に
          <br />
          出さない
        </span>
        <div>
          <p className="sq-label">データの扱い</p>
          <h2 className="font-display mt-1 text-xl sm:text-2xl">
            従業員<small>の</small>データ<small>は、</small>このブラウザ<small>の</small>中<small>だけ。</small>
          </h2>
          <p className="mt-2 text-sm leading-relaxed text-slate-700">
            氏名・入社日・休んだ日は、運営者のサーバーに送りません。そのぶんブラウザのデータを消すと消えるので、設定の「自動バックアップ」か「ファイルに保存」で控えを取ってください。保存するファイルはパスワードで暗号化することもできます。
          </p>
        </div>
      </section>
    </div>
  )
}

/** ヒーローの右側の見本（飾り。サンプルの見た目を先に見せる） */
function HeroSample() {
  return (
    <div aria-hidden className="relative mx-auto w-full max-w-md lg:mr-0">
      <div className="absolute -top-5 left-2 z-10 rounded-2xl bg-white px-4 py-2 text-sm font-bold text-brand-600 shadow-[0_8px_20px_rgba(12,59,46,0.18)] after:absolute after:-bottom-2 after:left-8 after:h-4 after:w-4 after:rotate-45 after:bg-white">
        佐藤さん、期限まで30日！
      </div>
      <div className="rotate-1 rounded-[24px] bg-white p-5 text-ink shadow-[0_24px_50px_rgba(6,60,40,0.28)]">
        {[
          ['佐藤 花子', '24日', 'red', '至急 あと3日'],
          ['鈴木 一郎', '10日', 'done', ''],
          ['伊藤 健', '8.5日', 'yellow', '注意 あと3.5日'],
        ].map(([n, b, lv, t]) => (
          <div key={n} className="flex items-center gap-3 border-b border-line py-3 last:border-0">
            <span className="font-display grid h-9 w-9 place-items-center rounded-full bg-brand-50 text-sm text-brand-600">{n.charAt(0)}</span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-bold">{n}</p>
              <p className="text-xs text-slate-500">残 {b}</p>
            </div>
            {lv === 'done' ? (
              <Stamp size={46} />
            ) : (
              <span className={`rounded-full px-2.5 py-0.5 text-xs font-bold ${lv === 'red' ? 'bg-shu-500 text-white' : 'bg-sun-100 text-sun-700'}`}>{t}</span>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
