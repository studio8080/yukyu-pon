#!/usr/bin/env node
// Pro ライセンス用の Ed25519 鍵を作る（1回だけ）。秘密鍵はリポジトリの外に置く。
//   node tools/gen-keypair.mjs
// 既に秘密鍵があれば作り直さず、その公開鍵を表示する（作り直すと発行済みのキーが全部無効になる）。
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const dir = path.join(os.homedir(), '.yukyu-pon')
const file = path.join(dir, 'license-private.pem')
let priv
if (fs.existsSync(file)) {
  priv = crypto.createPrivateKey(fs.readFileSync(file, 'utf8'))
  console.log(`既存の秘密鍵を使います: ${file}`)
} else {
  fs.mkdirSync(dir, { recursive: true })
  const { privateKey } = crypto.generateKeyPairSync('ed25519')
  fs.writeFileSync(file, privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 })
  priv = privateKey
  console.log(`秘密鍵を作りました: ${file}（必ずバックアップすること。失うと再発行できない）`)
}
const jwk = crypto.createPublicKey(priv).export({ format: 'jwk' })
console.log(`公開鍵（src/lib/license.ts の PUBLIC_KEY）: ${jwk.x}`)
