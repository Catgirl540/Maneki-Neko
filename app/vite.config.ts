import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { fileURLToPath, URL } from 'node:url'

// 前后端分离：前端只通过 /api 访问后端。
// 开发期由 VITE_USE_MOCK 决定走本地 mock 还是真后端，
// 后端就绪后把 VITE_API_BASE_URL 指过去即可，业务代码零改动。
//
// /agent-api 是**另一条通道**：本地 agent 演示服务（framework/bridge/demo-server.mjs）。
// 它不是银行后端，只负责把网页接到 agent 运行时；不启动它时前端自动回落固定话术。
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    port: 5180,
    proxy: {
      '/agent-api': {
        target: process.env.VITE_AGENT_TARGET ?? 'http://127.0.0.1:8788',
        changeOrigin: true,
        // SSE 必须关掉缓冲，否则事件会被攒着不发。
        configure: (proxy) => {
          proxy.on('proxyRes', (proxyRes) => {
            if (proxyRes.headers['content-type']?.includes('text/event-stream')) {
              proxyRes.headers['x-accel-buffering'] = 'no'
            }
          })
        },
      },
      '/api': {
        target: process.env.VITE_PROXY_TARGET ?? 'http://127.0.0.1:8080',
        changeOrigin: true,
      },
    },
  },
})
