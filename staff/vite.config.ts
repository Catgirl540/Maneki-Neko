import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { fileURLToPath, URL } from 'node:url'

// 员工端独立端口 5181（客户端是 5180），两边能同时开。
// /staff-api 是工作人员端专用通道：同一进程 server/index.mjs 上的 staff-api.mjs 处理，
// 与客户端的 /api 分开，员工 token 与客户 token 不混。
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    port: 5181,
    proxy: {
      '/staff-api': {
        target: process.env.VITE_PROXY_TARGET ?? 'http://127.0.0.1:8080',
        changeOrigin: true,
      },
    },
  },
})
