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
import { initAutosave, resumeAutosave, useAutosave } from './lib/backup'
import { renewLicense } from './lib/plan'
import { isISODate, today } from './lib/dates'
import { useStore } from './store'

const TABS = [
  { key: 'home', label: 'ホーム', icon: Home },
  { key: 'leave', label: '休んだ日', icon: CalendarDays },
  { key: 'import', label: '取り込む', icon: Upload },
  { key: 'ledger', label: '管理簿', icon: FileSpreadsheet },
  { key: 'settings', label: '設定', icon: Gear },
  { key: 'guide', label: 'ルール', icon: BookOpen },
] as const

type TabKey = (typeof TABS)[number]['key']

export default function App() {
  const [tab, setTab] = useState<TabKey>('home')
  const [openId, setOpenId] = useState<string | null>(null)
  const asOf = useStore((s) => s.asOf)
  const setAsOf = useStore((s) => s.setAsOf)
  useEffect(() => {
    initAutosave()
    renewLicense() // 契約中ならキーの期限を延ばす。解約済みならキーを外す（送るのはライセンスIDだけ）
    // メールの「/#pro」から来たら、キーの入力欄を開く
    const openPro = () => {
      if (location.hash !== '#pro') return
      setTab('settings')
      setTimeout(() => document.getElementById('pro')?.scrollIntoView({ behavior: 'smooth' }), 100)
    }
    openPro()
    window.addEventListener('hashchange', openPro)
    return () => window.removeEventListener('hashchange', openPro)
  }, [])
  const go = (t: string) => {
    setTab(t as TabKey)
    window.scrollTo({ top: 0 })
  }

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
        <BackupReminder onSettings={() => go('settings')} />
        <LicenseNotice />
        {tab === 'home' && <Dashboard onOpen={setOpenId} onNavigate={go} />}
        {tab === 'leave' && <LeaveEntry onOpen={setOpenId} />}
        {tab === 'import' && <ImportView onDone={() => go('home')} />}
        {tab === 'ledger' && <LedgerView />}
        {tab === 'settings' && <SettingsView />}
        {tab === 'guide' && <GuideView />}
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
      <FirstUse />
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

/** はじめて使うときに、計算結果を自分で確認して使うことに同意してもらう */
function FirstUse() {
  const acceptedAt = useStore((s) => s.acceptedAt)
  const [checked, setChecked] = useState(false)
  return (
    !acceptedAt && (
    <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-ink/60 p-3" role="dialog" aria-modal="true" aria-labelledby="first-use-title">
      <div className="max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-[28px] bg-white p-6 shadow-[0_24px_60px_rgba(12,59,46,0.3)] sm:p-8">
      <img src="./logo.png" alt="有休ポン" width={150} height={33} className="mb-4 h-8 w-auto" />
      <p className="sq-label">はじめにお読みください</p>
      <h2 id="first-use-title" className="font-display mt-1 mb-4 text-xl">使う前に<small>、</small>3つだけ</h2>
      <div className="space-y-4 text-sm leading-relaxed text-slate-700">
        <p>有休ポンは、労働基準法のルールで有給休暇を計算する道具です。次の点をご了承のうえお使いください。</p>
        <ul className="space-y-2.5 [&>li]:relative [&>li]:rounded-2xl [&>li]:bg-paper [&>li]:px-4 [&>li]:py-3">
          <li>
            計算結果は、<strong>使う前に必ず就業規則・労使協定・法令と照らして確認</strong>してください。会社ごとの細かな定めまでは判断できません。
          </li>
          <li>入れたデータはこのブラウザの中だけに保存され、外部へは送りません。そのぶん、ブラウザのデータを消すと消えます。設定の「自動バックアップ」か「ファイルに保存」で守ってください。</li>
          <li>計算の根拠と、扱えないことは「ルール」のページにまとめています。</li>
        </ul>
        <label className="flex cursor-pointer items-start gap-2.5 rounded-2xl border border-brand-200 bg-brand-50 p-3">
          <input type="checkbox" aria-label="利用規約に同意し、計算結果を自分で確認してから使います" className="mt-1 h-4 w-4 shrink-0 accent-brand-600" checked={checked} onChange={(e) => setChecked(e.target.checked)} />
          <span>
            <a href="./terms.html" target="_blank" rel="noopener" className="text-brand-700 underline">
              利用規約
            </a>
            に同意し、計算結果を自分で確認してから使います
          </span>
        </label>
        <Button variant="cta" className="w-full sm:w-auto" disabled={!checked} onClick={() => useStore.getState().accept()}>
          はじめる
        </Button>
      </div>
      </div>
    </div>
    )
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
