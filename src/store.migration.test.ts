import { afterEach, describe, expect, it, vi } from 'vitest'
import { defaultSettings } from './lib/defaults'

function storage(failBackup = false) {
  const items = new Map<string, string>()
  return {
    items,
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => { if (failBackup && key === 'yukyu-pon:before-review-v3') throw new Error('QuotaExceeded'); items.set(key, value) },
    removeItem: (key: string) => { items.delete(key) },
  }
}
const state = { settings: defaultSettings, employees: [], leaves: [{ id: 'past', employeeId: 'e', date: '2026-10-01', kind: 'full' }, { id: 'future', employeeId: 'e', date: '2026-11-01', kind: 'full' }], licenseKey: 'fixture-key', acceptedAt: '2026-01-01' }
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); vi.resetModules() })
describe('persist version 2→3 の実際のhydrate', () => {
  it('元の文字列を退避し、過去の従来計上と未来の未確認を保存する', async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-25T12:00:00Z'))
    const mem = storage(), original = JSON.stringify({ state, version: 2 }); mem.items.set('yukyu-pon:v1', original); vi.stubGlobal('localStorage', mem); vi.resetModules()
    const { useStore, hydrationError } = await import('./store')
    expect(hydrationError).toBe(''); expect(mem.items.get('yukyu-pon:before-review-v3')).toBe(original)
    expect(useStore.getState().leaves.map(l => l.confirmation)).toEqual(['legacy', 'pending'])
    expect(useStore.getState().licenseKey).toBe('fixture-key'); expect(useStore.getState().acceptedAt).toBe(state.acceptedAt)
    expect(JSON.parse(mem.items.get('yukyu-pon:v1')!).version).toBe(3)
  })
  it('退避失敗時は元の保存文字列を変更せず、編集停止用のエラーを返す', async () => {
    const mem = storage(true), original = JSON.stringify({ state, version: 2 }); mem.items.set('yukyu-pon:v1', original); vi.stubGlobal('localStorage', mem); vi.resetModules()
    const { hydrationError } = await import('./store')
    expect(hydrationError).toMatch(/移行/); expect(mem.items.get('yukyu-pon:v1')).toBe(original)
  })
  it('未来の未対応保存versionを拒否して元データを保持する', async () => {
    const mem = storage(), original = JSON.stringify({ state, version: 99 }); mem.items.set('yukyu-pon:v1', original); vi.stubGlobal('localStorage', mem); vi.resetModules()
    const { hydrationError } = await import('./store')
    expect(hydrationError).toBeTruthy(); expect(mem.items.get('yukyu-pon:v1')).toBe(original)
  })
})
