#!/usr/bin/env node
// Pro ライセンスキーを発行する。
//   node tools/issue-key.mjs --months 12            今日から12か月（＋更新の余裕3日）
//   node tools/issue-key.mjs --until 2027-03-31     期限を直接指定
//   node tools/issue-key.mjs --months 1 --id ord_123 --memo "〇〇商店"
//   node tools/issue-key.mjs --months 12 --limit 30  人数の上限つき（省略 = 無制限）
// 秘密鍵: 環境変数 YP_PRIVATE_KEY_FILE か ~/.yukyu-pon/license-private.pem
// 台帳: tools/issued-keys.csv（gitignore 済み）に追記する。
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const args = process.argv.slice(2)
const opt = (name, def) => {
  const i = args.indexOf(name)
  return i >= 0 ? args[i + 1] : def
}
const pemFile = process.env.YP_PRIVATE_KEY_FILE || path.join(os.homedir(), '.yukyu-pon', 'license-private.pem')
if (!fs.existsSync(pemFile)) {
  console.error(`秘密鍵が見つかりません: ${pemFile}（node tools/gen-keypair.mjs で作る）`)
  process.exit(1)
}
let until = opt('--until')
if (!until) {
  const d = new Date()
  d.setMonth(d.getMonth() + Number(opt('--months', '12')))
  d.setDate(d.getDate() + 3)
  until = d.toISOString().slice(0, 10)
}
const id = opt('--id') || crypto.randomBytes(4).toString('hex')
const payload = { v: 1, p: 'pro', e: until, id }
if (opt('--limit')) payload.n = Number(opt('--limit'))
const body = Buffer.from(JSON.stringify(payload), 'utf8')
const sig = crypto.sign(null, body, crypto.createPrivateKey(fs.readFileSync(pemFile, 'utf8')))
const key = `YP1-${body.toString('base64url')}.${sig.toString('base64url')}`
const ledger = path.join(path.dirname(fileURLToPath(import.meta.url)), 'issued-keys.csv')
fs.appendFileSync(ledger, `${new Date().toISOString()},${id},${until},${payload.n ?? ''},${JSON.stringify(opt('--memo', ''))}\n`)
console.log(`有効期限: ${until}  発行ID: ${id}${payload.n ? `  人数上限: ${payload.n}` : ''}`)
console.log(key)
