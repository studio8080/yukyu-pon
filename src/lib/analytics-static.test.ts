import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import { describe, expect, it } from 'vitest'

const code = readFileSync(new URL('../../public/analytics.js', import.meta.url), 'utf8')

function fixture(options: { path?: string; optedOut?: boolean; dnt?: boolean } = {}) {
  const listeners: Array<(event: unknown) => void> = []
  const dataLayer: unknown[][] = []
  const path = options.path || '/pricing.html'
  const context: Record<string, unknown> = {
    location: { hostname: 'yukyu.kokokikaku.com', origin: 'https://yukyu.kokokikaku.com', pathname: path },
    navigator: options.dnt ? { doNotTrack: '1' } : {}, URL,
    localStorage: { getItem: (key: string) => { expect(key).toBe('yukyuponAnalyticsOptOut'); return options.optedOut ? '1' : null }, setItem: () => undefined },
    document: {
      title: '料金プラン｜有休ポン', referrer: 'https://example.com/private?name=secret', cookie: '',
      getElementById: () => null,
      addEventListener: (name: string, fn: (event: unknown) => void) => { expect(name).toBe('click'); listeners.push(fn) },
      createElement: () => ({}), head: { appendChild: () => undefined }
    }, dataLayer
  }
  context.window = context
  vm.createContext(context)
  vm.runInContext(code, context)
  const click = (plan: string, cycle: string) => {
    const attrs: Record<string, string> = { 'data-revenue-plan': plan, 'data-revenue-cycle': cycle }
    const link = { getAttribute: (name: string) => attrs[name] }
    const event = { target: { closest: (selector: string) => { expect(selector).toBe('a[data-revenue-plan][data-revenue-cycle]'); return link } } }
    listeners.forEach(fn => fn(event))
  }
  return { dataLayer, listeners, click }
}

describe('静的ページの収益計測', () => {
  it('料金ページの固定プランと支払周期だけを送る', () => {
    const f = fixture(); f.click('pro', 'monthly'); f.click('business', 'yearly')
    const events = f.dataLayer.filter(item => item[0] === 'event' && item[1] === 'revenue_action')
    expect(events).toHaveLength(2)
    expect(events[0][2]).toEqual({ action: 'checkout', placement: 'pricing-card', plan: 'pro', billing_cycle: 'monthly', page_location: 'https://yukyu.kokokikaku.com/pricing.html', page_referrer: '' })
    expect(JSON.stringify(events)).not.toMatch(/buy\.stripe|license|secret/i)
  })

  it('未知の値、料金ページ以外、オプトアウト、DNTでは送らない', () => {
    const unknown = fixture(); unknown.click('private', 'monthly'); unknown.click('pro', 'weekly')
    expect(unknown.dataLayer.filter(item => item[1] === 'revenue_action')).toHaveLength(0)
    expect(fixture({ path: '/privacy.html' }).listeners).toHaveLength(0)
    expect(fixture({ optedOut: true }).listeners).toHaveLength(0)
    expect(fixture({ dnt: true }).listeners).toHaveLength(0)
  })
})
