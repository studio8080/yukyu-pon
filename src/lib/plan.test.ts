import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LICENSE_API } from '../config'
import { useStore } from '../store'
import { renewLicense } from './plan'

// 起動時・「更新を確認」で呼ぶ renewLicense が、サーバーの応答ごとにキーをどう扱うか（キーを消すのは 410 のときだけ）
const KEY = `YP1-${Buffer.from(JSON.stringify({ v: 1, p: 'pro', e: '2000-01-01', id: 'Emn4w-UX3Ygb', n: 30 })).toString('base64url')}.sig`

describe('renewLicense', () => {
  beforeEach(() => {
    useStore.getState().setLicenseKey(KEY)
    useStore.getState().setLicenseNotice('')
  })
  afterEach(() => vi.unstubAllGlobals())
  const stub = (status: number) => {
    const f = vi.fn(async () => new Response(JSON.stringify({ error: 'x' }), { status }))
    vi.stubGlobal('fetch', f)
    return f
  }

  it('410 ならキーを外して無料プランに戻し、お知らせを出す', async () => {
    const f = stub(410)
    expect(await renewLicense(true)).toMatch(/キーを外しました/)
    expect(f.mock.calls[0][0]).toBe(`${LICENSE_API}?id=Emn4w-UX3Ygb`)
    expect(useStore.getState().licenseKey).toBe('')
    expect(useStore.getState().licenseNotice).toMatch(/無料プランに戻りました/)
  })
  it('503（Stripe に照会できない）・500 ではキーを残す', async () => {
    for (const s of [503, 500]) {
      stub(s)
      expect(await renewLicense(true)).toMatch(/一時的に使えません/)
      expect(useStore.getState().licenseKey).toBe(KEY)
    }
  })
  it('404（手動発行のキー）ではキーを残す', async () => {
    stub(404)
    expect(await renewLicense(true)).toMatch(/手動で発行したキー/)
    expect(useStore.getState().licenseKey).toBe(KEY)
  })
  it('オフラインではキーを残す', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new TypeError('Failed to fetch'))))
    expect(await renewLicense(true)).toMatch(/通信できませんでした/)
    expect(useStore.getState().licenseKey).toBe(KEY)
  })
})
