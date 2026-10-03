import { X } from 'lucide-react'
import { useEffect, useId, useRef, type ButtonHTMLAttributes, type ReactNode } from 'react'
import type { Level } from '../lib/engine'

type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger'
  size?: 'sm' | 'md'
}

export function Button({ variant = 'secondary', size = 'md', className = '', ...p }: BtnProps) {
  const v = {
    primary: 'bg-brand-600 text-white hover:bg-brand-700 shadow-sm',
    secondary: 'bg-white text-brand-800 border border-brand-200 hover:bg-brand-50',
    ghost: 'text-brand-700 hover:bg-brand-50',
    danger: 'bg-white text-red-700 border border-red-200 hover:bg-red-50',
  }[variant]
  const s = size === 'sm' ? 'px-2.5 py-1 text-sm' : 'px-4 py-2'
  return (
    <button
      type="button"
      className={`inline-flex items-center justify-center gap-1.5 rounded-lg font-medium transition disabled:opacity-40 disabled:pointer-events-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500 ${v} ${s} ${className}`}
      {...p}
    />
  )
}

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <section className={`rounded-2xl border border-black/5 bg-white p-4 shadow-sm sm:p-5 ${className}`}>{children}</section>
}

export function Field({ label, hint, children, className = '' }: { label: string; hint?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <label className={`block ${className}`}>
      <span className="mb-1 block text-sm font-medium text-slate-700">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-slate-500">{hint}</span>}
    </label>
  )
}

export const inputCls =
  'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-base focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-100'

const LEVEL_STYLE: Record<Level, string> = {
  red: 'bg-red-100 text-red-800 ring-red-200',
  yellow: 'bg-sun-100 text-amber-900 ring-amber-200',
  ok: 'bg-sky-50 text-sky-800 ring-sky-200',
  done: 'bg-brand-100 text-brand-800 ring-brand-200',
  none: 'bg-slate-100 text-slate-600 ring-slate-200',
}

export function Badge({ level, children }: { level: Level; children: ReactNode }) {
  return (
    <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold ring-1 ${LEVEL_STYLE[level]}`}>
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
      className={`m-auto w-[calc(100%-1rem)] ${wide ? 'max-w-4xl' : 'max-w-lg'} max-h-[92vh] rounded-2xl p-0 shadow-2xl backdrop:bg-slate-900/40`}
    >
      {open && (
        <div className="flex max-h-[92vh] flex-col">
          <div className="flex items-center justify-between gap-2 border-b border-slate-100 px-4 py-3 sm:px-5">
            <h2 id={id} className="text-lg font-bold text-slate-800">
              {title}
            </h2>
            {!locked && (
              <button type="button" onClick={onClose} className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100" aria-label="閉じる">
                <X size={20} />
              </button>
            )}
          </div>
          <div className="overflow-y-auto px-4 py-4 sm:px-5">{children}</div>
        </div>
      )}
    </dialog>
  )
}

export function Notice({ tone = 'info', children }: { tone?: 'info' | 'warn' | 'ok'; children: ReactNode }) {
  const c = {
    info: 'border-sky-200 bg-sky-50 text-sky-900',
    warn: 'border-amber-200 bg-amber-50 text-amber-900',
    ok: 'border-brand-200 bg-brand-50 text-brand-900',
  }[tone]
  return <div className={`rounded-xl border px-3 py-2 text-sm ${c}`}>{children}</div>
}

export function download(filename: string, data: BlobPart, type: string) {
  const url = URL.createObjectURL(new Blob([data], { type }))
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
