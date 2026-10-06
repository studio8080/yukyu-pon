// Pro のライセンスキーの検証（サーバー不要）。全銀ポンと同じ方式で、鍵は別。
//
// キーの形式: YP1-<base64url(payload JSON)>.<base64url(Ed25519 署名 64バイト)>
//   payload = { v:1, p:"pro", e:"YYYY-MM-DD"(有効期限), id:"発行ID", n?: 人数の上限（省略 = 無制限） }
// 発行は tools/issue-key.mjs（秘密鍵はリポジトリの外: ~/.yukyu-pon/license-private.pem）。
// ブラウザは埋め込んだ公開鍵で署名を確かめるだけなので、通信は発生しない。

export const PUBLIC_KEY = 'TkJf60rhqyPKKwiLvUvKw0Cv5vNFjiZpdxQMSJvg7RE' // Ed25519 公開鍵（生32バイト、base64url）

export type LicensePayload = { v: number; p: string; e: string; id: string; n?: number }
export type LicenseResult = { ok: true; payload: LicensePayload } | { ok: false; reason: string; payload?: LicensePayload; expired?: boolean }

function b64u(s: string): Uint8Array<ArrayBuffer> {
  let t = s.replace(/-/g, '+').replace(/_/g, '/')
  while (t.length % 4) t += '='
  const bin = atob(t)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

const keys = new Map<string, Promise<CryptoKey>>()
function importKey(pub: string) {
  if (!keys.has(pub)) keys.set(pub, crypto.subtle.importKey('raw', b64u(pub), { name: 'Ed25519' }, false, ['verify']))
  return keys.get(pub)!
}

export function verifyLicense(input: string, today: string): Promise<LicenseResult> {
  return verifyWith(PUBLIC_KEY, input, today)
}

export async function verifyWith(pub: string, input: string, today: string): Promise<LicenseResult> {
  const s = String(input || '').trim().replace(/\s+/g, '')
  const m = s.match(/^YP1-([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)$/)
  if (!m) return { ok: false, reason: 'キーの形式が違います（YP1- で始まる文字列をそのまま貼り付けてください）' }
  let payload: LicensePayload
  try {
    payload = JSON.parse(new TextDecoder().decode(b64u(m[1])))
  } catch {
    return { ok: false, reason: 'キーを読み取れません' }
  }
  let sigOk = false
  try {
    sigOk = await crypto.subtle.verify({ name: 'Ed25519' }, await importKey(pub), b64u(m[2]), b64u(m[1]))
  } catch {
    sigOk = false
  }
  if (!sigOk) return { ok: false, reason: 'キーが正しくありません（コピー漏れがないか確認してください）', payload }
  if (payload.v !== 1 || payload.p !== 'pro' || !/^\d{4}-\d{2}-\d{2}$/.test(payload.e || '')) return { ok: false, reason: 'このキーは対応していません', payload }
  if (payload.e < today) return { ok: false, reason: `有効期限（${payload.e}）が切れています。更新したキーを入れるとまた使えます`, payload, expired: true }
  return { ok: true, payload }
}

/** キーの中身を読むだけ（署名は確かめない。更新先に送る ID を取り出すため） */
export function peekPayload(key: string): LicensePayload | null {
  const m = String(key || '').trim().match(/^YP1-([A-Za-z0-9_-]+)\./)
  if (!m) return null
  try {
    return JSON.parse(new TextDecoder().decode(b64u(m[1])))
  } catch {
    return null
  }
}

const REFRESH_WITHIN_DAYS = 10 // 期限がこれ以内に迫ったら取り直す
const RECHECK_AFTER_DAYS = 7 // 前回の確認からこれだけ経ったら取り直す（解約を早く反映するため）

export type RenewResult =
  | { kind: 'renewed'; key: string; expiry: string }
  | { kind: 'revoked' } // 契約が終わっている → キーを消して無料プランへ
  | { kind: 'skip'; reason: string } // 何もしない（オフライン・未登録・まだ早い など）

const dayDiff = (a: string, b: string) => Math.round((Date.parse(a + 'T00:00:00Z') - Date.parse(b + 'T00:00:00Z')) / 86400000)

/**
 * 必要ならキーを取り直す。送るのはライセンスIDだけ。
 * 契約中なら期限が延びたキー、解約済みなら 410 → revoked。通信できなければ何もしない（手元のキーの期限までは使える）。
 */
export async function renewIfNeeded(api: string, key: string, checkedAt: string | null, today: string, force = false): Promise<RenewResult> {
  if (!api || !key) return { kind: 'skip', reason: 'no-key' }
  const p = peekPayload(key)
  if (!p?.id) return { kind: 'skip', reason: 'no-id' }
  if (!force) {
    const soon = !p.e || dayDiff(p.e, today) <= REFRESH_WITHIN_DAYS
    const stale = !checkedAt || dayDiff(today, checkedAt.slice(0, 10)) >= RECHECK_AFTER_DAYS
    if (!soon && !stale) return { kind: 'skip', reason: 'not-due' }
  }
  let res: Response
  try {
    res = await fetch(`${api}?id=${encodeURIComponent(p.id)}`, { method: 'GET', cache: 'no-store' })
  } catch {
    return { kind: 'skip', reason: 'offline' }
  }
  if (res.status === 410) return { kind: 'revoked' }
  if (!res.ok) return { kind: 'skip', reason: `http-${res.status}` }
  let j: { key?: string }
  try {
    j = await res.json()
  } catch {
    return { kind: 'skip', reason: 'bad-response' }
  }
  if (!j?.key) return { kind: 'skip', reason: 'bad-response' }
  const v = await verifyLicense(j.key, today)
  if (!v.ok) return { kind: 'skip', reason: v.reason }
  return { kind: 'renewed', key: j.key, expiry: v.payload.e }
}
