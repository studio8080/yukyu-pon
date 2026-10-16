import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { usePlan } from './plan'
const input = vi.hoisted(() => ({ licenseKey: '', employees: [], asOf: '2026-10-16' }))
vi.mock('../store', () => ({ useStore: (select: (s: typeof input) => unknown) => select(input) }))
afterEach(() => { input.licenseKey = '' })
function Status() {
  const plan = usePlan()
  return createElement('output', { 'data-checking': plan.checking, 'data-pro': plan.pro })
}
describe('キー確認が終わる前のプラン表示', () => {
  it('未登録なら確認待ちにせず無料として描画する', () => {
    expect(renderToStaticMarkup(createElement(Status))).toContain('data-checking="false"')
  })
  it('保存済みキーがあれば初回描画から確認待ちにする', () => {
    input.licenseKey = 'LOCAL-QA-ONLY'
    const html = renderToStaticMarkup(createElement(Status))
    expect(html).toContain('data-checking="true"')
    expect(html).toContain('data-pro="false"')
  })
})
