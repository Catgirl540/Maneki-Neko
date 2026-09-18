# P0 尖刺报告：DSH 底座可行性

> 2026-09-17。目的：在投入 P1–P5 之前，用最小代价证明
> 「不改内核、增删插件」这条路真的走得通。**结论：通过。**

## 1. 结论

| 判据 | 结果 | 证据 |
|---|---|---|
| boot 成功 | ✅ | `dsh --profile luckycat` exit 0，**stderr 全空**（零 "did not activate"） |
| `--dump-config` 出现我们的行 | ✅ | 163 行、**零告警**；`mode: read-only`、`policy: ask`、`luckycat-hello` 在树中 |
| 被删的行确实消失 | ✅ | 7 条行 id 全部 `disabled: true`；`danger-full-access` 全文 0 命中 |
| 插件真的注册了工具 | ✅ | 注册表探针：`tools=1`、`luckycat_ping=REGISTERED` |
| **零内核改动** | ✅ | `reference/` 工作树干净；运行中的源码仓只有它本来就有的 `?? tools/`；用户 `~/.dsh` 未被污染 |
| 工具面收敛 | ✅ | 工具面**恰好 1 个**（我们自己的），无 shell / coding 工具 |

复现：

```sh
cd framework
npm install
bash scripts/build.sh hello probe
bash scripts/bootstrap.sh
bash scripts/verify.sh
```

## 2. 尖刺过程中发现的硬事实

### F1 npm 装的 dsh **不能加载 `.ts` 插件**（必须是编译产物）

`@deepseek-ai/dsh` 的依赖里没有 `tsx`（只有 commander / js-yaml /
node-addon-require-builtin 等），而官方教程那条「插 `.ts` 绝对路径」明确要求
**源码态运行**（`pnpm dsh`，走 tsx 的 ESM hook）。
→ 我们的插件一律 `tsc` 编译到 `lib/`，补丁里插 `lib/index.js`。

### F2 loader **并发**激活条目，不能依赖插入顺序

失败堆栈里出现 `at async Promise.allSettled (index 34)`。
第一版探针在 `apply` 里当场读 `ctx.tools.schemas()`，读到 `tools=0`——
**不是工具没注册，是探针抢跑**。改成 `ctx.effect` 里排一个延迟读取后才拿到真值。
→ 任何"后插入的插件去读前一个插件的注册"都必须延迟，或改用事件。

### F3 补丁匹配不到任何行时**只 warn 不报错**

`vendor/include/src/index.ts` 的 `applyEntryPatches` JSDoc 原文：
*"A patch that matches nothing warns and is skipped."*
→ 所以 `disabled: true` 的效果**必须断言**，否则上游把行改名后我们会静默失去收敛
（`verify.sh` 的 V2 就干这个：逐条检查 `disabled: true` 且断言 dump 无告警）。

### F4 删行有依赖约束，而且删对了

首次组合时 DSH 报：
`dsh: warning: 1 entry did not activate` /
`permission (@deepseek-ai/dsh-permission-presets): pending (waiting for service: shell)`。
`permission-presets` 需要 `ctx.shell`，而我们把 shell 行全删了。
反思后决定**不挂它**（而不是把 shell 加回来）：

1. 它自带 `danger-full-access` preset（sandbox 全权 + approval `never`）；
2. 我们本来就**直接钉** `sandbox-policy.mode = read-only` + `approval.policy = ask`，
   预设层是多余的间接。

删掉后：**dump 告警归零、boot 无 pending、`danger-full-access` 从树里彻底消失**
——安全性是**变好**了，不只是变简单了。

### F5 `DSH_HOME` 泄漏事故（我的错误，已修 + 已加闸）

第一版 `bootstrap.sh` 写的是 `DSH_HOME="${DSH_HOME:-$ROOT/.dsh-home}"`。
但**当前 DSH 会话本身已经导出了 `DSH_HOME=~/.dsh`**，于是默认值被环境值吃掉，
脚本把 profile 写进了**用户的真实 `~/.dsh`**。

处置：立即删除只属于我的 `~/.dsh/profiles/luckycat`（3 个文件），
确认 `~/.dsh/profiles/` 恢复为 `headless node_modules web`、用户 web profile 完好；
并把 `scripts/_home.sh` 改成硬闸：

- 只认专属变量 `LUCKYCAT_DSH_HOME`（不读环境里的 `DSH_HOME`）；
- 解析结果**必须落在仓库根目录内**，否则拒绝执行（fail closed）；
- 最后**显式覆盖** `export DSH_HOME`，不让环境残留渗进子进程。

`verify.sh` 的 V1 现在每次都断言 `~/.dsh/profiles/luckycat` 不存在。

### F6 绝对路径会被规范化成百分号编码的 `file://` URL

路径含中文（`文档/招财猫Bank`），dump 里显示为
`file:///home/bigguga/%E6%96%87%E6%A1%A3/.../packages/hello/lib/index.js`。
**加载正常**（本轮 boot 与探针都验证过），但做字符串断言时要注意这点。

### F7 TypeScript 要用 6.x，且 `types: ["node"]` 必须显式写

上游钉的是 `typescript: ^6.0.3`（不是 7.x），`@types/node: ^22.20.0`。
TS 6 不再自动纳入 `@types/node`，用 node 内置模块的插件必须在 tsconfig 里写
`"types": ["node"]`，否则报 `TS2591 Cannot find name 'node:fs'`。

### F8 SDK 握手看不到工具面，所以需要注册表探针

`InitializeResult` 只有 `serverInfo`（`packages/sdk/protocol/src/types.ts:30-33`），
而 loader 的激活日志开关在 launcher 创建的 root include 上、没有 CLI 开关（不改内核就设不了）。
→ 用 `packages/probe`（**只通过 `--patch` 挂载，不进生产树**）读
`ctx.tools.schemas()` / `ctx.tools.get(name)` 拿直接证据。
这条自检会长期保留，是「插件真的挂上了」的唯一正面证据来源。

### F9 工具面 = 1

探针报 `tools=1`，即整棵 luckycat 树里**只有我们自己的工具**。
这正是目标形态（对照 codex fork 侧费力把工具面 9→1）。

## 3. 尚未验证（留给后续阶段）

- `sdk-minimal` + 我们的行集**长期运行**（本阶段只验了启动与注册，没跑真实对话）。
- 真实模型调用（需要给 luckycat 树加 `llm-pi-ai` 路由行；sdk-minimal 默认只有 `llm-deepseek`）。
- 检索/embedding/RAG（P1–P2）、脱敏与守卫（P3）、增删门 V3（P4）、后端桥（P5）。
- 压缩是否会吃掉经 `additionalContexts` 注入的历史内容。