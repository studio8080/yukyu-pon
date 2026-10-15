import { pickAd, type AdSlotName } from '../lib/ads'
import { usePlan } from '../lib/plan'

/**
 * 広告の枠（src/lib/ads.ts）。無料プランの人にだけ出す。有料プラン（キーが有効）なら何も出さない。
 * 印刷には出さない（no-print）。広告のスクリプトは読み込まない（テキストと計測用の 1px 画像だけ）。
 */
export function AdSlot({ slot }: { slot: AdSlotName }) {
  const plan = usePlan()
  const ad = plan.pro ? null : pickAd(slot)
  if (!ad) return null
  return (
    <aside className="no-print rounded-[20px] border border-line bg-white p-4 sm:p-5" aria-label="広告">
      <p className="text-sm font-bold text-ink">{ad.heading}</p>
      <p className="mt-0.5 text-xs text-slate-600">{ad.lead}</p>
      <div className="mt-2 flex flex-wrap items-center gap-2 rounded-xl bg-paper px-3 py-2 text-sm">
        <span className="rounded bg-slate-200 px-1.5 py-0.5 text-[10px] font-bold text-slate-600">広告</span>
        {/* ASP のタグはそのまま入れる（書き換えは規約違反）。中身は ads.ts の isSafeAdTag で a と img だけに限っている */}
        <span className="ad-tag font-bold text-brand-700 underline" dangerouslySetInnerHTML={{ __html: ad.tag }} />
      </div>
      <p className="mt-1.5 text-[11px] text-slate-500">有料プランでは広告を表示しません。</p>
    </aside>
  )
}
