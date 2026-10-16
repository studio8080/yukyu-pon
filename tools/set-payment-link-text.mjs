// 支払いリンクに「申込みの最終確認」の文（送信ボタン付近のカスタムテキスト）を入れる。特商法12条の6（docs/compliance-check.md）。
// Stripe のダッシュボードにはこの欄が無く、Workbench の Shell は本番では読み取り専用なので、API で入れる。
//
// 使い方（運営者が自分の PowerShell で。キーは画面に貼るだけで、ファイルにもリポジトリにも残さない）:
//   1. Stripe → 開発者 → API キー →「制限付きのキーを作成」。権限は「Payment Links: 書き込み」だけ。名前は yukyupon-payment-link-text など
//   2. C:\Users\chaha\tools\node-v24.14.0-win-x64\node.exe tools/set-payment-link-text.mjs plink_… plink_… plink_… plink_…
//      キーを聞かれたら貼り付けて Enter（画面には出さない。環境変数 STRIPE_PL_KEY があればそれを使う）
//   3. 終わったら Stripe で作ったキーを削除する
//
// リンクの商品と価格を Stripe から読み、有休ポン（functions/plans.js の商品ID）の4つの価格のどれかを確かめてから文を決める。
// 金額・商品・周期が想定と違えば何も書かずに止まる。--dry-run なら読むだけ。
import { createRequire } from 'node:module'
const { PLANS } = createRequire(import.meta.url)('../functions/plans.js')

const args = process.argv.slice(2)
const dry = args.includes('--dry-run')
const ids = args.filter((a) => a.startsWith('plink_'))
if (!ids.length) {
  console.error('plink_… を指定してください（ファイル冒頭の使い方）')
  process.exit(1)
}

/** 環境変数が無ければ、画面に出さずに入力してもらう（貼り付けた文字は表示しない） */
async function askKey() {
  if (process.env.STRIPE_PL_KEY) return process.env.STRIPE_PL_KEY.trim()
  process.stdout.write('制限付きキー（rk_live_…）を貼り付けて Enter（画面には表示しません）: ')
  const { stdin } = process
  stdin.setRawMode?.(true)
  stdin.resume()
  stdin.setEncoding('utf8')
  let key = ''
  return new Promise((resolve) => {
    stdin.on('data', function onData(chunk) {
      for (const ch of chunk) {
        if (ch === '\r' || ch === '\n') {
          stdin.setRawMode?.(false)
          stdin.pause()
          stdin.off('data', onData)
          process.stdout.write('\n')
          return resolve(key.trim())
        }
        if (ch === '\u0003') process.exit(130) // Ctrl+C
        if (ch === '\u0008' || ch === '\u007f') key = key.slice(0, -1)
        else key += ch
      }
    })
  })
}
const KEY = await askKey()
if (!/^rk_live_/.test(KEY)) {
  console.error(`制限付きキー（rk_live_ で始まるもの）ではありません（${KEY.slice(0, 8)}…）。公開可能キー（pk_live_）では書き込めません。`)
  process.exit(1)
}

const CONFIRM = 'https://yukyu.kokokikaku.com/pricing.html#confirm'
const TAIL = `解約はいつでも、キーのメールにある契約の管理ページから。次回の決済日の前日までに解約すれば次回分は請求されません。返金は初回決済から7日以内のお申し出に限ります。利用規約と確認事項: ${CONFIRM}`
const yen = (n) => n.toLocaleString('ja-JP')
const EXPECTED = {
  [`${PLANS.pro.productId}:month`]: { amount: 480, label: '有休ポン Pro（在籍30人まで）' },
  [`${PLANS.pro.productId}:year`]: { amount: 4800, label: '有休ポン Pro（在籍30人まで）' },
  [`${PLANS.business.productId}:month`]: { amount: 980, label: '有休ポン ビジネス（人数無制限）' },
  [`${PLANS.business.productId}:year`]: { amount: 9800, label: '有休ポン ビジネス（人数無制限）' },
}
function textFor(e, interval) {
  return interval === 'month'
    ? `${e.label}月額${yen(e.amount)}円（税込）。毎月自動で更新され、解約の手続きをするまで続きます（1年続けると${yen(e.amount * 12)}円）。${TAIL}`
    : `${e.label}年額${yen(e.amount)}円（税込）。毎年自動で更新され、解約の手続きをするまで続きます。${TAIL}`
}

async function stripe(path, body) {
  const res = await fetch(`https://api.stripe.com/v1/${path}`, {
    method: body ? 'POST' : 'GET',
    headers: { Authorization: `Bearer ${KEY}`, ...(body ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}) },
    body: body ? new URLSearchParams(body) : undefined,
  })
  const json = await res.json()
  if (!res.ok) throw new Error(`${res.status} ${json.error?.message || ''}`)
  return json
}

let failed = false
for (const id of ids) {
  try {
    const items = (await stripe(`payment_links/${id}/line_items`)).data
    if (items.length !== 1) throw new Error(`商品が ${items.length} 件（1件のはず）`)
    const price = items[0].price
    const interval = price.recurring?.interval
    const e = EXPECTED[`${price.product}:${interval}`]
    if (!e) throw new Error(`有休ポンの価格ではない（${price.product} / ${interval}）`)
    if (price.unit_amount !== e.amount || price.currency !== 'jpy') throw new Error(`金額が違う（${price.unit_amount} ${price.currency}、想定 ${e.amount} jpy）`)
    const message = textFor(e, interval)
    if (!dry) await stripe(`payment_links/${id}`, { 'custom_text[submit][message]': message })
    const link = await stripe(`payment_links/${id}`)
    const ok = dry || link.custom_text?.submit?.message === message
    console.log(`${ok ? 'ok ' : 'NG '} ${id}  ${e.label} ${interval === 'month' ? '月払い' : '年払い'}  ${link.url}`)
    console.log(`     確認文: ${link.custom_text?.submit?.message || '(なし)'}`)
    console.log(`     利用規約への同意: ${link.consent_collection?.terms_of_service || 'none'} / 税の自動徴収: ${link.automatic_tax?.enabled ? 'オン（要確認）' : 'オフ'} / 完了ページ: ${link.after_completion?.type}`)
    if (!ok) failed = true
  } catch (err) {
    failed = true
    console.log(`NG  ${id}  ${err.message}`)
  }
}
process.exit(failed ? 1 : 0)
