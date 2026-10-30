import { useEffect, useState, type ReactNode } from 'react'
import { createToolConsent, type ToolAction } from '../lib/toolConsent'
import { ToolConsentContext } from '../lib/useToolConsent'
import { useStore } from '../store'
import { Button, Modal, Notice } from './ui'

export function ToolConsentProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false)
  const [gate] = useState(() => createToolConsent(
    () => !!useStore.getState().acceptedAt,
    () => useStore.getState().accept(),
    setOpen,
  ))
  useEffect(() => {
    window.addEventListener('popstate', gate.cancel)
    return () => window.removeEventListener('popstate', gate.cancel)
  }, [gate])
  return <ToolConsentContext.Provider value={gate}>
    {children}
    {open && <ToolConsentDialog onClose={gate.cancel} onContinue={gate.confirm} />}
  </ToolConsentContext.Provider>
}

/** ツールの利用開始操作があるときだけ表示する。初回閲覧では表示しない。 */
export function ToolConsentDialog({ onClose, onContinue }: { onClose: ToolAction; onContinue: (agreed: boolean) => boolean }) {
  const [checked, setChecked] = useState(false)
  const [error, setError] = useState('')
  return <div className="no-print"><Modal open onClose={onClose} title="ツールを使う前に、3つだけ">
    <div className="space-y-4 text-sm leading-relaxed text-slate-700">
      <p>有休ポンは、労働基準法のルールで有給休暇を計算する道具です。次の点をご了承のうえお使いください。公開説明・記事・料金・規約は、同意せずに閲覧できます。</p>
      <ul className="space-y-2.5 [&>li]:rounded-2xl [&>li]:bg-paper [&>li]:px-4 [&>li]:py-3">
        <li>計算結果は、<strong>使う前に必ず就業規則・労使協定・法令と照らして確認</strong>してください。会社ごとの細かな定めまでは判断できません。</li>
        <li>入れたデータはこのブラウザの中だけに保存され、外部へは送りません。そのぶん、ブラウザのデータを消すと消えます。設定の「自動バックアップ」か「ファイルに保存」で守ってください。</li>
        <li>計算の根拠と、扱えないことは「ルール」のページにまとめています。</li>
      </ul>
      <label className="flex cursor-pointer items-start gap-2.5 rounded-2xl border border-brand-200 bg-brand-50 p-3">
        <input type="checkbox" aria-label="利用規約に同意し、計算結果を自分で確認してから使います" className="mt-1 h-4 w-4 shrink-0 accent-brand-600" checked={checked} onChange={e => setChecked(e.target.checked)} />
        <span><a href="./terms.html" target="_blank" rel="noopener" className="text-brand-700 underline">利用規約</a>に同意し、計算結果を自分で確認してから使います</span>
      </label>
      {error && <Notice tone="warn">{error}</Notice>}
      <div className="flex flex-wrap gap-2">
        <Button variant="cta" disabled={!checked} onClick={() => {
          try { onContinue(checked) } catch { setError('利用開始の処理を完了できませんでした。保存設定と空き容量を確認して、もう一度お試しください。') }
        }}>同意してはじめる</Button>
        <Button onClick={onClose}>同意せず公開情報に戻る</Button>
      </div>
      <p><a href="./articles/" className="text-brand-700 underline">解説記事</a>・<a href="./pricing.html" className="text-brand-700 underline">料金</a>・<a href="./terms.html" className="text-brand-700 underline">利用規約</a>を読む</p>
    </div>
  </Modal></div>
}
