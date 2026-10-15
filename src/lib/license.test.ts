import { generateKeyPairSync, sign } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PUBLIC_KEY, peekPayload, renewIfNeeded, renewWith, verifyLicense, verifyWith } from './license'

// 使い捨ての鍵ペア（本番の秘密鍵は使わない）
const { privateKey, publicKey } = generateKeyPairSync('ed25519')
const pub = publicKey.export({ format: 'jwk' }).x as string
const pem = privateKey.export({ type: 'pkcs8', format: 'pem' }) as string
const issue = (payload: object) => {
  const body = Buffer.from(JSON.stringify(payload))
  return `YP1-${body.toString('base64url')}.${sign(null, body, privateKey).toString('base64url')}`
}

// Cloud Functions の署名（functions/sign.js）をそのまま読み込む
const require = createRequire(import.meta.url)
const fnSign = require('../../functions/sign.js') as {
  signKey: (pem: string, expiry: string, id: string, limit: number | null) => string
  licenseIdFor: (subscriptionId: string) => string
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

describe('Cloud Functions が作るキーをブラウザが読める（サーバーとフロントの契約）', () => {
  it('functions/sign.js で署名したキー（Pro 30人・ビジネス無制限）を検証でき、中身（n / e / id）が一致する', async () => {
    const id = fnSign.licenseIdFor('sub_1TestYukyuPon')
    const pro = await verifyWith(pub, fnSign.signKey(pem, '2027-01-31', id, 30), '2026-10-06')
    expect(pro.ok && pro.payload).toEqual({ v: 1, p: 'pro', e: '2027-01-31', id, n: 30 })
    const biz = await verifyWith(pub, fnSign.signKey(pem, '2027-01-31', id, null), '2026-10-06')
    expect(biz.ok && biz.payload).toEqual({ v: 1, p: 'pro', e: '2027-01-31', id })
    // 期限の当日までは有効、翌日は期限切れ（サーバーの expiry と同じ日付の文字列で比べる）
    expect((await verifyWith(pub, fnSign.signKey(pem, '2026-11-14', id, 30), '2026-11-14')).ok).toBe(true)
    expect((await verifyWith(pub, fnSign.signKey(pem, '2026-11-14', id, 30), '2026-11-15')).ok).toBe(false)
  })
  it('ライセンスIDは更新先に送れる形（英数字と - _ の12文字）', () => {
    for (const s of ['sub_1TestYukyuPon', 'sub_1QzZ9xLkdIwHu7ix', 'sub_A']) expect(fnSign.licenseIdFor(s)).toMatch(/^[A-Za-z0-9_-]{12}$/)
  })
  it('本番の公開鍵は Ed25519 の生32バイト（base64url）で、WebCrypto に読み込める', async () => {
    expect(PUBLIC_KEY).toMatch(/^[A-Za-z0-9_-]{43}$/)
    const raw = Buffer.from(PUBLIC_KEY, 'base64url')
    expect(raw.length).toBe(32)
    await expect(crypto.subtle.importKey('raw', raw, { name: 'Ed25519' }, false, ['verify'])).resolves.toBeTruthy()
  })
  it('sign.js のキーを本番の公開鍵で確かめると「形式は合っていて署名だけ違う」になる（形式・アルゴリズムが一致）', async () => {
    const k = fnSign.signKey(pem, '2027-01-31', 'Emn4w-UX3Ygb', 30)
    const r = await verifyLicense(k, '2026-10-15')
    expect(r.ok).toBe(false)
    expect(!r.ok && r.reason).toMatch(/キーが正しくありません/)
    expect(r.payload).toEqual({ v: 1, p: 'pro', e: '2027-01-31', id: 'Emn4w-UX3Ygb', n: 30 })
    expect(peekPayload(k)?.id).toBe('Emn4w-UX3Ygb')
  })
  it('手動発行（tools/issue-key.mjs）も同じ形式（YP1-・Ed25519・base64url・v:1, p:pro）で作る', () => {
    const src = readFileSync(new URL('../../tools/issue-key.mjs', import.meta.url), 'utf8')
    expect(src).toContain("const payload = { v: 1, p: 'pro', e: until, id }")
    expect(src).toContain("`YP1-${body.toString('base64url')}.${sig.toString('base64url')}`")
    expect(src).toContain('crypto.sign(null, body')
    const fsrc = readFileSync(new URL('../../functions/sign.js', import.meta.url), 'utf8')
    expect(fsrc).toContain("`YP1-${body.toString('base64url')}.${sig.toString('base64url')}`")
  })
})

describe('キーの自動更新（renewIfNeeded）', () => {
  const API = 'https://asia-northeast1-misefits.cloudfunctions.net/yukyuponLicense'
  const ID = 'Emn4w-UX3Ygb'
  const TODAY = '2026-10-15'
  const keyUntil = (e: string, extra: object = { n: 30 }) => issue({ v: 1, p: 'pro', e, id: ID, ...extra })
  const respond = (status: number, body?: unknown) => vi.fn(async () => new Response(body === undefined ? null : typeof body === 'string' ? body : JSON.stringify(body), { status }))
  const stub = (f: ReturnType<typeof vi.fn>) => {
    vi.stubGlobal('fetch', f)
    return f
  }
  afterEach(() => vi.unstubAllGlobals())

  it('期限まで11日以上あり、前回の確認から7日未満なら通信しない', async () => {
    const f = stub(respond(200, {}))
    expect(await renewWith(pub, API, keyUntil('2026-10-26'), '2026-10-10T09:00:00.000Z', TODAY)).toEqual({ kind: 'skip', reason: 'not-due' })
    expect(f).not.toHaveBeenCalled()
  })
  it('期限の10日前になったら取り直す。送るのはライセンスIDだけ', async () => {
    const f = stub(respond(200, { key: keyUntil('2026-11-14') }))
    const r = await renewWith(pub, API, keyUntil('2026-10-25'), '2026-10-15T00:00:00.000Z', TODAY)
    expect(r).toEqual({ kind: 'renewed', key: keyUntil('2026-11-14'), expiry: '2026-11-14' })
    expect(f).toHaveBeenCalledTimes(1)
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe(`${API}?id=${ID}`)
    expect(init).toEqual({ method: 'GET', cache: 'no-store' })
  })
  it('前回の確認から7日たったら取り直す（解約を早く反映する）。確認の記録が無いときも', async () => {
    const f = stub(respond(200, { key: keyUntil('2026-11-14') }))
    expect((await renewWith(pub, API, keyUntil('2026-11-10'), '2026-10-08T23:00:00.000Z', TODAY)).kind).toBe('renewed')
    expect((await renewWith(pub, API, keyUntil('2026-11-10'), '2026-10-09T00:00:00.000Z', TODAY)).kind).toBe('skip') // 6日
    expect((await renewWith(pub, API, keyUntil('2026-11-10'), null, TODAY)).kind).toBe('renewed')
    expect(f).toHaveBeenCalledTimes(2)
  })
  it('「更新を確認」（force）はいつでも取り直す。プランを変えていれば人数上限が変わる', async () => {
    stub(respond(200, { key: keyUntil('2026-11-14', {}) }))
    const r = await renewWith(pub, API, keyUntil('2026-11-10'), '2026-10-15T00:00:00.000Z', TODAY, true)
    expect(r.kind).toBe('renewed')
    expect(r.kind === 'renewed' && peekPayload(r.key)?.n).toBeUndefined()
  })
  it('410 のときだけ revoked（キーを消して無料に戻す）', async () => {
    stub(respond(410, { error: 'not entitled', entitledUntil: '2026-10-05' }))
    expect(await renewWith(pub, API, keyUntil('2026-10-20'), null, TODAY)).toEqual({ kind: 'revoked' })
  })
  it('404（手動発行のキー）・503（Stripe に照会できない）・500 は何もしない（キーを消さない）', async () => {
    for (const s of [404, 503, 500, 429]) {
      stub(respond(s, { error: 'x' }))
      expect(await renewWith(pub, API, keyUntil('2026-10-20'), null, TODAY)).toEqual({ kind: 'skip', reason: `http-${s}` })
    }
  })
  it('オフライン（fetch が失敗）は何もしない', async () => {
    stub(vi.fn(async () => Promise.reject(new TypeError('Failed to fetch'))))
    expect(await renewWith(pub, API, keyUntil('2026-10-20'), null, TODAY)).toEqual({ kind: 'skip', reason: 'offline' })
  })
  it('壊れた応答・偽の署名・別の契約のキー・期限切れのキーには差し替えない', async () => {
    stub(respond(200, 'not json'))
    expect((await renewWith(pub, API, keyUntil('2026-10-20'), null, TODAY)).kind).toBe('skip')
    stub(respond(200, {}))
    expect(await renewWith(pub, API, keyUntil('2026-10-20'), null, TODAY)).toEqual({ kind: 'skip', reason: 'bad-response' })
    const other = generateKeyPairSync('ed25519').privateKey
    const body = Buffer.from(JSON.stringify({ v: 1, p: 'pro', e: '2099-12-31', id: ID }))
    stub(respond(200, { key: `YP1-${body.toString('base64url')}.${sign(null, body, other).toString('base64url')}` }))
    expect((await renewWith(pub, API, keyUntil('2026-10-20'), null, TODAY)).kind).toBe('skip')
    stub(respond(200, { key: issue({ v: 1, p: 'pro', e: '2026-11-14', id: 'someoneElse1' }) }))
    expect(await renewWith(pub, API, keyUntil('2026-10-20'), null, TODAY)).toEqual({ kind: 'skip', reason: 'id-mismatch' })
    stub(respond(200, { key: keyUntil('2026-10-01') }))
    expect((await renewWith(pub, API, keyUntil('2026-10-20'), null, TODAY)).kind).toBe('skip')
  })
  it('キーが無い・読めない・IDが更新先に送れない形なら通信しない', async () => {
    const f = stub(respond(200, {}))
    expect((await renewWith(pub, API, '', null, TODAY)).kind).toBe('skip')
    expect((await renewWith(pub, '', keyUntil('2026-10-20'), null, TODAY)).kind).toBe('skip')
    expect((await renewWith(pub, API, 'YP1-!!!.x', null, TODAY)).kind).toBe('skip')
    expect((await renewWith(pub, API, issue({ v: 1, p: 'pro', e: '2026-10-20', id: 'a&b=c' }), null, TODAY)).kind).toBe('skip')
    expect(f).not.toHaveBeenCalled()
  })
  it('renewIfNeeded は本番の公開鍵で確かめる（使い捨ての鍵のキーは受け取らない）', async () => {
    stub(respond(200, { key: keyUntil('2026-11-14') }))
    const r = await renewIfNeeded(API, keyUntil('2026-10-20'), null, TODAY)
    expect(r.kind).toBe('skip')
  })
})
