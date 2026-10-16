#!/usr/bin/env node
// 出荷前チェック（課金まわり）。ネットワーク・秘密情報なしで、リポジトリのファイルだけを読んで確かめる。
//
//   node tools/preflight.mjs          デプロイ前（Functions を出す前・設定を変えたあと）
//   node tools/preflight.mjs --sale   販売受付の確認（購入リンク4本と人数制限の開始日・告知の整合）
//
// 失敗が1つでもあれば終了コード 1。手順は docs/launch-checklist.md の「デプロイ前」「販売開始前」。
import crypto from 'node:crypto'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SALE = process.argv.includes('--sale')
const require = createRequire(import.meta.url)
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8')
const exists = (p) => fs.existsSync(path.join(ROOT, p))
/** 隣にある全銀ポンの課金コード（定数は functions/billing.js、古い形は index.js にある）。無ければ空文字 */
const zenginSource = () =>
  ['../zengin-pon/functions/billing.js', '../zengin-pon/functions/index.js'].filter(exists).map(read).join('\n')

const results = []
const ok = (name, detail = '') => results.push({ s: 'ok', name, detail })
const ng = (name, detail = '') => results.push({ s: 'NG', name, detail })
const warn = (name, detail = '') => results.push({ s: '注意', name, detail })
const check = (cond, name, detail = '') => (cond ? ok(name, detail) : ng(name, detail))
const tryRun = (name, fn) => {
  try {
    fn()
  } catch (e) {
    ng(name, `確認中にエラー: ${e.message}`)
  }
}

const { PLANS } = require(path.join(ROOT, 'functions/plans.js'))
const sign = require(path.join(ROOT, 'functions/sign.js'))
const B = require(path.join(ROOT, 'functions/billing.js'))
const indexSrc = read('functions/index.js')
const configSrc = read('src/config.ts')
const licenseSrc = read('src/lib/license.ts')
const viteSrc = read('vite.config.ts')
const pricing = read('public/pricing.html')
const tokushoho = read('public/tokushoho.html')
const terms = read('public/terms.html')

const constOf = (src, name) => {
  const m = src.match(new RegExp(`export const ${name}\\s*=\\s*([^\\n]+)`))
  return m ? m[1].trim() : null
}
const strOf = (src, name) => {
  const v = constOf(src, name)
  const m = v && v.match(/^['"`]([^'"`]*)['"`]/)
  return m ? m[1] : null
}
const yen = (n) => n.toLocaleString('en-US')

// ---------------- 1. 商品ID とプラン ----------------
tryRun('商品ID', () => {
  for (const [k, p] of Object.entries(PLANS)) check(/^prod_[A-Za-z0-9]{8,}$/.test(p.productId || ''), `plans.js: ${k} の商品IDが入っている`, p.productId || '(空)')
  check(PLANS.pro.productId !== PLANS.business.productId, 'plans.js: Pro とビジネスの商品IDが別')
  const zp = zenginSource().match(/ZP_PRODUCT_ID = '([^']+)'/)
  if (zp) check(!Object.values(PLANS).some((p) => p.productId === zp[1]), 'plans.js: 全銀ポンの商品IDと重ならない', zp[1])
})

// ---------------- 2. 料金と人数の一致 ----------------
tryRun('料金', () => {
  const free = Number(constOf(configSrc, 'FREE_LIMIT'))
  const cfg = {}
  for (const m of configSrc.matchAll(/\{ key: '(\w+)', name: '([^']+)', limit: (\w+), month: (\d+), year: (\d+) \}/g)) cfg[m[1]] = { name: m[2], limit: m[3] === 'null' || m[3] === 'FREE_LIMIT' ? (m[3] === 'null' ? null : free) : Number(m[3]), month: Number(m[4]), year: Number(m[5]) }
  check(cfg.pro && cfg.business && cfg.free, 'config.ts: PLANS を読み取れる', Object.keys(cfg).join(','))
  check(cfg.pro.limit === PLANS.pro.limit && cfg.business.limit === PLANS.business.limit, 'config.ts の人数上限 = plans.js の limit', `Pro ${PLANS.pro.limit} / ビジネス ${PLANS.business.limit}`)
  check(cfg.pro.name === PLANS.pro.name && cfg.business.name === PLANS.business.name, 'config.ts のプラン名 = plans.js')
  const mail = B.cancelScheduledMail('2026年11月2日') + B.canceledMail()
  check(mail.includes(`無料プラン（在籍${free}人まで）`), `メール文の「無料プラン（在籍${free}人まで）」= FREE_LIMIT`)
  for (const k of ['pro', 'business']) {
    const p = cfg[k]
    const lim = p.limit ? `在籍${p.limit}人まで` : '人数無制限'
    check(pricing.includes(`¥${yen(p.month)}`) && pricing.includes(`¥${yen(p.year)}`), `pricing.html に ${p.name} の ¥${yen(p.month)}・¥${yen(p.year)}`)
    check(tokushoho.includes(`${yen(p.month)}円`) && tokushoho.includes(`${yen(p.year)}円`), `tokushoho.html に ${p.name} の ${yen(p.month)}円・${yen(p.year)}円`)
    check(pricing.includes(lim), `pricing.html に「${lim}」`)
    const welcome = B.welcomeMail('YP1-x.y', 'id', PLANS[k], 'month')
    check(welcome.includes(`${p.name}プラン（月払い・${lim}）`), `キーのメールに「${p.name}プラン（月払い・${lim}）」`)
  }
  check(pricing.includes(`在籍${free}人まで`), `pricing.html に無料の「在籍${free}人まで」`)
  check(tokushoho.includes(`在籍${PLANS.pro.limit}人まで`), `tokushoho.html に「在籍${PLANS.pro.limit}人まで」`)
  check(/第3条[\s\S]{0,2000}(30人|在籍)/.test(terms) || terms.includes('料金プラン'), 'terms.html に料金・人数の条項がある')
})

// ---------------- 3. 更新先の URL・CSP・CORS ----------------
tryRun('URL', () => {
  const api = strOf(configSrc, 'LICENSE_API')
  const project = JSON.parse(read('.firebaserc')).projects.default
  const fbj = JSON.parse(read('firebase.json'))
  const codebase = (fbj.functions || []).find((f) => f.source === 'functions')
  const expected = `https://${B.REGION}-${project}.cloudfunctions.net/yukyuponLicense`
  check(api === expected, 'config.ts の LICENSE_API = Functions の URL（リージョン・プロジェクト・関数名）', api)
  check(/exports\.yukyuponLicense\s*=/.test(indexSrc) && /exports\.yukyuponStripeWebhook\s*=/.test(indexSrc), 'index.js が yukyuponLicense・yukyuponStripeWebhook を出している')
  check(codebase && codebase.codebase === 'yukyupon', 'firebase.json の codebase が yukyupon（MiseFits・全銀ポンの関数を消さない）')
  const csp = viteSrc.match(/connect-src ([^;]+);/)
  const origin = new URL(api).origin
  check(csp && csp[1].trim().split(/\s+/).includes(origin), 'vite.config.ts の CSP connect-src に更新先がある（消すと有料の人が30日で無料に戻る）', csp ? csp[1].trim() : '(なし)')
  check(csp && csp[1].trim().split(/\s+/).length === 1, 'CSP connect-src は更新先だけ（データを外に出さない）')
  const site = `https://${read('public/CNAME').trim()}`
  check(B.SITE === site, 'billing.js の SITE = public/CNAME', site)
  check(B.ALLOWED_ORIGINS.includes(site), 'Functions の ALLOWED_ORIGINS に本番のオリジン', B.ALLOWED_ORIGINS.join(' '))
  check(B.ALLOWED_ORIGINS.every((o) => o === site || /^http:\/\/localhost:\d+$/.test(o)), 'ALLOWED_ORIGINS は本番と localhost だけ')
  const pkg = JSON.parse(read('functions/package.json'))
  check(/--only functions:yukyupon\b/.test(pkg.scripts.deploy) && pkg.scripts.deploy.includes(`--project ${project}`), 'functions/package.json の deploy に --only functions:yukyupon', pkg.scripts.deploy)
  for (const s of ['STRIPE_SECRET_KEY', 'YP_STRIPE_WEBHOOK_SECRET', 'YP_LICENSE_PRIVATE_KEY', 'SMTP_USER', 'MAIL_FROM', 'SMTP_PASS']) check(indexSrc.includes(`defineSecret('${s}')`), `シークレット ${s} を参照している`)
})

// ---------------- 4. メール ----------------
tryRun('メール', () => {
  check(B.SENDER_NAME === '有休ポン（ここ企画）', '差出人名が「有休ポン（ここ企画）」（共用の MAIL_FROM の表示名を使わない）', B.SENDER_NAME)
  check(JSON.stringify(B.fromHeader('MiseFits <studio@kokokikaku.com>')) === JSON.stringify({ name: B.SENDER_NAME, address: 'studio@kokokikaku.com' }), 'MAIL_FROM からアドレスだけ取り出す')
  check(/^https:\/\/billing\.stripe\.com\/p\/login\/[A-Za-z0-9]+$/.test(B.PORTAL_URL), 'PORTAL_URL がカスタマーポータルのログインリンク', B.PORTAL_URL)
  if (zenginSource()) {
    const zp = zenginSource().match(/PORTAL_URL = '([^']*)'/)
    check(zp && zp[1] !== B.PORTAL_URL, 'PORTAL_URL が有休ポン専用（全銀ポンのリンクだとプランの切り替え先に有休ポンの価格が出ない）', B.PORTAL_URL)
  } else warn('PORTAL_URL を全銀ポンと照合できない（../zengin-pon が無い）')
  const plan = PLANS.pro
  const bodies = {
    キー: B.welcomeMail('YP1-abc.def', 'Emn4w-UX3Ygb', plan, 'year'),
    更新: B.renewalMail('YP1-abc.def', '2026-11-14', 'Emn4w-UX3Ygb', plan, 'month'),
    解約受付: B.cancelScheduledMail('2026年11月2日'),
    終了: B.canceledMail(),
    運営者: B.operatorMail('テスト', { a: 1 }, 'YP1-abc.def'),
  }
  for (const [k, text] of Object.entries(bodies)) {
    check(!text.includes('**') && !/^#{1,6} /m.test(text) && !/\[[^\]]+\]\(http/.test(text), `メール（${k}）はプレーンテキスト（Markdown なし）`)
    check(!/undefined|null|NaN|\$\{/.test(text), `メール（${k}）に埋め込み漏れがない`)
  }
  check(bodies.キー.includes(`${B.SITE}/#pro`) && bodies.キー.includes(B.PORTAL_URL), 'キーのメールに /#pro と契約の管理ページ')
  check(bodies.解約受付.includes(B.PORTAL_URL), '解約受付のメールに契約の管理ページ（取り消し用）')
  check(!/\*\*/.test(indexSrc.replace(/\/\*[\s\S]*?\*\//g, '')), 'index.js の文字列に ** が無い')
})

// ---------------- 5. キーの形式（公開鍵・署名・接頭辞） ----------------
tryRun('キー', () => {
  const pub = strOf(licenseSrc, 'PUBLIC_KEY')
  check(/^[A-Za-z0-9_-]{43}$/.test(pub || '') && Buffer.from(pub, 'base64url').length === 32, 'license.ts の PUBLIC_KEY が Ed25519 の生32バイト（base64url）', pub)
  let pubKey = null
  try {
    pubKey = crypto.createPublicKey({ key: { kty: 'OKP', crv: 'Ed25519', x: pub }, format: 'jwk' })
  } catch {
    /* 下で NG */
  }
  check(!!pubKey, 'PUBLIC_KEY を Ed25519 の公開鍵として読み込める')
  // 使い捨ての鍵で sign.js のキーを作り、license.ts の正規表現と中身の形に合うか
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519')
  const pem = privateKey.export({ type: 'pkcs8', format: 'pem' })
  const id = sign.licenseIdFor('sub_preflight')
  const key = sign.signKey(pem, '2027-01-31', id, 30)
  const reSrc = licenseSrc.match(/s\.match\((\/\^YP1-[^\n]+?\$\/)\)/)
  const re = reSrc ? new Function(`return ${reSrc[1]}`)() : null
  check(!!re && re.test(key), 'sign.js のキーが license.ts の形式（YP1-<base64url>.<base64url>）に合う', key.slice(0, 16) + '…')
  const [, body, sig] = key.match(/^YP1-([^.]+)\.(.+)$/)
  const payload = JSON.parse(Buffer.from(body, 'base64url').toString())
  check(payload.v === 1 && payload.p === 'pro' && payload.e === '2027-01-31' && payload.id === id && payload.n === 30, 'キーの中身が { v:1, p:"pro", e, id, n }')
  check(crypto.verify(null, Buffer.from(body, 'base64url'), publicKey, Buffer.from(sig, 'base64url')), 'sign.js の署名が Ed25519（使い捨ての鍵で検証）')
  check(pubKey && !crypto.verify(null, Buffer.from(body, 'base64url'), pubKey, Buffer.from(sig, 'base64url')), '本番の公開鍵は使い捨ての鍵の署名を通さない')
  check(/^[A-Za-z0-9_-]{6,32}$/.test(id) && indexSrc.includes('/^[A-Za-z0-9_-]{6,32}$/'), 'ライセンスIDがキー更新エンドポイントの受け付ける形')
})

// ---------------- 6. 購入リンクと PRO_ENFORCED ----------------
tryRun('購入リンク', () => {
  const ids = ['buy-pro-month', 'buy-pro-year', 'buy-biz-month', 'buy-biz-year']
  const links = ids.map((id) => {
    const m = pricing.match(new RegExp(`<a\\b([^>]*\\bid="${id}"[^>]*)>([^<]*)</a>`))
    if (!m) return { id, found: false }
    const attr = (n) => (m[1].match(new RegExp(`\\b${n}="([^"]*)"`)) || [])[1] || ''
    return { id, found: true, href: attr('href'), cls: attr('class'), text: m[2] }
  })
  check(links.every((l) => l.found), 'pricing.html に購入ボタン4つ（buy-pro-month / -year、buy-biz-month / -year）')
  const live = links.filter((l) => /^https:\/\/buy\.stripe\.com\/[A-Za-z0-9]+$/.test(l.href) && !/\boff\b/.test(l.cls) && !l.text.includes('準備中'))
  const prep = links.filter((l) => l.href === '#' && /\boff\b/.test(l.cls) && l.text.includes('準備中'))
  const enforceFrom = strOf(configSrc, 'ENFORCE_FROM')
  const enforced = constOf(configSrc, 'PRO_ENFORCED') === 'true' || /^\d{4}-\d{2}-\d{2}$/.test(enforceFrom || '')
  if (live.length === 4) {
    check(new Set(live.map((l) => l.href)).size === 4, '購入リンク4本がすべて別の URL', live.map((l) => l.href).join(' '))
    ok('購入リンク: 4本とも buy.stripe.com（販売中）')
  } else if (prep.length === 4) {
    ;(SALE ? ng : ok)('購入リンク: 4本とも「準備中」（販売前）', SALE ? '販売開始には4本の支払いリンクが要る（launch-checklist 3-2）' : '')
  } else {
    ng('購入リンク: 「準備中」と販売中が混ざっている', links.map((l) => `${l.id}=${l.href}`).join(' '))
  }
  if (SALE) check(enforced, '人数の制限を始める日（ENFORCE_FROM）が決まっている', enforceFrom || '')
  else if (enforced && live.length !== 4) ng('人数の制限が決まっているのに購入リンクがそろっていない（6人目から使えなくなるのに申し込めない）')
  else ok(`人数の制限: ${enforceFrom || 'なし'}`, enforced ? '' : '販売開始で ENFORCE_FROM を決める（--sale で確認）')
  const status = (pricing.match(/id="status">([\s\S]*?)<\/p>/) || [])[1] || ''
  if (live.length === 4 && status.includes('準備中')) (SALE ? ng : warn)('pricing.html の #status が「準備中」のまま', status.slice(0, 40))
  if (enforceFrom) {
    const [, y, m, d] = enforceFrom.match(/^(\d+)-(\d+)-(\d+)$/) || []
    const jp = y ? `${y}年${Number(m)}月${Number(d)}日` : ''
    check(status.includes(jp), `pricing.html の #status に制限の開始日（${jp}）`, status.slice(0, 60))
    check(read('public/llms.txt').includes(jp), `llms.txt に制限の開始日（${jp}）`)
  }
})

// ---------------- 7. 秘密情報がリポジトリに入っていない ----------------
tryRun('秘密情報', () => {
  const gi = read('.gitignore')
  for (const p of ['*.pem', 'functions/.env', 'tools/issued-keys.csv']) check(gi.includes(p), `.gitignore に ${p}`)
  const hits = []
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (['node_modules', '.git', 'dist'].includes(e.name)) continue
      const p = path.join(dir, e.name)
      if (e.isDirectory()) walk(p)
      else if (fs.statSync(p).size < 2_000_000 && /\.(js|mjs|ts|tsx|json|html|md|txt|yml|yaml|env|pem)$/.test(e.name)) {
        const s = fs.readFileSync(p, 'utf8')
        if (/-----BEGIN [A-Z ]*PRIVATE KEY-----|\b(sk|rk)_live_[A-Za-z0-9]{10,}|\bwhsec_[A-Za-z0-9]{20,}/.test(s)) hits.push(path.relative(ROOT, p))
      }
    }
  }
  walk(ROOT)
  check(hits.length === 0, '秘密鍵・Stripe の本番キー・Webhook の署名シークレットがファイルに無い', hits.join(' '))
})

// ---------------- 結果 ----------------
const width = Math.max(...results.map((r) => r.s.length))
for (const r of results) console.log(`${r.s.padEnd(width)}  ${r.name}${r.detail ? `  — ${r.detail}` : ''}`)
const failed = results.filter((r) => r.s === 'NG').length
const warned = results.filter((r) => r.s === '注意').length
console.log(`\n${SALE ? '販売開始前' : 'デプロイ前'}のチェック: ${results.length - failed - warned} ok / ${warned} 注意 / ${failed} NG`)
console.log('ネットワークを使う確認（Stripe の Webhook の API バージョン・イベント4件・制限付きキーの権限）は docs/launch-checklist.md の手順で人が見る。')
process.exit(failed ? 1 : 0)
