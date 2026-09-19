/**
 * 前后端契约的一致性检查（纯静态，不需要浏览器）。
 *
 * 为什么需要它
 * ------------
 * 这个项目「切一个环境变量后端就接上」的卖点，全靠 `contract.ts` 那张 `routes` 表
 * 与 `BankApi` 接口面**始终准确**。但契约面此前没有任何机器校验，于是同一类漂移
 * 反复出现：README 漏了 6 条路由、`routes.card` 是个没人用的死键、
 * mock 整个文件不引用 `routes`、`demoCode` 这种 mock 专属字段混进必填契约、
 * 以及 `code === 'LCB'` 这种裸比较（行别代码两地会撞号，必须成对查）。
 *
 * 人工审查一次只能抓到当下这一次；把不变量固化成检查才能在下一轮接住。
 *
 *   node tools/check-contract.mjs
 */
import { readFile } from 'node:fs/promises'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '..')
const read = (p) => readFile(path.join(ROOT, p), 'utf8')

const contract = await read('app/src/api/contract.ts')
const http = await read('app/src/api/http.ts')
const mock = await read('app/src/api/mock/index.ts')
const readme = await read('README.md')

let failures = 0
const report = (ok, title, lines = []) => {
  if (!ok) failures += 1
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${title}`)
  for (const line of lines) console.log(`      ${line}`)
}

/* ------------------------------------------------ 抽取四份清单 */

/**
 * routes 表里的键名与它生成的真实路径。
 *
 * 注意两种写法都要收：无参数的路径用的是**单引号**（`login: () => '/api/auth/login'`），
 * 只有带 `$ {}` 插值的才用反引号 —— 第一版只匹配反引号，47 个键只抽到 14 个，
 * 于是下面的比对全是假绿。
 */
const routeEntries = [
  ...contract.matchAll(/^\s{2}(\w+):\s*\([^)]*\)\s*=>\s*(?:'([^']*)'|`([^`]*)`)/gm),
].map((m) => ({ key: m[1], path: m[2] ?? m[3] ?? '' }))

/** 路径归一：`$ {id}` 与 `:id` 是同一个东西；查询串不参与比对 */
const normPath = (p) =>
  p
    .replace(/\$\{[^}]*\}/g, ':p')
    .replace(/:[A-Za-z_][\w]*/g, ':p')
    .split('?')[0]
const routeKeys = new Set(routeEntries.map((r) => r.key))

/** BankApi 接口里的方法名 */
const apiStart = contract.indexOf('export interface BankApi')
// 接口到第一个顶格的 `}` 结束。切到文件尾会把后面的声明一起扫进来 ——
// 第一版就这么混进了一个 `constructor`，数量变成 47 对不上 46。
const apiBlock = contract.slice(apiStart, contract.indexOf('\n}', apiStart))
const apiMethods = new Set(
  [...apiBlock.matchAll(/^\s{2}(\w+)\(/gm)].map((m) => m[1]),
)

/** createHttpApi 的对象字面量方法名 */
const httpMethods = new Set(
  [...http.matchAll(/^\s{4}(\w+):\s*\(/gm)].map((m) => m[1]),
)

/** createMockApi 的对象字面量方法名（都是 async xxx( ) */
const mockMethods = new Set(
  [...mock.matchAll(/^\s{4}async (\w+)\(/gm)].map((m) => m[1]),
)

const diff = (a, b) => [...a].filter((x) => !b.has(x))

report(
  routeKeys.size > 0 && apiMethods.size > 0,
  '① 四份清单都抽到了（检查本身没瞎）',
  [
    `routes ${routeKeys.size} · BankApi ${apiMethods.size} · http ${httpMethods.size} · mock ${mockMethods.size}`,
  ],
)

/* ------------------------------------------------ ② 四方一一对应 */
const missingInHttp = diff(apiMethods, httpMethods)
const extraInHttp = diff(httpMethods, apiMethods)
const missingInMock = diff(apiMethods, mockMethods)
const extraInMock = diff(mockMethods, apiMethods)
report(
  missingInHttp.length === 0 &&
    extraInHttp.length === 0 &&
    missingInMock.length === 0 &&
    extraInMock.length === 0,
  '② BankApi ↔ createHttpApi ↔ createMockApi 方法集合完全相同',
  [
    missingInHttp.length ? `http 缺：${missingInHttp.join('、')}` : '',
    extraInHttp.length ? `http 多：${extraInHttp.join('、')}` : '',
    missingInMock.length ? `mock 缺：${missingInMock.join('、')}` : '',
    extraInMock.length ? `mock 多：${extraInMock.join('、')}` : '',
  ].filter(Boolean).length
    ? [
        missingInHttp.length ? `http 缺：${missingInHttp.join('、')}` : '',
        extraInHttp.length ? `http 多：${extraInHttp.join('、')}` : '',
        missingInMock.length ? `mock 缺：${missingInMock.join('、')}` : '',
        extraInMock.length ? `mock 多：${extraInMock.join('、')}` : '',
      ].filter(Boolean)
    : ['三处完全一致'],
)

/* ------------------------------------------------ ③ 没有死路由键
   死键 = 路由表里定义了，但没有任何实现引用它。它会让人以为"这个接口已经有了"。 */
const deadRoutes = routeEntries
  .filter((r) => !new RegExp(`routes\\.${r.key}\\b`).test(http) && !new RegExp(`routes\\.${r.key}\\b`).test(mock))
  .map((r) => `routes.${r.key}（${r.path}）`)
report(deadRoutes.length === 0, '③ routes 里没有无人引用的死键', [
  deadRoutes.length ? `死键：${deadRoutes.join('、')}` : `${routeEntries.length} 个键都被引用`,
])

/* ------------------------------------------------ ④ README 的接口清单与实际一致 */
const readmeBlock = readme.slice(readme.indexOf('已定义的接口面：'))
// 只取接口清单那一个代码块：README 后面还有别的代码块，扫全文会把示例路径也算进来
const codeBlockEnd = readmeBlock.indexOf('```', readmeBlock.indexOf('```') + 3)
const readmeList = new Set(
  [...readmeBlock
    .slice(0, codeBlockEnd > 0 ? codeBlockEnd : undefined)
    .matchAll(/^(?:GET|POST|PATCH|PUT|DELETE)\s+(\S+)/gm)].map((m) => normPath(m[1])),
)
const actualPaths = new Set(routeEntries.map((r) => normPath(r.path)))
const notDocumented = [...actualPaths].filter((p) => !readmeList.has(p))
const notImplemented = [...readmeList].filter((p) => !actualPaths.has(p))
report(
  notDocumented.length === 0 && notImplemented.length === 0,
  '④ README 的接口清单与 routes 表一致',
  [
    `README 列了 ${readmeList.size} 条，routes 有 ${actualPaths.size} 条`,
    notDocumented.length ? `README 漏了：${notDocumented.join('、')}` : '',
    notImplemented.length ? `README 多写了：${notImplemented.join('、')}` : '',
  ].filter(Boolean),
)

/* ------------------------------------------------ ⑤ 不许裸比较银行代码
   两地的 3 位清算代码相互独立、会撞号（完整码表里 307/308/309/316 两地都有机构在用），
   所以定位一家银行必须 (region, code) 成对查。裸比较是真实踩过的坑。 */
const bareCode = []
for (const [file, src] of [
  ['app/src/pages/CardsPage.tsx', await read('app/src/pages/CardsPage.tsx')],
  ['app/src/pages/TransferPage.tsx', await read('app/src/pages/TransferPage.tsx')],
  ['app/src/api/mock/index.ts', mock],
]) {
  for (const m of src.matchAll(/\.code\s*===\s*'([A-Za-z0-9]+)'/g)) {
    bareCode.push(`${file}: .code === '${m[1]}'`)
  }
}
report(bareCode.length === 0, '⑤ 没有裸比较银行代码（必须 (region, code) 成对查）', [
  bareCode.length ? bareCode.join('；') : '未发现 .code === 字面量',
])

/* ------------------------------------------------ ⑥ agent 通道：前端与文档一致

agent 是**另一条通道**，不进 BankApi（它是给银行后端的契约）。
但它同样容易漂移：改了 app/src/api/agent.ts 的路径却忘了改文档，
下一个人就照着旧文档去实现后端。这里把"前端实际调用的路径"与
"P6-WEB-BRIDGE 里写给后端看的路径表"钉在一起。 */
const agentClient = await read('app/src/api/agent.ts')
const agentDoc = await read('framework/design/P6-WEB-BRIDGE.md')

/** 归一：`${...}` 与 `:id` 是同一个东西。 */
const normAgentPath = (p) => p.replace(/\$\{[^}]*\}/g, ':p').replace(/:[A-Za-z_][\w]*/g, ':p')

/** 前端实际调用的路径（只取真正发起请求的那两个调用点）。 */
const clientPaths = new Set([
  ...[...agentClient.matchAll(/requestJson(?:<[^>]*>)?\(\s*[`'"]([^`'"]+)[`'"]/g)].map((m) => normAgentPath(m[1])),
  ...[...agentClient.matchAll(/EventSource\(\s*`\$\{AGENT_BASE\}([^`]+)`/g)].map((m) => normAgentPath(m[1])),
])

/** 文档里写给后端看的路径表（去掉演示服务的 /agent-api 前缀）。 */
const docPaths = new Set(
  [...agentDoc.matchAll(/^\|\s*(?:GET|POST)\s*\|\s*`([^`]+)`/gm)]
    .map((m) => normAgentPath(m[1].replace(/^\/agent-api/, ''))),
)

const pathsOnlyInClient = [...clientPaths].filter((p) => !docPaths.has(p))
const pathsOnlyInDoc = [...docPaths].filter((p) => !clientPaths.has(p))
report(
  clientPaths.size >= 4 && docPaths.size >= 4 && pathsOnlyInClient.length === 0 && pathsOnlyInDoc.length === 0,
  '⑥ agent 通道：前端调用的路径与 P6-WEB-BRIDGE 的路径表一致',
  [
    `前端 ${clientPaths.size} 条 · 文档 ${docPaths.size} 条`,
    pathsOnlyInClient.length ? `前端有、文档没有：${pathsOnlyInClient.join('、')}` : '',
    pathsOnlyInDoc.length ? `文档有、前端没有：${pathsOnlyInDoc.join('、')}` : '',
  ].filter(Boolean),
)

console.log(failures === 0 ? '\n全部通过 ✅' : `\n${failures} 项未通过 ❌`)
process.exit(failures === 0 ? 0 : 1)
