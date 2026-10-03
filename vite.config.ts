import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import type { Plugin } from 'vite'
import { defineConfig } from 'vitest/config'

// 本番ビルドだけ CSP を入れる（開発サーバーはインラインのスクリプトを使うため）。
// connect-src 'none' で、ページから外部への通信をブラウザに禁止させる。
const csp: Plugin = {
  name: 'csp',
  apply: 'build',
  transformIndexHtml: (html) =>
    html.replace(
      '<meta charset="UTF-8" />',
      `<meta charset="UTF-8" />\n    <meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; font-src 'self'; connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'" />`,
    ),
}

export default defineConfig({
  base: './',
  plugins: [react(), tailwindcss(), csp],
  test: { include: ['src/**/*.test.ts'] },
})
