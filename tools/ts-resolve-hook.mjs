/* ==========================================================================
   Node 侧加载 app 源码用的钩子。

   应用代码是给打包器写的：相对导入不带扩展名、`@/` 指向 src。Node 按 ESM 规则
   两种都解析不了；而这个 Node 构建又没有内置 TS 支持（ERR_NO_TYPESCRIPT），
   所以这里自己做两件事：
     · resolve —— 把 `@/x` 和免扩展名的相对导入补成真实文件路径
     · load    —— 用仓库里已有的 typescript 把 .ts 即时转译成 JS

   用途见 tools/check-card-bin.mjs：有了它，检查工具就能 import 应用里**真正在跑**的
   那个 lookupCardBin，而不是照着源码再抄一遍实现。

   ⚠️ 只做转译、不做类型检查。类型由 `tsc -b` 负责，这里只求能把模块跑起来。
   ========================================================================== */

import { registerHooks } from 'node:module'
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import ts from '../app/node_modules/typescript/lib/typescript.js'

const SRC = new URL('../app/src/', import.meta.url)

const TS_EXT = /\.tsx?$/

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith('@/')) {
      for (const suffix of ['.ts', '.tsx', '/index.ts']) {
        const url = new URL(specifier.slice(2) + suffix, SRC)
        if (existsSync(fileURLToPath(url))) return { url: url.href, shortCircuit: true }
      }
    }
    if (specifier.startsWith('.') && !TS_EXT.test(specifier)) {
      const parent = context.parentURL
      if (parent) {
        const base = new URL(specifier, parent).href
        for (const suffix of ['.ts', '.tsx', '/index.ts']) {
          const url = new URL(base + suffix)
          if (existsSync(fileURLToPath(url))) return { url: url.href, shortCircuit: true }
        }
      }
    }
    return nextResolve(specifier, context)
  },

  load(url, context, nextLoad) {
    if (!TS_EXT.test(new URL(url).pathname)) return nextLoad(url, context)
    const source = readFileSync(fileURLToPath(url), 'utf8')
    const { outputText } = ts.transpileModule(source, {
      fileName: fileURLToPath(url),
      compilerOptions: {
        module: ts.ModuleKind.ESNext,
        target: ts.ScriptTarget.ES2022,
        jsx: ts.JsxEmit.ReactJSX,
        // 单文件转译认不出「这个导入只是类型」，所以源码里必须用 `import type`
        verbatimModuleSyntax: false,
      },
    })
    return { format: 'module', source: outputText, shortCircuit: true }
  },
})
