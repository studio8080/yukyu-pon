import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AdSlot } from './AdSlot'
const state = vi.hoisted(() => ({ pro: false, checking: false }))
vi.mock('../lib/plan', () => ({ usePlan: () => state }))
afterEach(() => { state.pro = false; state.checking = false; vi.restoreAllMocks() })
describe('広告を描画してよいプラン状態', () => {
  it('キー未登録の無料状態は広告ラベルと広告を描画する', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0)
    const html = renderToStaticMarkup(createElement(AdSlot, { slot: 'home' }))
    expect(html).toContain('aria-label="広告"')
    expect(html).toContain('af.moshimo.com/af/c/click')
  })
  it('保存済みキーの確認中はリンク・画像を一切描画しない', () => {
    state.checking = true
    for (const slot of ['home', 'guide'] as const)
      expect(renderToStaticMarkup(createElement(AdSlot, { slot }))).toBe('')
  })
  it('キー確認が成功した有料状態も広告を描画しない', () => {
    state.pro = true
    for (const slot of ['home', 'guide'] as const)
      expect(renderToStaticMarkup(createElement(AdSlot, { slot }))).toBe('')
  })
  it('確認が終わり無料と判定された状態は広告を描画できる', () => {
    state.checking = true
    expect(renderToStaticMarkup(createElement(AdSlot, { slot: 'guide' }))).toBe('')
    state.checking = false
    expect(renderToStaticMarkup(createElement(AdSlot, { slot: 'guide' }))).toContain('aria-label="広告"')
  })
})

