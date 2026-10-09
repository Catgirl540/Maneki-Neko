import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { fileURLToPath, URL } from 'node:url'

// 前后端分离：前端只通过 /api 访问后端。
// 开发期由 VITE_USE_MOCK 决定走本地 mock 还是真后端，
// 后端就绪后把 VITE_API_BASE_URL 指过去即可，业务代码零改动。
//
// /agent-api 是**另一条通道**：本地 agent 演示服务（framework/bridge/demo-server.mjs）。
// 它独立于银行后端；HTTP 网页只启用已声明接入账户服务的助手。
export default defineConfig(({ mode }) => {
  const appRoot = fileURLToPath(new URL('.', import.meta.url))
  const env = loadEnv(mode, appRoot, 'VITE_')
  const useMock = (process.env.VITE_USE_MOCK ?? env.VITE_USE_MOCK) === 'true'
  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@/api/runtime': fileURLToPath(new URL(useMock ? './src/api/mock/backend.ts' : './src/api/runtime.ts', import.meta.url)),
        '@': fileURLToPath(new URL('./src', import.meta.url)),
      },
    },
    server: {
      port: 5180,
      proxy: {
        '/agent-api': {
          target: process.env.VITE_AGENT_TARGET ?? env.VITE_AGENT_TARGET ?? 'http://127.0.0.1:8788',
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
          target: process.env.VITE_PROXY_TARGET ?? env.VITE_PROXY_TARGET ?? 'http://127.0.0.1:8080',
          changeOrigin: true,
        },
      },
    },
  }
})
