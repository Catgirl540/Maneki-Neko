# DSH 钉版本与漂移台账

本框架把底座当**依赖**用，不修改上游源码。这里记录确切版本、组合行 ID 与升级流程。
2026-10-19 从 `0.1.6-alpha.2` 升级到上游最新发布的候选版 `0.2.1-rc.2`。

## 1. 钉死版本

| 组件 | 版本 | 说明 |
|---|---|---|
| `@deepseek-ai/dsh`、SDK 与银行插件的 DSH peer | **0.2.1-rc.2** | CLI、SDK、插件清单和锁文件精确一致，不使用 `^` 或 `--legacy-peer-deps` |
| `@deepseek-ai/cordis` | 4.0.5 | 与新底座一致的插件框架 |
| `@xmanrui/dsh-im` | 5.1.0 | Bridge 内复用微信/企微运行时；[IM 接入与验证](../../docs/api/im-agent.md)，升级前验证 Controller/Runtime/Harness 适配契约 |
| `@deepseek-ai/schemastery` | 3.18.5 | 与新底座一致的配置 schema |
| `typescript` | ^6.0.3 | 与上游一致（**上游是 `^6.0.3`**，别装 7.x） |
| `@types/node` | ^22.20.3 | Node 22 |
| 上游发布 | `dsh-v0.2.1-rc.2` | [发布说明](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.2.1-rc.2)；只读 `reference/` 仍是旧版历史依据，不代表当前运行时 |
| 基础 bundle | `@deepseek-ai/dsh-sdk-minimal` | 不叠 `dsh-base` 的完整显式树；[客户 profile 快照](snapshots/luckycat-0.2.1-rc.2.yml)中路径已规范化 |

Node 要求 `^22.19.0 || >=24`；本机 v22.22.1。

## 2. 我们依赖的行 id（改名 = 破坏性）

`dsh.profile.bundles` 里的行由 `@deepseek-ai/dsh-sdk-minimal` 提供。
我们按 `id` 覆盖或禁用，**这些 id 就是我们的对外契约**：

| 行 id | 我们的操作 | 用途 |
|---|---|---|
| `sandbox-policy` | 覆盖 `config.mode` → `read-only` | 钉死沙箱（出厂是 `danger-full-access`） |
| `approval` | **insert**（sdk-minimal 原本没有） | `policy: ask`；无 answerer 时 fail-closed → deny |
| `persistent-bash` | `disabled: true` | 框架无 shell |
| `persistent-pwsh` | `disabled: true` | 框架无 shell |
| `terminal-bash` | `disabled: true` | 框架无 shell |
| `terminal-pwsh` | `disabled: true` | 框架无 shell |
| `pty` | `disabled: true` | 框架无 shell |
| `mcp-resources` | `disabled: true` | 不挂 MCP |
| `jobs` | `disabled: true` | 不挂后台任务 |
| `luckycat-hello` | **bundle 插入**（本文件不配置） | 冒烟工具 |
| `llm-deepseek` | `disabled: true` | 换成多供应商适配器；同时断掉官方 API 的数据回传链路 |
| `llm-pi-ai` | **insert** | 多供应商：OpenRouter（云端）+ 本机 llama.cpp（备用）。换模型只改配置 |
| `system-prompt` | 覆盖整行 `config` | 人设换成业务口径（`LUCKYCAT_SYSTEM_PROMPT` 可替换）；注意按 id 覆盖会替换整个 config，字段要写全 |
| `luckycat-embedding` | **bundle 插入** + 本文件配置路由 | 向量服务 `ctx.embedding`——DSH **没有** embedding 通道，这是自研包 |
| `luckycat-rag` | **bundle 插入** + 本文件配置语料/预算 | 知识库检索：`knowledge_lookup` 工具 + 有界注入；语料绝对路径由 bootstrap 替换 |
| `luckycat-hardening` | **bundle 插入** + 本文件配置白名单/脱敏变量 | 加固：工具结果脱敏（`tools/post-execute`）+ 工具白名单单调守卫（`ctx.tools.guard`）+ 可选遥测脱敏 |
| `token-meter` | 使用 sdk-minimal 原生行 | `ctx.tokenMeter`：从会话日志确定性估算 token/上下文压力，不发模型调用 |
| `session-checkpoint-policy` | **insert**（补课，抄 dsh-base） | 每次模型请求/顶层分发前的持久化检查点 |
| `tool-result-pruner` | **insert**（补课，抄 dsh-base 配置） | 压力达标时裁超大工具输出（原始结果仍在日志里） |
| `compaction-basic` | 使用 sdk-minimal 原生行 | 长对话压缩；**硬依赖 `tokenMeter`**，不重复插入 |
| `filesystem` | 禁用原生本地提供者，插入 `fs-sandbox` | 保留按调用执行的文件沙箱围栏，避免同一服务同时挂两个提供者 |
| `tool-working-directory` | 禁用 | 客户、客服及运维均不新增模型切换主机目录的工具 |
| `tool-fs` / `attachment-local` | 复用原生行 | 客户文件工具继续由原有白名单拒绝；客服禁用文件工具但保留内联图片；运维显式启用文件工具并经既有审批 |

### 我们自己的 bundle（P4）

`装哪些插件` 与 `怎么配置` 是两层：前者由下面的 bundle 决定（`dsh plugin add/remove` 维护），
后者由 `profiles/luckycat/cordis.patch.yml` 按行 id 覆盖。

| bundle | 包名 | 插入的行 |
|---|---|---|
| hello | `@luckycat/dsh-hello` | `luckycat-hello` |
| embedding | `@luckycat/dsh-embedding` | `luckycat-embedding` |
| rag | `@luckycat/dsh-rag` | `luckycat-rag` |
| hardening | `@luckycat/dsh-hardening` | `luckycat-hardening` |

注意：**装插件 = 执行代码**，且 DSH 明确写了它 "executes in-process outside the
workspace sandbox"（见 [P4-PACKAGING.md](P4-PACKAGING.md) §4）——所以这是特权操作。

### 已验证可用的模型（2026-09-17 实测）

| 模型 id | 结果 |
|---|---|
| `qwen/qwen3.8-flash`（付费档） | ✅ **当前默认**；$0.15/$0.47 每 M；100 万上下文；**`e2e-consent.sh` 全过 23 项**，工具调用与参数均正确 |
| `inclusionai/ling-3.0-flash`（付费档） | ❌ **实测不能用**：和 fin 一样反问用户、不调工具（`e2e-consent.sh` 用例 1 失败）。裸测会调工具，只有真实应用里才暴露 |
| `inclusionai/ling-3.0-flash-fin`（付费档） | ❌ **实测不能用**：在真实应用里（10 个工具）把整段思维链写进**给用户看的正文**、然后 `finish: stop`、**一次工具都不调**，`e2e-consent.sh` 用例 1 直接失败。裸测（两三个工具）反而会调——所以"单测过了"不等于能用 |
| `inclusionai/ling-3.0-flash-vl`（付费档） | ⚠️ 也能用，但**实测持续 429** `engine_overloaded`（DeepInfra，连续 7 次全失败）。付费**不等于**脱离共享池，见下 |
| `inclusionai/ling-3.0-flash-vl:free` | ⚠️ 3.2s 可用，但上游是共享池（Novita）：并发几个请求就 429。不要拿来跑密集的自动化检查 |
| `nvidia/nemotron-3.5-lightning:free` | ✅ 15.1s |
| `nvidia/nemotron-3-ultra-550b-a55b:free` | ❌ 上游过载（免费档），保留在配置里但不作默认 |

### 已验证可用的向量路由（2026-09-17 实测）

| 路由 | 模型 | 维度 | 结果 |
|---|---|---|---|
| `openrouter` | `baai/bge-m3`（付费档） | **1024** | ✅ 默认路由。2026-09-20 换掉了原来的免费档（共享池），依据是语料上的实测，见 `P1b-EMBEDDING.md` |
| `openrouter` | `nvidia/llama-nemotron-embed-vl-1b-v2:free` | 2048 | ⚠️ 已不作默认：同样的共享池限流问题，且实测检索比 bge-m3 差一条 |
| `relayrouter` | `text-embedding-3-small` | **1536** | ✅ 其 baseURL **必须自带 `/v1`**（本机 `RELAYROUTER_BASE_URL` 不含版本段） |

**刻意不挂** `@deepseek-ai/dsh-permission-presets`：

1. 它 `inject: ['shell']`，而本框架删掉了全部 shell 行 → 会永久 pending
   （首次尖刺实测：`permission … pending (waiting for service: shell)`）；
2. 它自带 `danger-full-access` preset（sandbox 全权 + approval `never`），
   等于把一个安全翻转开关留在树里。我们直接钉 `sandbox-policy` + `approval`。

## 3. 升级流程（不允许跳步）

1. 同步修改根清单与 `packages/*/package.json` 中 CLI、SDK 和 DSH peer 的精确版本；
2. 更新锁文件并正常安装，执行 `npm run check:dsh`、`bash scripts/link-local.sh`、`bash scripts/build.sh` 和 `bash scripts/bootstrap.sh`，再跑 `bash scripts/verify.sh`；
3. 若 V2 失败，对照 `--dump-config` diff 找出改名/消失的行 id；
4. 记录版本、日期、行 id 变动与新结论到本文件；
5. 快照 `--dump-config` 输出入库以便下次 diff。

### 2026-10-19 兼容适配

- 新版工具结果是 `role: tool` 的平铺消息，`toolCallId`、`isError` 在消息本身。桥接层兼容新结构与旧 `tool-result` 嵌套块，保留回执和错误状态。
- 知识库上下文不再使用通用 `plugin` 来源，改为扩展 `MessageSourceMap` 的 `luckycat-rag` 来源，注入预算仍为 2000 字节。
- `sdk-minimal` 新增原生文件、目录、用量、压缩和附件行；去掉重复插入，禁用目录工具。运维沙箱采用禁用旧行再插入新行，避免 `name` 匹配失败后悄悄保留旧配置。
- 版本门检查 CLI、SDK、各插件 peer、安装目录及锁文件。全新 profile 无旧会话日志时，验收正常跳过日志权限检查。
- 技能端到端入口使用独立 PostgreSQL HTTP 与 AI 会话测试库，拒绝非测试库名称；不再依赖 SQLite。

以上为仓库和本地升级记录；公网版本须以部署记录为准。发布需保留旧代码、依赖、profile 与原生日志备份；回滚时整套恢复，不混用不同版本的 SDK 或覆盖客户数据库。

本次验收：全新隔离 profile 的 `verify.sh` 通过（129 个插件用例），PostgreSQL 桥接测试 45 项通过，技能协议夹具 61 条通过。实际 Harness 的转账确认、支付验密、取消、自动重试、SSE、图片、知识检索和重启恢复均通过；客服与运维 profile 注册探针无加载告警；单账户模型门禁通过。协议夹具不代表真实模型的意图识别准确率，本轮未调用外部模型或修改公网数据。

## 4. 已知上游地雷

- `dsh.profile` / `dsh.bundle` 两个扩展清单字段是 **2026-08-06** 才破坏性改名的
  （`62d0f26fd6`）——升级时优先检查这两个字段。
- 90 天内破坏性提交 27 条（refactor/feat 级），行 id 目前稳定但无弃用政策。
- 上游**没有**面向插件作者的 breaking/deprecation 文档。
