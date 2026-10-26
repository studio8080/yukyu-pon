import { useEffect, useRef } from 'react'
import { UPDATES } from '../lib/updates'
import { Button, PageHead } from './ui'

/** ホームと一覧は同じ公開済みデータを参照し、従業員の保存領域は使わない。 */
export function LatestUpdate() {
  const latest = UPDATES[0]
  return (
    <aside aria-labelledby="latest-update-title" className="no-print mb-5 rounded-[20px] border border-brand-200 bg-white px-4 py-4 sm:px-6">
      <div className="mb-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
        <span className="font-bold text-brand-700">最新のお知らせ</span>
        <time dateTime={latest.date} className="tabular text-slate-600">{latest.date.replaceAll('-', '.')}</time>
      </div>
      <h2 id="latest-update-title" className="text-base leading-relaxed font-bold text-ink">{latest.title}</h2>
      <p className="mt-1 text-sm leading-relaxed text-slate-600">{latest.summary}</p>
      <a id="updates-link" href="#updates" className="mt-2 inline-flex min-h-11 items-center gap-2 rounded-lg font-bold text-brand-700 underline underline-offset-4 hover:text-brand-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500">
        更新情報を見る <span aria-hidden>→</span>
      </a>
    </aside>
  )
}

export function UpdatesView({ onBack }: { onBack: () => void }) {
  const title = useRef<HTMLDivElement>(null)
  useEffect(() => { title.current?.focus() }, [])
  return (
    <div className="no-print space-y-5">
      <div ref={title} tabIndex={-1} className="rounded-lg focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-brand-500">
        <PageHead label="有休ポンからのお知らせ">更新<small>情報</small></PageHead>
      </div>
      <p className="text-sm text-slate-600">公開済みの変更や、使う前に知っていただきたいお知らせをまとめています。</p>
      <ol className="overflow-hidden rounded-[20px] border border-line bg-white px-4 sm:px-6">
        {UPDATES.map((update) => (
          <li key={update.id} className="border-b border-line py-5 last:border-b-0 sm:py-6">
            <article aria-labelledby={`update-${update.id}`}>
              <div className="mb-2 flex flex-wrap items-center gap-3 text-xs">
                <time dateTime={update.date} className="tabular text-slate-600">{update.date.replaceAll('-', '.')}</time>
                <span className="rounded-full bg-brand-50 px-2.5 py-1 font-bold text-brand-700">{update.kind}</span>
              </div>
              <h2 id={`update-${update.id}`} className="text-lg leading-relaxed font-bold text-ink">{update.title}</h2>
              <p className="mt-2 max-w-3xl text-sm leading-relaxed text-slate-600">{update.summary}</p>
              {'link' in update && (
                <a href={update.link.href} className="mt-2 inline-flex min-h-11 items-center rounded-lg text-sm font-bold text-brand-700 underline underline-offset-4 hover:text-brand-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500">{update.link.label}</a>
              )}
            </article>
          </li>
        ))}
      </ol>
      <Button onClick={onBack}>アプリのホームへ戻る</Button>
    </div>
  )
}
