import { Crown, Download, FolderSync, History, Lock, ShieldCheck, Trash2, Upload } from 'lucide-react'
import { useState } from 'react'
import { PLANS, planName, PRO_ENFORCED } from '../config'
import { decryptBackup, encryptBackup, isEncryptedBackup, MIN_PASSWORD } from '../lib/crypto'
import { autosaveSupported, chooseAutosaveFile, readAutosaveFile, resumeAutosave, stopAutosave, useAutosave } from '../lib/backup'
import { fmt, isISODate } from '../lib/dates'
import { renewLicense, usePlan } from '../lib/plan'
import type { FirstGrantRule, Settings } from '../lib/types'
import { currentData, listSnapshots, makeBackup, parseBackup, restoreSnapshot, useStore } from '../store'
import { Button, Card, download, Field, inputCls, Modal, Notice, PageHead } from './ui'

function Choice<T extends string>({ value, current, onPick, title, desc }: { value: T; current: T; onPick: (v: T) => void; title: string; desc: string }) {
  const on = value === current
  return (
    <button
      type="button"
      role="radio"
      aria-checked={on}
      onClick={() => onPick(value)}
      className={`rounded-xl border p-3 text-left transition ${on ? 'border-brand-600 bg-brand-50 ring-2 ring-brand-100' : 'border-line bg-white hover:border-brand-300'}`}
    >
      <span className="block font-bold text-ink">{title}</span>
      <span className="mt-0.5 block text-sm text-slate-600">{desc}</span>
    </button>
  )
}

function Toggle({ checked, onChange, label, desc }: { checked: boolean; onChange: (v: boolean) => void; label: string; desc: string }) {
  return (
    <label className="flex cursor-pointer items-start gap-3 rounded-2xl border border-line p-3 hover:bg-paper">
      <input type="checkbox" className="mt-1 h-4 w-4 shrink-0 accent-brand-500" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>
        <span className="block font-bold text-ink">{label}</span>
        <span className="block text-sm text-slate-600">{desc}</span>
      </span>
    </label>
  )
}

export function backupNow() {
  const st = useStore.getState()
  download(`有休ポン_バックアップ_${st.asOf}.json`, makeBackup(currentData()), 'application/json')
  st.markBackedUp()
}

export function SettingsView() {
  const s = useStore((x) => x.settings)
  const upd = useStore((x) => x.updateSettings)
  const [mm, dd] = s.uniformMonthDay.split('-').map(Number)
  const set = (p: Partial<Settings>) => upd(p)
  const [confirmUniform, setConfirmUniform] = useState(false)

  return (
    <div className="space-y-4">
      <PageHead label="設定">会社<small>の</small>ルール<small>と</small>データ</PageHead>
      <Card>
        <h2 className="mb-3 font-display text-lg text-ink">会社のルール</h2>
        <Field label="会社名（管理簿の見出しに入ります）" className="mb-4 max-w-md">
          <input className={inputCls} value={s.companyName} onChange={(e) => set({ companyName: e.target.value })} />
        </Field>

        <p className="mb-2 text-sm font-medium text-slate-700">いつ付与しますか</p>
        <div className="grid gap-2 sm:grid-cols-2" role="radiogroup">
          <Choice value="statutory" current={s.grantRule} onPick={(v) => set({ grantRule: v })} title="入社日ごと（法律どおり）" desc="入社から6か月後に付与し、その後は1年ごと。人によって付与日が違います。" />
          <Choice
            value="uniform"
            current={s.grantRule}
            onPick={() => (s.uniformConfirmedAt ? set({ grantRule: 'uniform' }) : setConfirmUniform(true))}
            title="全員そろえて（一斉付与）"
            desc="毎年4/1など、会社で決めた日に全員へ付与。法律より早く付与する（前倒し）ことで、日付をそろえます。"
          />
        </div>
        <UniformConfirm open={confirmUniform} onClose={() => setConfirmUniform(false)} />

        {s.grantRule === 'uniform' && (
          <div className="mt-4 space-y-4 rounded-2xl bg-paper p-4">
            <div className="flex flex-wrap items-end gap-3">
              <Field label="毎年の付与日">
                <div className="flex items-center gap-1">
                  <select className={`${inputCls} !w-auto`} value={mm} onChange={(e) => set({ uniformMonthDay: `${e.target.value.padStart(2, '0')}-${String(Math.min(dd, 28)).padStart(2, '0')}` })}>
                    {Array.from({ length: 12 }, (_, i) => (
                      <option key={i} value={i + 1}>
                        {i + 1}月
                      </option>
                    ))}
                  </select>
                  <select className={`${inputCls} !w-auto`} value={dd} onChange={(e) => set({ uniformMonthDay: `${String(mm).padStart(2, '0')}-${e.target.value.padStart(2, '0')}` })}>
                    {Array.from({ length: 28 }, (_, i) => (
                      <option key={i} value={i + 1}>
                        {i + 1}日
                      </option>
                    ))}
                  </select>
                </div>
              </Field>
              <Field label="一斉付与に切り替えた日（任意）" hint="途中で切り替えた会社だけ。空なら最初から一斉付与として計算します。">
                <input type="date" className={`${inputCls} !w-auto`} value={s.uniformFrom} onChange={(e) => set({ uniformFrom: isISODate(e.target.value) ? e.target.value : '' })} />
              </Field>
            </div>
            <div>
              <p className="mb-2 text-sm font-medium text-slate-700">入社した人の1回目</p>
              <div className="grid gap-2 sm:grid-cols-3" role="radiogroup">
                {(
                  [
                    ['sixMonths', '入社6か月後に10日', '2回目から付与日にそろえます。いちばん多い形です。'],
                    ['firstUniform', '6か月以内に付与日が来たらそこで', '例: 12月入社なら翌4/1に10日（前倒し）。'],
                    ['hire', '入社日に10日', '入社した日にすぐ付与。次の付与日に2回目。'],
                  ] as [FirstGrantRule, string, string][]
                ).map(([v, t, d]) => (
                  <Choice key={v} value={v} current={s.uniformFirst} onPick={(x) => set({ uniformFirst: x })} title={t} desc={d} />
                ))}
              </div>
            </div>
            <p className="text-xs text-slate-500">就業規則との照合: {s.uniformConfirmedAt ? `${fmt(s.uniformConfirmedAt.slice(0, 10))} に確認済み` : '未確認'}</p>
          </div>
        )}

        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <Field label="休んだ日は、どの付与分から引きますか" hint="法律の決まりはありません。就業規則に書いてあればそれに合わせます。多くの会社は古い方から。">
            <select className={inputCls} value={s.consumeOrder} onChange={(e) => set({ consumeOrder: e.target.value as Settings['consumeOrder'] })}>
              <option value="oldest">古い付与分（繰り越し分）から</option>
              <option value="newest">新しい付与分から</option>
            </select>
          </Field>
          <Field label="年5日の警告" hint="期限までの残りがこの月数を切ったら色を変えます。">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              赤
              <select className={`${inputCls} !w-auto`} value={s.redMonths} onChange={(e) => set({ redMonths: Number(e.target.value) })}>
                {[1, 2, 3].map((n) => (
                  <option key={n} value={n}>
                    {n}か月
                  </option>
                ))}
              </select>
              黄
              <select className={`${inputCls} !w-auto`} value={s.yellowMonths} onChange={(e) => set({ yellowMonths: Number(e.target.value) })}>
                {[2, 3, 4, 6].map((n) => (
                  <option key={n} value={n}>
                    {n}か月
                  </option>
                ))}
              </select>
            </div>
          </Field>
        </div>
      </Card>

      <Card>
        <h2 className="mb-3 font-display text-lg text-ink">取得の単位と確認</h2>
        <div className="grid gap-2 md:grid-cols-3">
          <Toggle checked={s.halfDayEnabled} onChange={(v) => set({ halfDayEnabled: v })} label="半日単位（半休）を使う" desc="午前・午後を0.5日で数えます。年5日の義務にも0.5日として数えます。" />
          <Toggle
            checked={s.hourlyEnabled}
            onChange={(v) => set({ hourlyEnabled: v })}
            label="時間単位の年休を使う"
            desc="労使協定が必要です。1年に5日分まで。残日数からは引きますが、年5日の義務には数えません。"
          />
          <Toggle checked={s.attendanceCheck} onChange={(v) => set({ attendanceCheck: v })} label="付与の前に出勤率の確認を促す" desc="付与日の1か月前から、出勤率8割以上かの確認をホームに出します。" />
        </div>
        {s.hourlyEnabled && (
          <p className="mt-2 text-xs text-slate-500">
            「1日＝何時間」は各人の契約の「1日の所定労働時間」で決めます（従業員の「契約」タブ。1時間未満は切り上げ。既定は8時間）。日によって時間が違う人は、1年の平均を入れてください。
          </p>
        )}
      </Card>

      <BackupCard />
      <ProCard />
    </div>
  )
}

/** 一斉付与にする前に、就業規則と照らして確認してもらう */
function UniformConfirm({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [checks, setChecks] = useState([false, false, false])
  const items = [
    '就業規則（または労使の取り決め）に、一斉に付与する日と、入社1回目の付与の方法が書いてある',
    '前倒しで付与した回は「次の段階の日数」（10日→11日→12日…）を付与し、前の付与から1年を超えて間を空けない',
    '前倒しで短くなった期間は、全部出勤したものとみなして出勤率を判断する',
  ]
  return (
    <Modal open={open} onClose={onClose} title="一斉付与にする前に確認してください">
      <div className="space-y-3 text-sm">
        <p>
          一斉付与は、法律の基準日より<strong>早く</strong>付与することで日付をそろえる方法です（遅くすることはできません）。有休ポンは次のルールで計算します。就業規則と同じか確かめてください。
        </p>
        {items.map((t, i) => (
          <label key={i} className="flex items-start gap-2">
            <input type="checkbox" className="mt-1 h-4 w-4 shrink-0 accent-brand-500" checked={checks[i]} onChange={(e) => setChecks(checks.map((c, j) => (j === i ? e.target.checked : c)))} />
            <span>{t}</span>
          </label>
        ))}
        <Notice tone="warn">就業規則と違う運用をしている場合は、従業員ごとの「付与と5日」で日数を直すか、「入社日ごと」のまま使ってください。年5日の期間が重なる場合は、それぞれの期間で5日を確認します（いちばん安全な数え方）。</Notice>
        <div className="flex gap-2">
          <Button
            variant="primary"
            disabled={!checks.every(Boolean)}
            onClick={() => {
              useStore.getState().updateSettings({ grantRule: 'uniform', uniformConfirmedAt: new Date().toISOString() })
              onClose()
            }}
          >
            確認したので一斉付与にする
          </Button>
          <Button onClick={onClose}>やめる</Button>
        </div>
      </div>
    </Modal>
  )
}

function BackupCard() {
  const lastBackupAt = useStore((x) => x.lastBackupAt)
  const auto = useAutosave()
  const [msg, setMsg] = useState<{ tone: 'ok' | 'warn'; text: string } | null>(null)
  const [snaps, setSnaps] = useState(listSnapshots)
  const [encrypt, setEncrypt] = useState(false)
  const [pw, setPw] = useState('')
  const [pw2, setPw2] = useState('')
  const [busy, setBusy] = useState(false)
  const [pending, setPending] = useState<string | null>(null) // 暗号化されたファイルの中身（パスワード待ち）
  const [openPw, setOpenPw] = useState('')
  const pwOk = !encrypt || (pw.length >= MIN_PASSWORD && pw === pw2)
  const saveFile = async () => {
    if (!encrypt) {
      backupNow()
      return
    }
    setBusy(true)
    try {
      const st = useStore.getState()
      const enc = await encryptBackup(makeBackup(currentData()), pw)
      download(`有休ポン_バックアップ_暗号化_${st.asOf}.json`, enc, 'application/json')
      st.markBackedUp()
      setPw('')
      setPw2('')
      setMsg({ tone: 'ok', text: '暗号化したバックアップを保存しました。パスワードは別の場所に控えてください（忘れると戻せません）。' })
    } catch (err) {
      setMsg({ tone: 'warn', text: (err as Error).message })
    } finally {
      setBusy(false)
    }
  }
  const restoreFrom = async (load: () => Promise<ReturnType<typeof parseBackup> | null>) => {
    try {
      const d = await load()
      if (!d) return
      if (!confirm(`いまの内容を、バックアップ（従業員 ${d.employees.length}人・記録 ${d.leaves.length}件）で置き換えます。いまの内容は「復元ポイント」に残ります。よろしいですか？`)) return
      useStore.getState().replaceAll(d)
      setSnaps(listSnapshots())
      setMsg({ tone: 'ok', text: '戻しました。' })
    } catch (err) {
      setMsg({ tone: 'warn', text: (err as Error).message || '読み込めませんでした。' })
    }
  }

  return (
    <Card>
      <h2 className="mb-1 flex items-center gap-2 font-display text-lg text-ink">
        <ShieldCheck size={20} className="text-brand-600" /> データの保管とバックアップ
      </h2>
      <p className="mb-4 text-sm text-slate-600">
        入れた内容は、このパソコンのこのブラウザの中にだけ保存しています（サーバーには送っていません）。
        <strong>ブラウザの履歴やサイトデータを消すと消えます。</strong>次の3つで守ってください。
      </p>

      <div className="space-y-4">
        <section className="rounded-2xl border border-line p-3">
          <h3 className="mb-1 flex items-center gap-2 font-bold text-ink">
            <FolderSync size={18} /> 1. 自動バックアップ（おすすめ）
          </h3>
          {auto.state === 'unsupported' ? (
            <p className="text-sm text-slate-600">このブラウザでは使えません（Chrome か Edge で使えます）。下の「ファイルに保存」をこまめに使ってください。</p>
          ) : auto.fileName ? (
            <div className="space-y-2 text-sm">
              <p>
                保存先: <strong>{auto.fileName}</strong>
                {auto.state === 'ok' && <span className="ml-2 text-brand-700">変更のたびに上書き保存しています{auto.savedAt && `（最後 ${new Date(auto.savedAt).toLocaleString('ja-JP')}）`}</span>}
              </p>
              {auto.state === 'need-permission' && (
                <Notice tone="warn">
                  ブラウザを開き直したので、保存の許可がもう一度必要です。{' '}
                  <Button size="sm" variant="primary" onClick={resumeAutosave}>
                    自動バックアップを再開
                  </Button>
                </Notice>
              )}
              {auto.state === 'error' && <Notice tone="warn">保存できませんでした（{auto.error}）。保存先を選び直してください。</Notice>}
              <div className="flex flex-wrap gap-2">
                <Button size="sm" onClick={() => restoreFrom(readAutosaveFile)}>
                  このファイルから戻す
                </Button>
                <Button size="sm" onClick={chooseAutosaveFile}>
                  保存先を変える
                </Button>
                <Button size="sm" variant="ghost" onClick={stopAutosave}>
                  やめる
                </Button>
              </div>
            </div>
          ) : (
            <div className="space-y-2 text-sm">
              <p className="text-slate-600">
                パソコンの中のファイル（例: 共有していない「ドキュメント」の中）を1つ選ぶと、変更のたびにそこへ自動で上書き保存します。ブラウザのデータが消えても、そのファイルから戻せます。
                自動バックアップのファイルは暗号化しないので、共有フォルダやクラウドの同期フォルダには置かないでください。
              </p>
              <Button variant="primary" disabled={!autosaveSupported()} onClick={chooseAutosaveFile}>
                <FolderSync size={16} /> 保存先のファイルを選ぶ
              </Button>
            </div>
          )}
        </section>

        <section className="rounded-2xl border border-line p-3">
          <h3 className="mb-1 flex items-center gap-2 font-bold text-ink">
            <Download size={18} /> 2. ファイルに保存・ファイルから戻す
          </h3>
          <p className="mb-2 text-sm text-slate-600">別のパソコンに移すときや、月に一度の控えに。前回の保存: {lastBackupAt ? new Date(lastBackupAt).toLocaleString('ja-JP') : 'まだありません'}</p>
          <label className="mb-2 flex items-center gap-2 text-sm">
            <input type="checkbox" className="h-4 w-4 accent-brand-500" checked={encrypt} onChange={(e) => setEncrypt(e.target.checked)} />
            <Lock size={14} /> パスワードで暗号化する（メールで送る・共有フォルダに置くときにおすすめ）
          </label>
          {encrypt && (
            <div className="mb-3 space-y-2 rounded-2xl bg-paper p-4">
              <div className="flex flex-wrap gap-2">
                <input type="password" autoComplete="new-password" className={`${inputCls} !w-56`} placeholder={`パスワード（${MIN_PASSWORD}文字以上）`} value={pw} onChange={(e) => setPw(e.target.value)} aria-label="暗号化のパスワード" />
                <input type="password" autoComplete="new-password" className={`${inputCls} !w-56`} placeholder="もう一度" value={pw2} onChange={(e) => setPw2(e.target.value)} aria-label="暗号化のパスワード（確認）" />
              </div>
              {pw2 && pw !== pw2 && <p className="text-xs text-shu-700">2つのパスワードが一致しません。</p>}
              <p className="text-xs text-sun-700">
                パスワードはどこにも保存しません。<strong>忘れると、運営者を含め誰も戻せません。</strong>ファイルとは別の場所（パスワード管理アプリなど）に控えてください。
              </p>
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            <Button variant="primary" onClick={saveFile} disabled={!pwOk || busy}>
              <Download size={16} /> {busy ? '暗号化しています…' : encrypt ? '暗号化して保存' : 'ファイルに保存'}
            </Button>
            <label className="inline-flex min-h-11 cursor-pointer items-center gap-1.5 rounded-full border border-brand-200 bg-white px-5 py-2 font-bold text-brand-700 hover:bg-brand-50">
              <Upload size={16} /> ファイルから戻す
              <input
                type="file"
                accept=".json,application/json"
                className="sr-only"
                onChange={async (e) => {
                  const f = e.target.files?.[0]
                  e.target.value = ''
                  if (!f) return
                  const text = await f.text()
                  if (isEncryptedBackup(text)) {
                    setOpenPw('')
                    setPending(text)
                  } else restoreFrom(async () => parseBackup(text))
                }}
              />
            </label>
          </div>
        </section>

        <Modal open={pending != null} onClose={() => setPending(null)} title="暗号化されたバックアップ">
          <form
            className="space-y-3 text-sm"
            onSubmit={async (e) => {
              e.preventDefault()
              const text = pending
              if (!text) return
              setBusy(true)
              try {
                const plain = await decryptBackup(text, openPw)
                setPending(null)
                setOpenPw('')
                await restoreFrom(async () => parseBackup(plain))
              } catch (err) {
                setMsg({ tone: 'warn', text: (err as Error).message })
              } finally {
                setBusy(false)
              }
            }}
          >
            <p>保存したときのパスワードを入れてください。</p>
            <input type="password" autoComplete="current-password" className={inputCls} value={openPw} onChange={(e) => setOpenPw(e.target.value)} aria-label="バックアップのパスワード" autoFocus />
            {msg?.tone === 'warn' && pending && <p className="text-shu-700">{msg.text}</p>}
            <div className="flex gap-2">
              <Button variant="primary" type="submit" disabled={!openPw || busy}>
                {busy ? '確かめています…' : '戻す'}
              </Button>
              <Button onClick={() => setPending(null)}>やめる</Button>
            </div>
          </form>
        </Modal>

        <section className="rounded-2xl border border-line p-3">
          <h3 className="mb-1 flex items-center gap-2 font-bold text-ink">
            <History size={18} /> 3. 復元ポイント（操作の取り消し）
          </h3>
          <p className="mb-2 text-sm text-slate-600">取り込み・削除・戻すの前と、毎日最初の変更のときに、自動で控えを取っています（最大12件。このブラウザの中なので、ブラウザのデータを消すと一緒に消えます）。</p>
          {snaps.length === 0 ? (
            <p className="text-sm text-slate-500">まだありません。</p>
          ) : (
            <ul className="divide-y divide-line rounded-lg border border-line text-sm">
              {snaps.map((sn) => (
                <li key={sn.at} className="flex flex-wrap items-center justify-between gap-2 px-3 py-1.5">
                  <span>
                    {new Date(sn.at).toLocaleString('ja-JP')}・{sn.reason}
                    <span className="ml-2 text-xs text-slate-500">
                      {sn.employees}人・{sn.leaves}件
                    </span>
                  </span>
                  <Button
                    size="sm"
                    onClick={() => {
                      if (!confirm('この時点の内容に戻します。いまの内容も復元ポイントに残ります。よろしいですか？')) return
                      restoreSnapshot(sn.at)
                      setSnaps(listSnapshots())
                      setMsg({ tone: 'ok', text: '戻しました。' })
                    }}
                  >
                    この時点に戻す
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      {msg && (
        <div className="mt-3">
          <Notice tone={msg.tone}>{msg.text}</Notice>
        </div>
      )}
      <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-line pt-3">
        <p className="text-xs text-slate-500">バックアップのファイルには氏名や休んだ日が入っています。メールで送ったり共有フォルダに置いたりするときは、扱いに注意してください。</p>
        <Button
          variant="danger"
          size="sm"
          onClick={() => {
            if (confirm('このブラウザに保存した従業員・記録・設定をすべて消します（直前の内容は復元ポイントに残ります）。よろしいですか？')) {
              useStore.getState().clearAll()
              setSnaps(listSnapshots())
            }
          }}
        >
          <Trash2 size={14} /> すべて消す
        </Button>
      </div>
    </Card>
  )
}

function ProCard() {
  const plan = usePlan()
  const key = useStore((x) => x.licenseKey)
  const checkedAt = useStore((x) => x.licenseCheckedAt)
  const [input, setInput] = useState('')
  const [msg, setMsg] = useState('')
  const lic = plan.license
  return (
    <Card>
      <h2 className="mb-1 flex items-center gap-2 font-display text-lg text-ink" id="pro">
        <Crown size={20} className="text-sun-500" /> 料金プラン
      </h2>
      <div className="my-3 grid gap-2 sm:grid-cols-3">
        {PLANS.map((p) => (
          <div key={p.key} className="rounded-2xl border border-line p-3">
            <p className="font-bold text-ink">{p.name}</p>
            <p className="text-sm text-slate-600">{p.limit ? `在籍${p.limit}人まで` : '人数無制限'}</p>
            <p className="mt-1 text-lg font-bold text-brand-800">{p.month ? `月¥${p.month.toLocaleString()}` : '¥0'}</p>
            {p.year > 0 && <p className="text-xs text-slate-500">年払い ¥{p.year.toLocaleString()}（2か月分お得）</p>}
          </div>
        ))}
      </div>
      <p className="mb-3 text-sm text-slate-600">
        すべて税込。機能はどのプランも同じで、違うのは管理できる在籍人数だけです（退職した人は数えません）。いま在籍 {plan.activeCount}人。
        {!PRO_ENFORCED && <strong> いまは公開記念として、人数の制限なく無料で使えます。</strong>}
        有料プランでも、入れたデータの閲覧・管理簿の出力・バックアップは止めません。{' '}
        <a href="./pricing.html" className="text-brand-700 underline">
          料金と申し込み
        </a>
      </p>
      {plan.pro && lic?.ok ? (
        <Notice tone="ok">
          {planName(lic.payload.n)} が有効です（キーの期限 {fmt(lic.payload.e)}。ご契約中は自動で延長されます）。
          <span className="mt-2 flex flex-wrap gap-2">
            <Button size="sm" onClick={async () => setMsg(await renewLicense(true))}>
              更新を確認
            </Button>
            <Button size="sm" variant="ghost" onClick={() => confirm('このブラウザから Pro のキーを外しますか？（契約は解約されません）') && useStore.getState().setLicenseKey('')}>
              キーを外す
            </Button>
          </span>
        </Notice>
      ) : (
        <div className="flex flex-wrap items-start gap-2">
          <input className={`${inputCls} max-w-md font-mono text-sm`} placeholder="YP1- で始まるライセンスキー" value={input} onChange={(e) => setInput(e.target.value)} aria-label="ライセンスキー" />
          <Button
            variant="primary"
            disabled={!input.trim()}
            onClick={() => {
              useStore.getState().setLicenseKey(input.trim().replace(/\s+/g, ''))
              useStore.getState().setLicenseNotice('')
              setInput('')
            }}
          >
            有効にする
          </Button>
          {key && lic && !lic.ok && <p className="w-full text-sm text-shu-700">{lic.reason}</p>}
        </div>
      )}
      {msg && <p className="mt-2 text-sm text-slate-600">{msg}</p>}
      <p className="mt-2 text-xs text-slate-500">
        キーの確認はこのブラウザの中で行います。ご契約中かどうかの確認のため、ときどきライセンスIDだけを運営者のサーバーへ送ります（従業員のデータは送りません）。
        {checkedAt && ` 最後の確認: ${new Date(checkedAt).toLocaleDateString('ja-JP')}`}
      </p>
    </Card>
  )
}
