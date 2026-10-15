// 広告（アフィリエイト）。2026-10-15 運営者の決定: 無料プランの人にだけ出し、有料プラン（キーが有効）の人には出さない。
//
// 従業員のデータ（localStorage）を守るため、広告のスクリプトは一切読み込まない。
// 使えるのは A8.net・もしもアフィリエイトの「テキスト広告」（<a> と計測用の 1px の <img> だけ）。
// バナーの JS タグ・「かんたんリンク」（JS で商品を差し込むもの）は使わない（isSafeAdTag が弾く）。
//
// 出す場所: ホームの一覧の下と、ルールのページの下（src/components/AdSlot.tsx）。
// 出さない場所: 管理簿・本人へのお知らせ・印刷・設定・取り込み・初回の画面・料金や規約などの静的ページ。
//
// 広告を足すとき（運営者）:
//   1. ASP の管理画面で、掲載サイトに https://yukyu.kokokikaku.com/ を登録して提携し、テキスト広告のタグを取る
//   2. 下の AD_ITEMS に貼る。tag の中（URL・rel・アンカーテキスト）は書き換えない（ASP の規約）。
//      heading と lead はこちらの紹介文。広告主の説明の範囲を超えない（景表法）。断定・最上級を書かない
//   3. テスト（src/lib/ads.test.ts）が通ること。本番で表示を確かめ、ASP の「広告掲載URL」を提出する
// プライバシーポリシー（public/privacy.html 5章）と CSP（vite.config.ts の img-src）は、A8.net・もしもの分を先に入れてある。

export type AdSlotName = 'home' | 'guide'

export type AdItem = {
  id: string
  /** こちらで書く見出し（広告ではない） */
  heading: string
  /** こちらで書く紹介文（広告ではない） */
  lead: string
  /** ASP が生成したタグをそのまま */
  tag: string
  /** どの枠に出すか */
  slots: AdSlotName[]
}

/** false にすると全部の広告枠が消える */
export const ADS_ENABLED = true

export const AD_ITEMS: AdItem[] = [
  // 例（提携してからタグを差し替えて有効にする）:
  // {
  //   id: 'example',
  //   heading: '勤怠の打刻もまとめたくなったら',
  //   lead: '有休ポンは有休の管理だけの道具です。打刻・シフトまで管理したい会社向けのサービスです。',
  //   tag: '<a href="https://px.a8.net/svt/ejp?a8mat=XXXX" rel="nofollow">サービス名</a><img border="0" width="1" height="1" src="https://www10.a8.net/0.gif?a8mat=XXXX" alt="">',
  //   slots: ['home', 'guide'],
  // },
]

const LINK_HOSTS = /^https:\/\/(px\.a8\.net|af\.moshimo\.com)\//
const PIXEL_HOSTS = /^https:\/\/(www\d*\.a8\.net|i\.moshimo\.com)\//

/**
 * テキスト広告のタグとして安全か。<a>（ASP の計測リンク）と 1px の <img>（計測）だけを許す。
 * script・iframe・style・イベント属性・ほかのドメインが入っていたら false。
 */
export function isSafeAdTag(tag: string): boolean {
  if (/<\s*(script|iframe|object|embed|style|link|form|svg)\b/i.test(tag)) return false
  if (/\son\w+\s*=/i.test(tag) || /javascript:/i.test(tag)) return false
  const tags = tag.match(/<\s*\/?\s*([a-z0-9]+)/gi) ?? []
  if (tags.some((t) => !/^<\s*\/?\s*(a|img)$/i.test(t))) return false
  const hrefs = [...tag.matchAll(/\shref\s*=\s*"([^"]*)"/gi)].map((m) => m[1])
  const srcs = [...tag.matchAll(/\ssrc\s*=\s*"([^"]*)"/gi)].map((m) => m[1])
  if (hrefs.length !== 1 || !LINK_HOSTS.test(hrefs[0])) return false
  if (srcs.some((s) => !PIXEL_HOSTS.test(s))) return false
  return true
}

/** その枠に出す広告。無ければ null（枠ごと出さない） */
export function pickAd(slot: AdSlotName, items: AdItem[] = AD_ITEMS): AdItem | null {
  if (!ADS_ENABLED) return null
  return items.find((a) => a.slots.includes(slot) && isSafeAdTag(a.tag)) ?? null
}
