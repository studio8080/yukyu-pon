// 広告（アフィリエイト）。2026-10-15 運営者の決定: 無料プランの人にだけ出し、有料プラン（キーが有効）の人には出さない。
//
// 従業員のデータ（localStorage）を守るため、広告のスクリプトは一切読み込まない。
// 使えるのは A8.net・もしもアフィリエイトの「テキスト広告」と「バナー広告（画像）」だけ（<a> と <img> だけのタグ）。
// JS のタグ・「かんたんリンク」（JS で商品を差し込むもの）は使わない（isSafeAdTag が弾く）。
//
// 出す場所: ホームの一覧の下と、ルールのページの下（src/components/AdSlot.tsx）。
// 出さない場所: 管理簿・本人へのお知らせ・印刷・設定・取り込み・初回の画面・料金や規約などの静的ページ。
//
// 広告を足すとき（運営者）:
//   1. ASP の管理画面で、掲載サイトに https://yukyu.kokokikaku.com/ を登録して提携し、テキスト広告かバナー広告（画像）のタグを取る
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
  // もしもアフィリエイト（メディア「有休ポン」692885、2026-10-15 提携）。タグは運営者が管理画面からコピーしたもの（書き換えない）
  {
    id: 'kintai-cloud',
    heading: '出退勤の打刻もまとめて管理したくなったら',
    lead: '有休ポンは有休の管理だけの道具です。打刻や勤怠の集計まで管理したい会社向けに、中小企業向けの勤怠管理システムがあります（30日間の無料体験あり）。',
    tag: '<a href="//af.moshimo.com/af/c/click?a_id=5850784&p_id=7783&pc_id=22552&pl_id=96899" rel="nofollow" referrerpolicy="no-referrer-when-downgrade" attributionsrc><img src="//image.moshimo.com/af-img/5044/000000096899.png" width="728" height="91" style="border:none;"></a><img src="//i.moshimo.com/af/i/impression?a_id=5850784&p_id=7783&pc_id=22552&pl_id=96899" width="1" height="1" style="border:none;" loading="lazy">',
    slots: ['home'],
  },
  {
    id: 'relix-kintai',
    heading: '勤怠管理のシステムを試してみるなら',
    lead: '有休ポンは有休の管理だけの道具です。打刻や勤怠の集計まで管理したい会社向けの勤怠管理システムです（無料トライアルあり）。',
    tag: '<a href="//af.moshimo.com/af/c/click?a_id=5850787&p_id=4080&pc_id=10324&pl_id=55929" rel="nofollow" referrerpolicy="no-referrer-when-downgrade" attributionsrc><img src="//image.moshimo.com/af-img/3402/000000055929.jpg" width="120" height="60" style="border:none;"></a><img src="//i.moshimo.com/af/i/impression?a_id=5850787&p_id=4080&pc_id=10324&pl_id=55929" width="1" height="1" style="border:none;" loading="lazy">',
    slots: ['home'],
  },
  {
    id: 'remoba-roumu',
    heading: '労務の手続きを任せたいとき',
    lead: '社会保険・労働保険の手続きなど、労務の作業をオンラインで代行するサービスです。',
    tag: '<a href="//af.moshimo.com/af/c/click?a_id=5850788&p_id=3772&pc_id=9267&pl_id=52805" rel="nofollow" referrerpolicy="no-referrer-when-downgrade" attributionsrc><img src="//image.moshimo.com/af-img/3204/000000052805.jpg" width="234" height="60" style="border:none;"></a><img src="//i.moshimo.com/af/i/impression?a_id=5850788&p_id=3772&pc_id=9267&pl_id=52805" width="1" height="1" style="border:none;" loading="lazy">',
    slots: ['guide'],
  },
  // A8.net（サイト「有休ポン」、2026-10-15 提携）。タグは運営者が管理画面からコピーしたもの（書き換えない）
  {
    id: 'yayoi-kyuyo-next',
    heading: '給与計算や年末調整もまとめたくなったら',
    lead: '勤怠の打刻から給与計算・年末調整・入社の手続きまで、ひとつで扱えるクラウドの給与ソフトです（最大2か月の無料体験あり）。',
    tag: '<a href="https://px.a8.net/svt/ejp?a8mat=4BEH5B+67V6EQ+35XE+6G4HE" rel="nofollow">弥生給与 Nextはこちら</a><img border="0" width="1" height="1" src="https://www18.a8.net/0.gif?a8mat=4BEH5B+67V6EQ+35XE+6G4HE" alt="">',
    slots: ['home', 'guide'],
  },
  {
    id: 'mf-cloud',
    heading: '会計や給与などの事務をクラウドでまとめるなら',
    lead: '会計をはじめとするバックオフィスの業務を、クラウドで扱えるサービスです。',
    tag: '<a href="https://px.a8.net/svt/ejp?a8mat=4BEH5B+5URN3M+3SPO+8RK61U" rel="nofollow">マネーフォワード【マネーフォワード クラウド】</a><img border="0" width="1" height="1" src="https://www12.a8.net/0.gif?a8mat=4BEH5B+5URN3M+3SPO+8RK61U" alt="">',
    slots: ['guide'],
  },
  // 例（A8.net のテキスト広告）:
  // {
  //   id: 'example',
  //   heading: '勤怠の打刻もまとめたくなったら',
  //   lead: '有休ポンは有休の管理だけの道具です。打刻・シフトまで管理したい会社向けのサービスです。',
  //   tag: '<a href="https://px.a8.net/svt/ejp?a8mat=XXXX" rel="nofollow">サービス名</a><img border="0" width="1" height="1" src="https://www10.a8.net/0.gif?a8mat=XXXX" alt="">',
  //   slots: ['home', 'guide'],
  // },
]

// https:// か、プロトコル省略の //（https のページでは https になる）だけを許す
const LINK_HOSTS = /^(https:)?\/\/(px\.a8\.net|af\.moshimo\.com)\//
// 計測用の 1px 画像と、バナーの画像
const IMAGE_HOSTS = /^(https:)?\/\/(www\d*\.a8\.net|i\.moshimo\.com|image\.moshimo\.com)\//

/**
 * 広告のタグとして安全か。<a>（ASP の計測リンク）と <img>（バナー画像・計測用の 1px）だけを許す。
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
  if (srcs.some((s) => !IMAGE_HOSTS.test(s))) return false
  return true
}

/** その枠に出す広告。複数あれば random（0〜1）で1つ選ぶ。無ければ null（枠ごと出さない） */
export function pickAd(slot: AdSlotName, items: AdItem[] = AD_ITEMS, random = Math.random()): AdItem | null {
  if (!ADS_ENABLED) return null
  const ok = items.filter((a) => a.slots.includes(slot) && isSafeAdTag(a.tag))
  return ok.length ? ok[Math.min(ok.length - 1, Math.floor(random * ok.length))] : null
}
