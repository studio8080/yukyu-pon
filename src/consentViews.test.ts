import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import App from './App'
import { ToolConsentDialog } from './components/ToolConsent'

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
