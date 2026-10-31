import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import { ToolConsentDialog } from './components/ToolConsent'
import { backupNow } from './components/SettingsView'
import { download } from './components/ui'
import { useAutosave } from './lib/backup'
import { defaultSettings } from './lib/defaults'
import { makeSample } from './lib/sample'
import { currentData, useStore } from './store'

// SSRでは購読せず、各ケースで用意した実storeの状態を読ませる。
vi.mock('./store', async importOriginal => {
  const actual = await importOriginal<typeof import('./store')>()
  const readCurrent = ((selector: (state: ReturnType<typeof actual.useStore.getState>) => unknown) => selector(actual.useStore.getState())) as typeof actual.useStore
  return { ...actual, useStore: Object.assign(readCurrent, actual.useStore) }
})
vi.mock('./lib/backup', async importOriginal => {
  const actual = await importOriginal<typeof import('./lib/backup')>()
  const readCurrent = ((selector?: (state: ReturnType<typeof actual.useAutosave.getState>) => unknown) => selector ? selector(actual.useAutosave.getState()) : actual.useAutosave.getState()) as typeof actual.useAutosave
  return { ...actual, useAutosave: Object.assign(readCurrent, actual.useAutosave) }
})
vi.mock('./components/ui', async importOriginal => ({ ...await importOriginal<typeof import('./components/ui')>(), download: vi.fn() }))

beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-30T12:00:00Z'))
  useStore.setState({ settings: defaultSettings, employees: [], leaves: [], acceptedAt: null, asOf: '2026-10-30', lastBackupAt: null, lastChangeAt: null, licenseKey: '', licenseNotice: '' })
  useAutosave.setState({ state: 'off', fileName: '', savedAt: null, error: '' })
  vi.mocked(download).mockClear()
})
afterEach(() => vi.useRealTimers())

describe('初回閲覧と同意画面のHTML', () => {
  it('初回トップの説明・料金・規約・記事リンクは同意チェックなしで表示する', () => {
    const html = renderToStaticMarkup(createElement(App))
    expect(html).toContain('有休')
    expect(html).toContain('入社日と週の勤務日数')
    expect(html).toContain('サンプルで試す')
    expect(html).toContain('href="./articles/"')
    expect(html).toContain('href="./pricing.html"')
    expect(html).toContain('href="./terms.html"')
    expect(html).not.toMatch(/<dialog\b[^>]*\sopen(?:=|\s|>)/)
    expect(html).not.toContain('aria-modal="true"')
    expect(html).not.toContain('利用規約に同意し、計算結果を自分で確認してから使います')
  })
  it('利用開始の画面には従来の注意3点・規約・未選択チェック・退出導線を残す', () => {
    const html = renderToStaticMarkup(createElement(ToolConsentDialog, { onClose: vi.fn(), onContinue: vi.fn() }))
    expect(html).toContain('就業規則・労使協定・法令と照らして確認')
    expect(html).toContain('ブラウザのデータを消すと消えます')
    expect(html).toContain('計算の根拠と、扱えないこと')
    expect(html).toContain('href="./terms.html"')
    expect(html).toContain('type="checkbox"')
    expect(html).not.toContain('checked=""')
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>同意してはじめる/)
    expect(html).toContain('同意せず公開情報に戻る')
    expect(html).toContain('aria-label="閉じる"')
    expect(html).toContain('href="./articles/"')
  })
  it('静的な料金・規約・解説には初回同意の部品を埋め込まない', () => {
    for (const path of ['pricing.html', 'terms.html', 'articles/index.html', 'privacy.html']) {
      const html = readFileSync(new URL(`../public/${path}`, import.meta.url), 'utf8')
      expect(html).not.toContain('first-use-title')
      expect(html).not.toContain('ToolConsent')
      expect(html).not.toContain('利用規約に同意し、計算結果を自分で確認してから使います')
    }
  })
})

describe('未同意の既存利用者の手動バックアップ', () => {
  for (const scenario of [
    { name: '直近バックアップ済み', lastBackupAt: '2026-10-30T10:00:00Z', lastChangeAt: '2026-10-30T09:00:00Z', auto: 'off' },
    { name: 'バックアップ後に変更なし', lastBackupAt: '2026-10-01T00:00:00Z', lastChangeAt: '2026-10-01T00:00:00Z', auto: 'off' },
    { name: '自動保存稼働中', lastBackupAt: null, lastChangeAt: '2026-10-30T09:00:00Z', auto: 'ok' },
    { name: '自動保存の許可待ち', lastBackupAt: null, lastChangeAt: '2026-10-30T09:00:00Z', auto: 'need-permission' },
  ] as const) {
    it(`${scenario.name}でも同意不要の手動保存入口がある`, () => {
      useStore.setState({ ...makeSample('2026-10-30'), lastBackupAt: scenario.lastBackupAt, lastChangeAt: scenario.lastChangeAt })
      useAutosave.setState({ state: scenario.auto })
      const before = currentData(), html = renderToStaticMarkup(createElement(App))
      expect(html).toMatch(/<button[^>]*>バックアップを保存<\/button>/)
      expect(html).not.toContain('利用規約に同意し、計算結果を自分で確認してから使います')
      expect(currentData()).toEqual(before); expect(useStore.getState().acceptedAt).toBeNull()
    })
  }
  it('従業員0件でも休暇記録が残っていればバックアップできる', () => {
    useStore.setState({ leaves: makeSample('2026-10-30').leaves })
    expect(renderToStaticMarkup(createElement(App))).toMatch(/<button[^>]*>バックアップを保存<\/button>/)
  })
  it('保存データがない初回は空バックアップの入口を出さない', () => {
    expect(renderToStaticMarkup(createElement(App))).not.toContain('>バックアップを保存<')
  })
  it('従業員と休暇がなくても会社の設定が残っていれば保存入口がある', () => {
    useStore.setState({ settings: { ...defaultSettings, companyName: '架空のテスト会社' } })
    expect(renderToStaticMarkup(createElement(App))).toMatch(/<button[^>]*>バックアップを保存<\/button>/)
  })
  it('未同意でも手動保存は現在のデータを出力し、同意やデータを変更しない', () => {
    useStore.setState({ ...makeSample('2026-10-30'), lastBackupAt: '2026-10-30T10:00:00Z' })
    useAutosave.setState({ state: 'ok' })
    const before = currentData()
    backupNow()
    expect(download).toHaveBeenCalledTimes(1)
    const [name, content, mime] = vi.mocked(download).mock.calls[0]
    expect(name).toBe('有休ポン_バックアップ_2026-10-30.json')
    expect(mime).toBe('application/json')
    expect(JSON.parse(content as string)).toMatchObject(before)
    expect(currentData()).toEqual(before); expect(useStore.getState().acceptedAt).toBeNull()
  })
})
