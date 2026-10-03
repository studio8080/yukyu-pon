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
