import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

// 他のサイトの中（iframe）に埋め込まれたときは表示しない（クリックジャッキング対策）。
// GitHub Pages ではヘッダー（frame-ancestors / X-Frame-Options）を付けられないため、ここで止める。
function framed(): boolean {
  try {
    return window.top !== window.self
  } catch {
    return true // 別のオリジンの親を読めない＝埋め込まれている
  }
}

const root = document.getElementById('root')!
if (framed()) {
  root.textContent = ''
  const p = document.createElement('p')
  p.textContent = '有休ポンは、ほかのサイトの中では開けません。'
  const a = document.createElement('a')
  a.href = location.href
  a.target = '_top'
  a.rel = 'noopener'
  a.textContent = '有休ポンを直接開く'
  root.append(p, a)
} else {
  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
}
