import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createToolConsent, needsToolConsent } from './toolConsent'
import { currentData, useStore } from '../store'
import { defaultSettings } from './defaults'
import { makeSample } from './sample'
import { buildReport } from './engine'

function fixture(accepted = false) {
  let agreed = accepted
  const accept = vi.fn(() => { agreed = true })
  const open = vi.fn()
  const gate = createToolConsent(() => agreed, accept, open)
  return { gate, accept, open, action: vi.fn() }
}

describe('閲覧と利用開始の分離', () => {
  it('初回の作成だけでは同意画面も書込みも起きない', () => {
    const f = fixture()
    expect(f.open).not.toHaveBeenCalled()
    expect(f.accept).not.toHaveBeenCalled()
  })
  it('公開情報・閲覧・管理簿は遮らず、入力する画面は利用開始を確認する', () => {
    for (const tab of ['home', 'guide', 'updates', 'ledger']) expect(needsToolConsent(tab)).toBe(false)
    for (const tab of ['leave', 'import', 'settings']) expect(needsToolConsent(tab)).toBe(true)
  })
  it('ツール操作を要求しても、チェックなしでは同意・入力処理を実行しない', () => {
    const f = fixture(); f.gate.request(f.action)
    expect(f.open).toHaveBeenLastCalledWith(true)
    expect(f.action).not.toHaveBeenCalled()
    expect(f.gate.confirm(false)).toBe(false)
    expect(f.accept).not.toHaveBeenCalled()
  })
  it('明示同意後に選択した操作を一度だけ実行する', () => {
    const f = fixture(); f.gate.request(f.action)
    expect(f.gate.confirm(true)).toBe(true)
    expect(f.accept).toHaveBeenCalledTimes(1)
    expect(f.action).toHaveBeenCalledTimes(1)
    expect(f.gate.confirm(true)).toBe(false)
    expect(f.action).toHaveBeenCalledTimes(1)
  })
  it('拒否・閉じる・戻るは保留操作を破棄し、同意として記録しない', () => {
    for (const _reason of ['decline', 'close', 'escape', 'back']) {
      const f = fixture(); f.gate.request(f.action); f.gate.cancel()
      expect(f.open).toHaveBeenLastCalledWith(false)
      expect(f.gate.confirm(true)).toBe(false)
      expect(f.action).not.toHaveBeenCalled()
      expect(f.accept).not.toHaveBeenCalled()
    }
  })
  it('閉じて開き直したら古い操作を実行せず、今回の操作だけを実行する', () => {
    const f = fixture(), next = vi.fn()
    f.gate.request(f.action); f.gate.cancel(); f.gate.request(next); f.gate.confirm(false)
    expect(next).not.toHaveBeenCalled()
    f.gate.confirm(true)
    expect(f.action).not.toHaveBeenCalled(); expect(next).toHaveBeenCalledTimes(1)
  })
  it('連続した開始要求は最初の1件だけを保持する', () => {
    const f = fixture(), next = vi.fn()
    f.gate.request(f.action); f.gate.request(f.action); f.gate.request(next)
    expect(f.open).toHaveBeenCalledTimes(1)
    f.gate.confirm(true)
    expect(f.action).toHaveBeenCalledTimes(1); expect(next).not.toHaveBeenCalled()
  })
  it('すでに同意済みなら再同意を求めず操作を実行する', () => {
    const f = fixture(true); f.gate.request(f.action)
    expect(f.action).toHaveBeenCalledTimes(1)
    expect(f.open).not.toHaveBeenCalled(); expect(f.accept).not.toHaveBeenCalled()
  })
  it('同じ画面で同意した後の別操作は、二度目の同意なしに実行する', () => {
    const f = fixture(), next = vi.fn()
    f.gate.request(f.action); f.gate.confirm(true); f.gate.request(next)
    expect(f.accept).toHaveBeenCalledTimes(1)
    expect(f.action).toHaveBeenCalledTimes(1); expect(next).toHaveBeenCalledTimes(1)
    expect(f.open.mock.calls.filter(([open]) => open)).toHaveLength(1)
  })
  it('同意後の追加操作から編集画面へ進む入れ子の要求も一度だけ実行する', () => {
    const f = fixture(), openEditor = vi.fn()
    const addThenOpen = vi.fn(() => f.gate.request(openEditor))
    f.gate.request(addThenOpen); f.gate.confirm(true)
    expect(f.accept).toHaveBeenCalledTimes(1)
    expect(addThenOpen).toHaveBeenCalledTimes(1); expect(openEditor).toHaveBeenCalledTimes(1)
  })
  it('同意保存中に確認が再入しても、入力処理を二重に呼ばない', () => {
    const f = fixture(), original = f.accept.getMockImplementation()!
    f.accept.mockImplementation(() => { expect(f.gate.confirm(true)).toBe(false); original() })
    f.gate.request(f.action); f.gate.confirm(true)
    expect(f.accept).toHaveBeenCalledTimes(1); expect(f.action).toHaveBeenCalledTimes(1)
  })
  it('同意の保存失敗ではツール操作を実行せず、再確認できる', () => {
    const f = fixture(); f.accept.mockImplementationOnce(() => { throw new Error('quota') })
    f.gate.request(f.action)
    expect(() => f.gate.confirm(true)).toThrow('quota')
    expect(f.action).not.toHaveBeenCalled()
    expect(f.gate.confirm(true)).toBe(true)
    expect(f.action).toHaveBeenCalledTimes(1)
  })
})

describe('保存済みデータと利用開始の互換', () => {
  beforeEach(() => { useStore.setState({ ...makeSample('2026-10-30'), settings: defaultSettings, acceptedAt: null, asOf: '2026-10-30' }) })
  it('同意待ち・取消では既存データと残高・年5日・管理簿を変更しない', () => {
    const before = currentData(), baseline = before.employees.map(e => buildReport(e, before.leaves, before.settings, '2026-10-30'))
    const gate = createToolConsent(() => !!useStore.getState().acceptedAt, () => useStore.getState().accept(), vi.fn())
    gate.request(() => useStore.getState().clearAll()); gate.cancel()
    expect(currentData()).toEqual(before)
    const after = currentData()
    expect(after.employees.map(e => buildReport(e, after.leaves, after.settings, '2026-10-30'))).toEqual(baseline)
    expect(useStore.getState().acceptedAt).toBeNull()
  })
  it('同意確定はacceptedAtだけを足し、保存済み記録を移行・削除しない', () => {
    const before = currentData(), action = vi.fn()
    const gate = createToolConsent(() => !!useStore.getState().acceptedAt, () => useStore.getState().accept(), vi.fn())
    gate.request(action); gate.confirm(true)
    expect(useStore.getState().acceptedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    expect(currentData()).toEqual(before); expect(action).toHaveBeenCalledTimes(1)
  })
})
