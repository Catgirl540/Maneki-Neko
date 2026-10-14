import { build, createServer, type Plugin, type ResolvedConfig, type ViteDevServer } from 'vite'
import { extname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/** 两套页面共用网站入口；工作人员页面仍使用自己的路由、样式和身份。 */
export function unifiedSite(useMock: boolean): Plugin {
  const staffRoot = fileURLToPath(new URL('../staff/', import.meta.url))
  let config: ResolvedConfig
  let staffServer: ViteDevServer | undefined
  const staffBase = () => `${config.base}staff/`
  const staffConfig = () => ({
    root: staffRoot,
    configFile: resolve(staffRoot, 'vite.config.ts'),
    base: staffBase(),
    mode: config.mode,
    define: { 'import.meta.env.VITE_USE_MOCK': JSON.stringify(String(useMock)) },
  })

  return {
    name: 'luckycat-unified-site',
    configResolved(resolved) {
      config = resolved
    },
    async configureServer(server) {
      const parent = server.httpServer
        ?? (typeof server.config.server.middlewareMode === 'object'
          ? server.config.server.middlewareMode.server : undefined)
      if (!parent) throw new Error('统一网站需要一个共享的 HTTP 服务。')
      staffServer = await createServer({
        ...staffConfig(),
        server: {
          middlewareMode: { server: parent },
          // 使用共享 HTTP 服务，避免工作人员热更新另开端口。
          ws: { server: parent, path: '__staff_hmr' },
          proxy: {},
        },
      })
      server.middlewares.use((req, res, next) => {
        const pathname = (req.url ?? '/').split('?')[0]
        if (pathname === staffBase().slice(0, -1)) {
          res.writeHead(302, { location: staffBase() })
          res.end()
          return
        }
        if (pathname.startsWith(staffBase())) {
          staffServer!.middlewares(req, res, next)
          return
        }
        next()
      })
    },
    async closeServer() {
      await staffServer?.close()
      staffServer = undefined
    },
    async closeBundle() {
      if (config.command !== 'build') return
      await build({
        ...staffConfig(),
        build: { outDir: resolve(config.root, config.build.outDir, 'staff'), emptyOutDir: true },
      })
    },
    configurePreviewServer(server) {
      // 预览时让员工深链接回到员工 HTML，而不是客户端 HTML。
      server.middlewares.use((req, _res, next) => {
        const pathname = (req.url ?? '/').split('?')[0]
        const acceptsHtml = !req.headers.accept
          || req.headers.accept.includes('text/html')
          || req.headers.accept.includes('*/*')
        if ((req.method === 'GET' || req.method === 'HEAD')
          && (pathname === staffBase().slice(0, -1) || pathname.startsWith(staffBase()))
          && (!extname(pathname) || pathname.endsWith('.html'))
          && acceptsHtml) {
          req.url = `${staffBase()}index.html`
        }
        next()
      })
    },
  }
}
