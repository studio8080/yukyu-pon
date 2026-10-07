import { describe, expect, it } from 'vitest'
import { decryptBackup, encryptBackup, isEncryptedBackup } from './crypto'

const plain = JSON.stringify({ format: 'yukyu-pon-backup', employees: [{ name: '佐藤 花子' }], leaves: [] })
const IT = 100_000 // テストを速くするため回数を減らす（本番は 600,000）

describe('バックアップの暗号化', () => {
  it('同じパスワードで戻せる', async () => {
    const enc = await encryptBackup(plain, 'correct horse', IT)
    expect(isEncryptedBackup(enc)).toBe(true)
    expect(enc).not.toContain('佐藤')
    expect(await decryptBackup(enc, 'correct horse')).toBe(plain)
  })
  it('パスワードが違うと戻せない', async () => {
    const enc = await encryptBackup(plain, 'correct horse', IT)
    await expect(decryptBackup(enc, 'wrong horse')).rejects.toThrow('パスワードが違う')
  })
  it('中身を書き換えると戻せない（改ざんの検出）', async () => {
    const enc = JSON.parse(await encryptBackup(plain, 'correct horse', IT))
    const bytes = atob(enc.data)
    enc.data = btoa(String.fromCharCode(bytes.charCodeAt(0) ^ 1) + bytes.slice(1))
    await expect(decryptBackup(JSON.stringify(enc), 'correct horse')).rejects.toThrow()
  })
  it('毎回ちがう salt と IV を使う', async () => {
    const a = JSON.parse(await encryptBackup(plain, 'correct horse', IT))
    const b = JSON.parse(await encryptBackup(plain, 'correct horse', IT))
    expect(a.kdf.salt).not.toBe(b.kdf.salt)
    expect(a.cipher.iv).not.toBe(b.cipher.iv)
  })
  it('短いパスワードは断る。暗号化していないファイルは別物として扱う', async () => {
    await expect(encryptBackup(plain, 'short', IT)).rejects.toThrow('8文字以上')
    expect(isEncryptedBackup(plain)).toBe(false)
  })
})
