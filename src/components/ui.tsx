import { X } from 'lucide-react'
import { useEffect, useId, useRef, type ButtonHTMLAttributes, type ReactNode } from 'react'
import type { Level } from '../lib/engine'

type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger' | 'cta'
  size?: 'sm' | 'md'
}

/** ボタンはすべてピル型。cta は矢印の丸つき（1画面に1つだけ使う） */
export function Button({ variant = 'secondary', size = 'md', className = '', children, ...p }: BtnProps) {
  const v = {
    primary: 'bg-brand-500 text-white hover:bg-brand-600',
    cta: 'bg-brand-500 text-white hover:bg-brand-600 pr-1.5',
    secondary: 'bg-white text-brand-700 border border-brand-200 hover:border-brand-400 hover:bg-brand-50',
    ghost: 'text-brand-700 hover:bg-brand-50',
    danger: 'bg-white text-shu-700 border border-shu-100 hover:bg-shu-50',
  }[variant]
  const s = size === 'sm' ? 'min-h-8 px-3 py-1 text-sm' : 'min-h-11 px-5 py-2'
  return (
    <button
      type="button"
      className={`group inline-flex items-center justify-center gap-1.5 rounded-full font-bold transition disabled:pointer-events-none disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500 ${v} ${s} ${className}`}
      {...p}
    >
      {children}
      {variant === 'cta' && (
        <span aria-hidden className="ml-2 grid h-8 w-8 place-items-center rounded-full bg-white text-brand-600 transition group-hover:translate-x-0.5">
          →
        </span>
      )}
    </button>
  )
}

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <section className={`rounded-[20px] border border-line bg-white p-4 sm:p-6 ${className}`}>{children}</section>
}

/** 画面の見出し（■ ラベル＋大きな見出し）。KAGAMI の四角マーカーと、シフトラの助詞を小さくする見出し */
export function PageHead({ label, children, aside }: { label: string; children: ReactNode; aside?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        <p className="sq-label">{label}</p>
        <h1 className="font-display mt-1 text-2xl leading-snug sm:text-[32px]">{children}</h1>
      </div>
      {aside}
    </div>
  )
}

/** カードの中の小見出し */
export function CardTitle({ children, icon }: { children: ReactNode; icon?: ReactNode }) {
  return (
    <h2 className="font-display mb-3 flex items-center gap-2 text-lg text-ink">
      {icon && <span className="grid h-8 w-8 place-items-center rounded-full bg-brand-50 text-brand-600">{icon}</span>}
      {children}
    </h2>
  )
}

export function Field({ label, hint, children, className = '' }: { label: string; hint?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <label className={`block ${className}`}>
      <span className="mb-1.5 block text-sm font-bold text-ink">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs leading-relaxed text-slate-500">{hint}</span>}
    </label>
  )
}

export const inputCls =
  'w-full rounded-xl border border-line bg-white px-3.5 py-2.5 text-base text-ink transition focus:border-brand-400 focus:outline-none focus:ring-4 focus:ring-brand-100'

const LEVEL_STYLE: Record<Level, string> = {
  red: 'bg-shu-500 text-white',
  yellow: 'bg-sun-100 text-sun-700 ring-1 ring-sun-400/60',
  ok: 'bg-brand-50 text-brand-700 ring-1 ring-brand-200',
  done: 'bg-brand-500 text-white',
  none: 'bg-slate-100 text-slate-600',
}

export function Badge({ level, children }: { level: Level; children: ReactNode }) {
  return (
    <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-bold ${LEVEL_STYLE[level]}`}>
      {children}
    </span>
  )
}

/** 達成の印（緑のハンコ）。朱は「至急・未達」に取っておく */
export function Stamp({ children = '達成', size = 44 }: { children?: ReactNode; size?: number }) {
  return (
    <span className="stamp stamp-in text-brand-500" style={{ width: size, height: size, fontSize: size * 0.3 }}>
      {children}
    </span>
  )
}

export function Modal({ open, onClose, title, children, wide, locked }: { open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; wide?: boolean; locked?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null)
  const id = useId()
  const latest = useRef({ open, locked, onClose })
  latest.current = { open, locked, onClose }
  useEffect(() => {
    const d = ref.current
    if (!d) return
    if (open && !d.open) d.showModal()
    if (!open && d.open) d.close()
  }, [open])
  // Esc などでブラウザが閉じたとき。React の onClose は dialog で確実に届かないので、直接受ける。
  // 閉じられない画面（同意など）は開き直す（Chrome は cancel を毎回は止められない）
  useEffect(() => {
    const d = ref.current
    if (!d) return
    const onNativeClose = () => {
      const { open: o, locked: l, onClose: c } = latest.current
      if (l && o) setTimeout(() => d.isConnected && !d.open && d.showModal(), 0)
      else if (o) c()
    }
    const onCancel = (e: Event) => {
      if (latest.current.locked) e.preventDefault()
    }
    d.addEventListener('close', onNativeClose)
    d.addEventListener('cancel', onCancel)
    return () => {
      d.removeEventListener('close', onNativeClose)
      d.removeEventListener('cancel', onCancel)
    }
  }, [])
  return (
    <dialog
      ref={ref}
      aria-labelledby={id}
      onClick={(e) => {
        if (!locked && e.target === ref.current) onClose()
      }}
      className={`m-auto w-[calc(100%-1rem)] ${wide ? 'max-w-4xl' : 'max-w-lg'} max-h-[92vh] rounded-[24px] p-0 shadow-[0_24px_60px_rgba(12,59,46,0.25)] backdrop:bg-ink/50`}
    >
      {open && (
        <div className="flex max-h-[92vh] flex-col">
          <div className="flex items-center justify-between gap-2 border-b border-line px-4 py-3.5 sm:px-6">
            <h2 id={id} className="text-lg font-bold text-ink">
              {title}
            </h2>
            {!locked && (
              <button type="button" onClick={onClose} className="grid h-10 w-10 place-items-center rounded-full text-slate-500 hover:bg-paper" aria-label="閉じる">
                <X size={20} />
              </button>
            )}
          </div>
          <div className="overflow-y-auto px-4 py-5 sm:px-6">{children}</div>
        </div>
      )}
    </dialog>
  )
}

export function Notice({ tone = 'info', children }: { tone?: 'info' | 'warn' | 'ok'; children: ReactNode }) {
  const c = {
    info: 'bg-brand-50 text-brand-900',
    warn: 'bg-sun-100 text-sun-700',
    ok: 'bg-brand-50 text-brand-900 ring-1 ring-brand-200',
  }[tone]
  return <div className={`rounded-2xl px-4 py-3 text-sm leading-relaxed ${c}`}>{children}</div>
}

export function download(filename: string, data: BlobPart, type: string) {
  const url = URL.createObjectURL(new Blob([data], { type }))
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
