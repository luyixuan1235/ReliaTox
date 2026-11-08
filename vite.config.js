import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// 开发时：npm run dev 起前端（5173），/api 和 /ws 转发给后端（8787）。
export default defineConfig({
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': 'http://127.0.0.1:8787',
      '/ws': { target: 'ws://127.0.0.1:8787', ws: true },
    },
  },
})
