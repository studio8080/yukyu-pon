// バックアップのファイルをパスワードで暗号化する（ブラウザの Web Crypto だけで行う。外部には送らない）。
// 鍵: パスワード → PBKDF2（SHA-256、60万回、ランダムな salt 16バイト）→ AES-GCM 256bit。
// AES-GCM は改ざんも検出するので、パスワード違い・ファイルの破損はどちらも「戻せない」になる。
// パスワードは保存しない。忘れると、運営者を含め誰も戻せない。

export const ENCRYPTED_FORMAT = 'yukyu-pon-backup-encrypted'
export const DEFAULT_ITERATIONS = 600_000
export const MIN_PASSWORD = 8

type EncryptedFile = {
  format: typeof ENCRYPTED_FORMAT
  version: 1
  savedAt: string
  kdf: { name: 'PBKDF2'; hash: 'SHA-256'; iterations: number; salt: string }
  cipher: { name: 'AES-GCM'; iv: string }
  data: string
}

function toB64(bytes: Uint8Array): string {
  let s = ''
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(s)
}

function fromB64(s: string): Uint8Array<ArrayBuffer> {
  const bin = atob(s)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

async function deriveKey(password: string, salt: Uint8Array<ArrayBuffer>, iterations: number): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey'])
  return crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])
}

export function isEncryptedBackup(text: string): boolean {
  try {
    return JSON.parse(text)?.format === ENCRYPTED_FORMAT
  } catch {
    return false
  }
}

export async function encryptBackup(plain: string, password: string, iterations = DEFAULT_ITERATIONS): Promise<string> {
  if (password.length < MIN_PASSWORD) throw new Error(`パスワードは${MIN_PASSWORD}文字以上にしてください。`)
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const key = await deriveKey(password, salt, iterations)
  const data = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(plain)))
  const file: EncryptedFile = {
    format: ENCRYPTED_FORMAT,
    version: 1,
    savedAt: new Date().toISOString(),
    kdf: { name: 'PBKDF2', hash: 'SHA-256', iterations, salt: toB64(salt) },
    cipher: { name: 'AES-GCM', iv: toB64(iv) },
    data: toB64(data),
  }
  return JSON.stringify(file)
}

export async function decryptBackup(text: string, password: string): Promise<string> {
  let f: EncryptedFile
  try {
    f = JSON.parse(text)
  } catch {
    throw new Error('ファイルを読めませんでした。')
  }
  if (f?.format !== ENCRYPTED_FORMAT || f.version !== 1 || f.kdf?.name !== 'PBKDF2' || f.cipher?.name !== 'AES-GCM') {
    throw new Error('有休ポンの暗号化バックアップではありません。')
  }
  const iterations = Number(f.kdf.iterations)
  if (!Number.isInteger(iterations) || iterations < 100_000 || iterations > 10_000_000) throw new Error('ファイルの形式が正しくありません。')
  try {
    const key = await deriveKey(password, fromB64(f.kdf.salt), iterations)
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromB64(f.cipher.iv) }, key, fromB64(f.data))
    return new TextDecoder().decode(plain)
  } catch {
    throw new Error('パスワードが違うか、ファイルが壊れています。')
  }
}
