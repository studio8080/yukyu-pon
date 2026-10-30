import { BookOpen, CalendarDays, FileSpreadsheet, Home, Lock, Settings as Gear, ShieldAlert, Upload } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Dashboard } from './components/Dashboard'
import { EmployeeEditor } from './components/EmployeeEditor'
import { GuideView } from './components/GuideView'
import { ImportView } from './components/ImportView'
import { LeaveEntry } from './components/LeaveEntry'
import { LedgerView } from './components/LedgerView'
import { backupNow, SettingsView } from './components/SettingsView'
import { Button } from './components/ui'
import { LatestUpdate, UpdatesView } from './components/UpdatesView'
import { ToolConsentProvider } from './components/ToolConsent'
import { useToolConsent } from './lib/useToolConsent'
import { needsToolConsent } from './lib/toolConsent'
import { initAutosave, resumeAutosave, useAutosave } from './lib/backup'
import { renewLicense, usePlan } from './lib/plan'
import { ENFORCE_FROM_TEXT, FREE_LIMIT, PRO_ENFORCED } from './config'
import { isISODate, today } from './lib/dates'
import { defaultSettings } from './lib/defaults'
import { hydrationError, useStore } from './store'

const TABS = [
  { key: 'home', label: 'ホーム', icon: Home },
  { key: 'leave', label: '休んだ日', icon: CalendarDays },
  { key: 'import', label: '取り込む', icon: Upload },
  { key: 'ledger', label: '管理簿', icon: FileSpreadsheet },
  { key: 'settings', label: '設定', icon: Gear },
  { key: 'guide', label: 'ルール', icon: BookOpen },
] as const

type TabKey = (typeof TABS)[number]['key'] | 'updates'

export default function App() {
  return <ToolConsentProvider><Application /></ToolConsentProvider>
}

function Application() {
  const [tab, setTab] = useState<TabKey>('home')
  const [openId, setOpenId] = useState<string | null>(null)
  const asOf = useStore((s) => s.asOf)
  const setAsOf = useStore((s) => s.setAsOf)
  const acceptedAt = useStore((s) => s.acceptedAt)
  const hasSavedData = useStore((s) => s.employees.length > 0 || s.leaves.length > 0 || Object.entries(s.settings).some(([key, value]) => value !== defaultSettings[key as keyof typeof defaultSettings]))
  const consent = useToolConsent()
  useEffect(() => {
    if (hydrationError) return
    initAutosave()
    renewLicense() // 契約中ならキーの期限を延ばす。解約済みならキーを外す（送るのはライセンスIDだけ）
    // 更新一覧へのリンクと、既存のメールの「/#pro」の入口。
    const openHashView = () => {
      if (location.hash === '#updates') {
        consent.cancel()
        setTab('updates')
        window.scrollTo({ top: 0 })
        return
      }
      if (location.hash !== '#pro') {
        setTab((current) => current === 'updates' ? 'home' : current)
        return
      }
      consent.request(() => {
        setTab('settings')
        setTimeout(() => document.getElementById('pro')?.scrollIntoView({ behavior: 'smooth' }), 100)
      })
    }
    openHashView()
    window.addEventListener('hashchange', openHashView)
    return () => window.removeEventListener('hashchange', openHashView)
  }, [consent])
  const go = (t: string) => {
    if (location.hash === '#updates') history.replaceState(null, '', location.pathname + location.search)
    const navigate = () => setTab(t as TabKey)
    if (needsToolConsent(t)) consent.request(navigate)
    else { consent.cancel(); navigate() }
    window.scrollTo({ top: 0 })
  }

  if (hydrationError) return <main className="mx-auto max-w-xl p-6"><p role="alert">{hydrationError}</p></main>

  return (
    <div className="min-h-screen">
      <header className="no-print sticky top-0 z-20 border-b border-line/70 bg-white/90 backdrop-blur-md">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-2.5 lg:gap-6">
          <button type="button" onClick={() => go('home')} className="shrink-0 rounded-xl focus-visible:outline-2 focus-visible:outline-brand-500" aria-label="ホームへ">
            <img src="./logo.png" alt="有休ポン" width={150} height={33} className="h-8 w-auto sm:h-9" />
          </button>
          <nav className="hidden lg:block" aria-label="メニュー">
            <TabList tab={tab} go={go} />
          </nav>
          <div className="flex shrink-0 items-center gap-1.5 rounded-full border border-line bg-paper py-1 pr-1.5 pl-3.5 text-sm">
            <CalendarDays size={15} className="text-brand-500" aria-hidden />
            <label htmlFor="asof" className="hidden font-bold text-ink sm:inline">
              集計日
            </label>
            <input
              id="asof"
              type="date"
              className="w-[8.6rem] rounded-full bg-white px-2 py-1 font-bold text-ink tabular focus:outline-none focus:ring-2 focus:ring-brand-300"
              value={asOf}
              onChange={(e) => isISODate(e.target.value) && setAsOf(e.target.value)}
              aria-label="集計日"
            />
            {asOf !== today() && (
              <button type="button" className="rounded-full px-2 py-1 text-xs font-bold text-brand-600 hover:bg-brand-50" onClick={() => setAsOf(today())}>
                今日
              </button>
            )}
          </div>
        </div>
        <nav className="overflow-x-auto px-3 pb-2 lg:hidden" aria-label="メニュー">
          <TabList tab={tab} go={go} />
        </nav>
      </header>

      <main className="mx-auto max-w-6xl px-4 pt-6 pb-10">
        {!acceptedAt && <div className="no-print mb-5 space-y-2 rounded-2xl border border-line bg-white p-4 text-sm text-slate-700">
          <p>説明・記事・料金・規約は、そのまま閲覧できます。入力・編集やサンプル利用を始めるときに、規約と注意事項を確認します。</p>
          <nav className="flex flex-wrap gap-x-4 gap-y-2 font-bold text-brand-700" aria-label="公開情報">
            <a href="./articles/" className="underline">解説記事</a>
            <a href="./pricing.html" className="underline">料金</a>
            <a href="./terms.html" className="underline">利用規約</a>
            <button type="button" className="underline" onClick={() => go('guide')}>計算のルール</button>
          </nav>
          {hasSavedData && <div className="flex flex-wrap items-center gap-2 border-t border-line pt-3">
            <p>保存済みデータのバックアップは、利用開始の同意なしで保存できます。</p>
            <Button onClick={backupNow}>バックアップを保存</Button>
          </div>}
        </div>}
        <BackupReminder onSettings={() => go('settings')} />
        <LicenseNotice />
        <EnforceNotice />
        {tab === 'home' && <LatestUpdate />}
        {tab === 'home' && <Dashboard onOpen={id => consent.request(() => setOpenId(id))} onNavigate={go} />}
        {tab === 'leave' && <LeaveEntry onOpen={setOpenId} />}
        {tab === 'import' && <ImportView onDone={() => go('home')} />}
        {tab === 'ledger' && <LedgerView />}
        {tab === 'settings' && <SettingsView />}
        {tab === 'guide' && <GuideView />}
        {tab === 'updates' && <UpdatesView onBack={() => {
          go('home')
          requestAnimationFrame(() => document.getElementById('updates-link')?.focus())
        }} />}
      </main>

      <footer className="no-print px-4 pb-6">
        <div className="mx-auto max-w-6xl rounded-[28px] bg-ink px-6 py-8 text-sm text-brand-100 sm:px-10">
          <div className="flex flex-wrap items-start justify-between gap-6">
            <div className="max-w-md">
              <img src="./logo-white.png" alt="有休ポン" width={150} height={33} className="h-8 w-auto" />
              <p className="mt-3 flex items-start gap-1.5 leading-relaxed">
                <Lock size={14} className="mt-1 shrink-0" aria-hidden /> 入力した内容（従業員のデータ）は、このブラウザの中だけに保存します。外部へは送信しません。
              </p>
              <p className="mt-1 text-xs text-brand-200">計算結果は、使う前に就業規則・法令と照らしてご確認ください。</p>
            </div>
            <ul className="grid grid-cols-2 gap-x-6 gap-y-1.5 text-sm">
              <li>
                <a href="#updates" aria-current={tab === 'updates' ? 'page' : undefined} className="hover:text-white hover:underline">更新情報</a>
              </li>
              <li>
                <a href="./articles/" className="hover:text-white hover:underline">有給休暇の解説記事</a>
              </li>
              <li>
                <a href="./pricing.html" className="hover:text-white hover:underline">料金プラン</a>
              </li>
              <li>
                <a href="./terms.html" className="hover:text-white hover:underline">利用規約</a>
              </li>
              <li>
                <a href="./privacy.html" className="hover:text-white hover:underline">プライバシーポリシー</a>
              </li>
              <li>
                <a href="./tokushoho.html" className="hover:text-white hover:underline">特定商取引法に基づく表記</a>
              </li>
            </ul>
          </div>
          <p className="mt-6 border-t border-white/10 pt-4 text-xs text-brand-200">
            企画・開発・運営：
            <a href="https://kokokikaku.com/" className="underline hover:text-white" target="_blank" rel="noopener">
              ここ企画
            </a>
          </p>
        </div>
      </footer>

      <EmployeeEditor id={openId} onClose={() => setOpenId(null)} />
    </div>
  )
}

function TabList({ tab, go }: { tab: TabKey; go: (t: string) => void }) {
  return (
    <ul className="flex w-max gap-1 rounded-full bg-paper p-1">
      {TABS.map(({ key, label, icon: Icon }) => (
        <li key={key}>
          <button
            type="button"
            onClick={() => go(key)}
            aria-current={tab === key ? 'page' : undefined}
            className={`flex min-h-9 items-center gap-1.5 whitespace-nowrap rounded-full px-3.5 text-sm font-bold transition ${tab === key ? 'bg-white text-brand-600 shadow-[0_1px_4px_rgba(12,59,46,0.12)]' : 'text-slate-600 hover:text-brand-600'}`}
          >
            <Icon size={16} aria-hidden />
            {label}
          </button>
        </li>
      ))}
    </ul>
  )
}

/** バックアップの催促。自動バックアップが動いていれば出さない */
function BackupReminder({ onSettings }: { onSettings: () => void }) {
  const auto = useAutosave()
  const count = useStore((s) => s.employees.length)
  const lastBackupAt = useStore((s) => s.lastBackupAt)
  const lastChangeAt = useStore((s) => s.lastChangeAt)
  if (count === 0) return null
  if (auto.state === 'need-permission') {
    return (
      <div className="no-print mb-5 flex flex-wrap items-center gap-2 rounded-2xl bg-sun-100 px-4 py-3 text-sm text-sun-700">
        <ShieldAlert size={16} className="shrink-0" />
        自動バックアップ（{auto.fileName}）を再開するには、保存の許可が必要です。
        <Button size="sm" variant="primary" onClick={resumeAutosave}>
          再開する
        </Button>
      </div>
    )
  }
  if (auto.state === 'ok') return null
  const stale = !lastBackupAt || Date.now() - new Date(lastBackupAt).getTime() > 7 * 86400000
  const changed = !lastBackupAt || (lastChangeAt && lastChangeAt > lastBackupAt)
  if (!stale || !changed) return null
  return (
    <div className="no-print mb-5 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-2xl bg-sun-100 px-4 py-3 text-sm text-sun-700">
      <ShieldAlert size={16} className="shrink-0" />
      {lastBackupAt ? `前回のバックアップから7日以上たち、変更があります。` : 'まだバックアップがありません。'}
      ブラウザのデータを消すと入力した内容も消えます。
      <Button size="sm" variant="primary" onClick={backupNow}>
        ファイルに保存
      </Button>
      <button type="button" className="font-bold underline" onClick={onSettings}>
        自動バックアップを設定する
      </button>
    </div>
  )
}

/** 人数の制限が始まる前の告知（利用規約8条の1か月前の告知）。無料の人数を超えて使っている人にだけ出す */
function EnforceNotice() {
  const plan = usePlan()
  const [closed, setClosed] = useState(false)
  if (PRO_ENFORCED || plan.pro || plan.activeCount <= FREE_LIMIT || closed) return null
  return (
    <div className="no-print mb-5 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-2xl bg-sun-100 px-4 py-3 text-sm text-sun-700">
      <ShieldAlert size={16} className="shrink-0" />
      <span>
        <strong>{ENFORCE_FROM_TEXT}から、在籍{FREE_LIMIT + 1}人以上で使うには有料プランが必要になります</strong>（いまの在籍は{plan.activeCount}人）。それまでは今までどおり使えます。その後も、入れたデータの閲覧・管理簿の出力・バックアップは止めません。
      </span>
      <a href="./pricing.html" className="font-bold underline">
        料金と申し込み
      </a>
      <button type="button" className="underline" onClick={() => setClosed(true)}>
        閉じる
      </button>
    </div>
  )
}

function LicenseNotice() {
  const notice = useStore((s) => s.licenseNotice)
  if (!notice) return null
  return (
    <div className="no-print mb-5 flex flex-wrap items-center gap-2 rounded-2xl bg-brand-50 px-4 py-3 text-sm text-brand-900">
      {notice}
      <button type="button" className="underline" onClick={() => useStore.getState().setLicenseNotice('')}>
        閉じる
      </button>
    </div>
  )
}
