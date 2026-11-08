import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { viteSingleFile } from 'vite-plugin-singlefile'

// 单文件构建：dist/index.html 自带全部 JS/CSS，双击即可打开，无需 Node、无需本地服务器。
export default defineConfig({
  base: './',
  plugins: [react(), viteSingleFile()],
  server: { host: '127.0.0.1', port: 5173, strictPort: true },
  build: { assetsInlineLimit: 100 * 1024 * 1024, cssCodeSplit: false },
})
