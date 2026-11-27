import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import { describe, expect, it } from 'vitest'

const code = readFileSync(new URL('../../public/analytics.js', import.meta.url), 'utf8')

function fixture(options: { path?: string; optedOut?: boolean; dnt?: boolean; gpc?: boolean } = {}) {
  const listeners: Array<(event: unknown) => void> = []
  const dataLayer: unknown[][] = []
  const path = options.path || '/pricing.html'
  const context: Record<string, unknown> = {
    location: { hostname: 'yukyu.kokokikaku.com', origin: 'https://yukyu.kokokikaku.com', pathname: path },
    navigator: { doNotTrack: options.dnt ? '1' : undefined, globalPrivacyControl: options.gpc }, URL,
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
  const dispatch = (selectorExpected: string, attrs: Record<string, string>, defaultPrevented = false) => {
    const link = { getAttribute: (name: string) => attrs[name] }
    const event = { defaultPrevented, target: { closest: (selector: string) => { expect(selector).toBe(selectorExpected); return link } } }
    listeners.forEach(fn => fn(event))
  }
  const click = (plan: string, cycle: string) => dispatch('a[data-revenue-plan][data-revenue-cycle]', { 'data-revenue-plan': plan, 'data-revenue-cycle': cycle })
  const clickArticle = (destination: string, canceled = false) => dispatch('a[data-attendance-cta]', { 'data-attendance-cta': destination }, canceled)
  return { dataLayer, listeners, click, clickArticle }
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

  it('出勤率の記事では指定リンクの選択だけを個別に数え、申込に合算しない', () => {
    const path = '/articles/attendance-80.html'
    const f = fixture({ path })
    f.clickArticle('tool')
    f.clickArticle('pricing')
    f.clickArticle('unknown')
    f.clickArticle('pricing', true)
    const actions = f.dataLayer.filter(item => item[0] === 'event' && item[1] !== 'page_view')
    const page = { page_location: `https://yukyu.kokokikaku.com${path}`, page_referrer: '' }
    expect(actions.map(item => Object.values(item))).toEqual([
      ['event', 'yukyu_open_tool', page], ['event', 'yukyu_open_pricing', page]
    ])
    expect(fixture({ path, gpc: true }).listeners).toHaveLength(0)
    expect(fixture({ path: '/articles/ledger.html' }).listeners).toHaveLength(0)
  })
})
