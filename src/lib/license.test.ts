import { generateKeyPairSync, sign } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { verifyWith } from './license'

const { privateKey, publicKey } = generateKeyPairSync('ed25519')
const pub = publicKey.export({ format: 'jwk' }).x as string
const issue = (payload: object) => {
  const body = Buffer.from(JSON.stringify(payload))
  return `YP1-${body.toString('base64url')}.${sign(null, body, privateKey).toString('base64url')}`
}

describe('ライセンスキー', () => {
  it('正しいキーは期限まで有効', async () => {
    const k = issue({ v: 1, p: 'pro', e: '2027-01-31', id: 'abc' })
    expect((await verifyWith(pub, k, '2027-01-31')).ok).toBe(true)
    const r = await verifyWith(pub, k, '2027-02-01')
    expect(r.ok).toBe(false)
    expect(!r.ok && r.expired).toBe(true)
  })
  it('書き換えたキー・形式違いは無効', async () => {
    const k = issue({ v: 1, p: 'pro', e: '2027-01-31', id: 'abc' })
    const forged = k.replace(/^YP1-[^.]+/, 'YP1-' + Buffer.from(JSON.stringify({ v: 1, p: 'pro', e: '2099-12-31', id: 'abc' })).toString('base64url'))
    expect((await verifyWith(pub, forged, '2026-10-03')).ok).toBe(false)
    expect((await verifyWith(pub, 'ZP1-xxx.yyy', '2026-10-03')).ok).toBe(false)
  })
  it('貼り付けた改行や空白は無視する', async () => {
    const k = issue({ v: 1, p: 'pro', e: '2027-01-31', id: 'abc' })
    expect((await verifyWith(pub, `  ${k.slice(0, 20)}\n${k.slice(20)} `, '2026-10-03')).ok).toBe(true)
  })
})

describe('Cloud Functions が作るキーをブラウザが読める', () => {
  it('functions/sign.js で署名したキー（Pro 30人・ビジネス無制限）を検証できる', async () => {
    const { createRequire } = await import('node:module')
    const require = createRequire(import.meta.url)
    const { signKey } = require('../../functions/sign.js')
    const pem = privateKey.export({ type: 'pkcs8', format: 'pem' })
    const pro = await verifyWith(pub, signKey(pem, '2027-01-31', 'Emn4w-UX3Ygb', 30), '2026-10-06')
    expect(pro.ok && pro.payload.n).toBe(30)
    const biz = await verifyWith(pub, signKey(pem, '2027-01-31', 'Emn4w-UX3Ygb', null), '2026-10-06')
    expect(biz.ok && biz.payload.n).toBeUndefined()
  })
})
