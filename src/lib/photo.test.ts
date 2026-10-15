import { describe, expect, it } from 'vitest'
import { PHOTO_MAX_CHARS, sanitizePhoto } from './photo'

describe('従業員の写真（バックアップから読むときの確認）', () => {
  it('小さな JPEG・PNG・WebP の data URL は通す', () => {
    expect(sanitizePhoto('data:image/jpeg;base64,/9j/4AAQSkZJRg==')).toBe('data:image/jpeg;base64,/9j/4AAQSkZJRg==')
    expect(sanitizePhoto('data:image/png;base64,iVBORw0KGgo=')).not.toBeNull()
    expect(sanitizePhoto('data:image/webp;base64,UklGRg==')).not.toBeNull()
  })
  it('画像以外・外部の URL・SVG・大きすぎるものは読まない', () => {
    expect(sanitizePhoto('https://example.com/a.jpg')).toBeNull()
    expect(sanitizePhoto('data:image/svg+xml;base64,PHN2Zz4=')).toBeNull()
    expect(sanitizePhoto('data:text/html;base64,PGgxPg==')).toBeNull()
    expect(sanitizePhoto('data:image/jpeg;base64,' + 'A'.repeat(PHOTO_MAX_CHARS))).toBeNull()
    expect(sanitizePhoto(123)).toBeNull()
    expect(sanitizePhoto(undefined)).toBeNull()
  })
})
