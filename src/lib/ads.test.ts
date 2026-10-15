import { describe, expect, it } from 'vitest'
import { AD_ITEMS, isSafeAdTag, pickAd, type AdItem } from './ads'

const a8 =
  '<a href="https://px.a8.net/svt/ejp?a8mat=4BA2HE+6QBFZM+20EY+C2102" rel="nofollow">家具350</a>' +
  '<img border="0" width="1" height="1" src="https://www19.a8.net/0.gif?a8mat=4BA2HE+6QBFZM+20EY+C2102" alt="">'
const moshimo =
  '<a href="https://af.moshimo.com/af/c/click?a_id=1&p_id=2&pc_id=3&pl_id=4" rel="nofollow" referrerpolicy="no-referrer-when-downgrade">印刷</a>' +
  '<img src="https://i.moshimo.com/af/i/impression?a_id=1&p_id=2&pc_id=3&pl_id=4" width="1" height="1" style="border:none;" loading="lazy">'

describe('広告タグの安全確認（従業員のデータを守るため、スクリプトを読み込まない）', () => {
  it('A8.net・もしものテキスト広告は通す', () => {
    expect(isSafeAdTag(a8)).toBe(true)
    expect(isSafeAdTag(moshimo)).toBe(true)
  })
  it('もしものバナー広告（画像。プロトコル省略の // 形式）も通す', () => {
    const banner =
      '<a href="//af.moshimo.com/af/c/click?a_id=1&p_id=2&pc_id=3&pl_id=4" rel="nofollow" referrerpolicy="no-referrer-when-downgrade" attributionsrc>' +
      '<img src="//image.moshimo.com/af-img/5044/000000096899.png" width="728" height="91" style="border:none;"></a>' +
      '<img src="//i.moshimo.com/af/i/impression?a_id=1&p_id=2&pc_id=3&pl_id=4" width="1" height="1" style="border:none;" loading="lazy">'
    expect(isSafeAdTag(banner)).toBe(true)
    expect(isSafeAdTag(banner.replace('//image.moshimo.com', '//images.example.com'))).toBe(false)
    expect(isSafeAdTag(banner.replace('//af.moshimo.com', '//evil.example.com'))).toBe(false)
    expect(isSafeAdTag(banner.replace('//af.moshimo.com', 'http://af.moshimo.com'))).toBe(false)
  })
  it('script・iframe・イベント属性・ほかのドメインは弾く', () => {
    expect(isSafeAdTag(a8 + '<script src="https://statics.a8.net/a8sales/a8sales.js"></script>')).toBe(false)
    expect(isSafeAdTag('<iframe src="https://px.a8.net/x"></iframe>')).toBe(false)
    expect(isSafeAdTag('<a href="https://px.a8.net/x" onclick="alert(1)">x</a>')).toBe(false)
    expect(isSafeAdTag('<a href="https://example.com/x">x</a>')).toBe(false)
    expect(isSafeAdTag('<a href="https://px.a8.net/x">x</a><img src="https://tracker.example.com/p.gif">')).toBe(false)
    expect(isSafeAdTag('<a href="javascript:alert(1)">x</a>')).toBe(false)
  })
  it('登録した広告はすべて安全なタグ', () => {
    for (const a of AD_ITEMS) expect(isSafeAdTag(a.tag), a.id).toBe(true)
  })
  it('枠に合う広告だけを選ぶ。安全でないタグは選ばない', () => {
    const items: AdItem[] = [
      { id: 'bad', heading: '', lead: '', tag: '<script></script>', slots: ['home'] },
      { id: 'ok', heading: '', lead: '', tag: a8, slots: ['home'] },
    ]
    expect(pickAd('home', items)?.id).toBe('ok')
    expect(pickAd('guide', items)).toBeNull()
  })
})
