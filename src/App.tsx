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
      <header className="no-print sticky top-0 z-10 border-b border-black/5 bg-white/90 backdrop-blur">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-2.5">
          <button type="button" onClick={() => go('home')} className="flex items-center gap-2">
            <Logo />
            <span className="text-xl font-extrabold tracking-tight text-brand-800">有休ポン</span>
          </button>
          <div className="flex items-center gap-2 text-sm">
            <label htmlFor="asof" className="text-slate-500">
              集計日
            </label>
            <input
              id="asof"
              type="date"
              className="rounded-lg border border-slate-300 px-2 py-1 tabular"
              value={asOf}
              onChange={(e) => isISODate(e.target.value) && setAsOf(e.target.value)}
            />
            {asOf !== today() && (
              <button type="button" className="text-brand-700 underline" onClick={() => setAsOf(today())}>
                今日
              </button>
            )}
          </div>
        </div>
        <nav className="mx-auto max-w-6xl overflow-x-auto px-2" aria-label="メニュー">
          <ul className="flex gap-1">
            {TABS.map(({ key, label, icon: Icon }) => (
              <li key={key}>
                <button
                  type="button"
                  onClick={() => go(key)}
                  aria-current={tab === key ? 'page' : undefined}
                  className={`flex items-center gap-1.5 whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium ${tab === key ? 'border-brand-600 text-brand-800' : 'border-transparent text-slate-600 hover:text-brand-700'}`}
                >
                  <Icon size={16} />
                  {label}
                </button>
              </li>
            ))}
          </ul>
        </nav>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-5">
        <BackupReminder onSettings={() => go('settings')} />
        <LicenseNotice />
        {tab === 'home' && <Dashboard onOpen={setOpenId} onNavigate={go} />}
        {tab === 'leave' && <LeaveEntry onOpen={setOpenId} />}
        {tab === 'import' && <ImportView onDone={() => go('home')} />}
        {tab === 'ledger' && <LedgerView />}
        {tab === 'settings' && <SettingsView />}
        {tab === 'guide' && <GuideView />}
      </main>

      <footer className="no-print mx-auto max-w-6xl px-4 pb-8 pt-2 text-xs text-slate-500">
        <p className="flex items-center gap-1">
          <Lock size={12} /> 入力した内容はこのブラウザの中だけに保存され、外部へは送信しません。
        </p>
        <p className="mt-1 flex flex-wrap gap-x-3">
          <a href="./pricing.html" className="underline">
            料金プラン
          </a>
          <a href="./terms.html" className="underline">
            利用規約
          </a>
          <a href="./tokushoho.html" className="underline">
            特定商取引法に基づく表記
          </a>
          <a href="./privacy.html" className="underline">
            プライバシーポリシー
          </a>
          <span>計算結果は、使う前に就業規則・法令と照らしてご確認ください。</span>
        </p>
        <p className="mt-1">
          企画・開発・運営：
          <a href="https://kokokikaku.com/" className="underline" target="_blank" rel="noopener">
            ここ企画
          </a>
        </p>
      </footer>

      <EmployeeEditor id={openId} onClose={() => setOpenId(null)} />
      <FirstUse />
    </div>
  )
}

/** はじめて使うときに、計算結果を自分で確認して使うことに同意してもらう */
function FirstUse() {
  const acceptedAt = useStore((s) => s.acceptedAt)
  const [checked, setChecked] = useState(false)
  return (
    !acceptedAt && (
    <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-slate-900/50 p-2" role="dialog" aria-modal="true" aria-labelledby="first-use-title">
      <div className="max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white p-5 shadow-2xl">
      <h2 id="first-use-title" className="mb-3 text-lg font-bold text-slate-800">はじめにお読みください</h2>
      <div className="space-y-3 text-sm text-slate-700">
        <p>有休ポンは、労働基準法のルールで有給休暇を計算する道具です。次の点をご了承のうえお使いください。</p>
        <ul className="list-disc space-y-1.5 pl-5">
          <li>
            計算結果は、<strong>使う前に必ず就業規則・労使協定・法令と照らして確認</strong>してください。会社ごとの細かな定めまでは判断できません。
          </li>
          <li>入れたデータはこのブラウザの中だけに保存され、外部へは送りません。そのぶん、ブラウザのデータを消すと消えます。設定の「自動バックアップ」か「ファイルに保存」で守ってください。</li>
          <li>計算の根拠と、扱えないことは「ルール」のページにまとめています。</li>
        </ul>
        <label className="flex items-start gap-2 rounded-lg bg-slate-50 p-2">
          <input type="checkbox" aria-label="利用規約に同意し、計算結果を自分で確認してから使います" className="mt-1 h-4 w-4 shrink-0 accent-brand-600" checked={checked} onChange={(e) => setChecked(e.target.checked)} />
          <span>
            <a href="./terms.html" target="_blank" rel="noopener" className="text-brand-700 underline">
              利用規約
            </a>
            に同意し、計算結果を自分で確認してから使います
          </span>
        </label>
        <Button variant="primary" disabled={!checked} onClick={() => useStore.getState().accept()}>
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
      <div className="no-print mb-4 flex flex-wrap items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
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
    <div className="no-print mb-4 flex flex-wrap items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
      <ShieldAlert size={16} className="shrink-0" />
      {lastBackupAt ? `前回のバックアップから7日以上たち、変更があります。` : 'まだバックアップがありません。'}
      ブラウザのデータを消すと入力した内容も消えます。
      <Button size="sm" variant="primary" onClick={backupNow}>
        ファイルに保存
      </Button>
      <button type="button" className="underline" onClick={onSettings}>
        自動バックアップを設定する
      </button>
    </div>
  )
}

function Logo() {
  return (
    <svg width="30" height="30" viewBox="0 0 32 32" aria-hidden>
      <rect x="2" y="5" width="28" height="25" rx="6" fill="#15805f" />
      <rect x="2" y="5" width="28" height="8" rx="4" fill="#0d513e" />
      <rect x="8" y="2" width="3" height="7" rx="1.5" fill="#0b3d30" />
      <rect x="21" y="2" width="3" height="7" rx="1.5" fill="#0b3d30" />
      <circle cx="16" cy="21" r="5.5" fill="#f7b733" />
      <path d="M13.5 21.2l1.8 1.8 3.4-3.6" stroke="#0b3d30" strokeWidth="1.8" fill="none" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function LicenseNotice() {
  const notice = useStore((s) => s.licenseNotice)
  if (!notice) return null
  return (
    <div className="no-print mb-4 flex flex-wrap items-center gap-2 rounded-xl border border-sky-200 bg-sky-50 px-3 py-2 text-sm text-sky-900">
      {notice}
      <button type="button" className="underline" onClick={() => useStore.getState().setLicenseNotice('')}>
        閉じる
      </button>
    </div>
  )
}
