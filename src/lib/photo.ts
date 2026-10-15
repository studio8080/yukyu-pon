// 従業員の顔写真（任意）。ブラウザの中で小さな JPEG に縮めて data URL で持つ。外部には送らない。
// localStorage は5MB ほどしかないので、96px 四方・画質0.75（1枚おおむね3〜6KB）に抑える。

export const PHOTO_SIZE = 96
/** data URL の上限（文字数）。これを超えるものはバックアップから読み込まない */
export const PHOTO_MAX_CHARS = 40_000

const PHOTO_RE = /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$/

/** 外から来た値（バックアップ）を写真として使ってよいか。形と大きさだけを見る */
export function sanitizePhoto(v: unknown): string | null {
  if (typeof v !== 'string' || v.length > PHOTO_MAX_CHARS || !PHOTO_RE.test(v)) return null
  return v
}

/** 選んだ画像ファイルを、中央で正方形に切り抜いて 96px の JPEG にする */
export async function makePhoto(file: File): Promise<string> {
  if (!file.type.startsWith('image/')) throw new Error('画像ファイル（JPEG・PNG など）を選んでください。')
  if (file.size > 15 * 1024 * 1024) throw new Error('画像が大きすぎます（15MBまで）。')
  const url = URL.createObjectURL(file)
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image()
      i.onload = () => resolve(i)
      i.onerror = () => reject(new Error('画像を読み込めませんでした。別の画像を選んでください。'))
      i.src = url
    })
    const side = Math.min(img.naturalWidth, img.naturalHeight)
    if (!side) throw new Error('画像を読み込めませんでした。')
    const canvas = document.createElement('canvas')
    canvas.width = PHOTO_SIZE
    canvas.height = PHOTO_SIZE
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('この端末では画像を縮小できませんでした。')
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, PHOTO_SIZE, PHOTO_SIZE)
    ctx.drawImage(img, (img.naturalWidth - side) / 2, (img.naturalHeight - side) / 2, side, side, 0, 0, PHOTO_SIZE, PHOTO_SIZE)
    const data = canvas.toDataURL('image/jpeg', 0.75)
    if (!sanitizePhoto(data)) throw new Error('画像を縮小できませんでした。')
    return data
  } finally {
    URL.revokeObjectURL(url)
  }
}
