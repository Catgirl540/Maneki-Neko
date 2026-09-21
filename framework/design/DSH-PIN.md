# DSH 钉版本与漂移台账

本框架把底座当**依赖**用，不当源码用。上游是 0.1.x alpha、约 182 提交/天，
所以这里记下我们依赖的确切版本、行 id 清单与升级流程。

## 1. 钉死版本

| 组件 | 版本 | 说明 |
|---|---|---|
| `@deepseek-ai/dsh` | **0.1.6-alpha.2** | 底座 CLI + 运行时，`package.json` 里精确钉死不写 `^` |
| `@deepseek-ai/cordis` | 4.0.2 | 插件框架（上游 vendored 并 rescope 的 RC 版） |
| `@deepseek-ai/schemastery` | 3.18.2 | 配置 schema |
| `typescript` | ^6.0.3 | 与上游一致（**上游是 `^6.0.3`**，别装 7.x） |
| `@types/node` | ^22.20.3 | Node 22 |
| 上游源码快照 | `ddefc45fbc` / `dsh-v0.1.6-alpha.2` | `reference/deepseek-harness`，只读 |
| 基础 bundle | `@deepseek-ai/dsh-sdk-minimal` | 唯一不叠 `dsh-base` 的完整显式树（158 行） |

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
| `token-meter` | **insert**（补课，抄 dsh-base） | `ctx.tokenMeter`：从会话日志确定性估算 token/上下文压力，不发模型调用 |
| `session-checkpoint-policy` | **insert**（补课，抄 dsh-base） | 每次模型请求/顶层分发前的持久化检查点 |
| `tool-result-pruner` | **insert**（补课，抄 dsh-base 配置） | 压力达标时裁超大工具输出（原始结果仍在日志里） |
| `compaction-basic` | **insert**（补课，抄 dsh-base） | 长对话压缩；**硬依赖 `tokenMeter`**，必须与 `token-meter` 一起挂 |

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

1. 改 `package.json` 里 `@deepseek-ai/dsh` 的精确版本；
2. `npm install` 后跑 `bash scripts/verify.sh`；
3. 若 V2 失败，对照 `--dump-config` diff 找出改名/消失的行 id；
4. 记录版本、日期、行 id 变动与新结论到本文件；
5. 快照 `--dump-config` 输出入库以便下次 diff。

## 4. 已知上游地雷

- `dsh.profile` / `dsh.bundle` 两个扩展清单字段是 **2026-08-06** 才破坏性改名的
  （`62d0f26fd6`）——升级时优先检查这两个字段。
- 90 天内破坏性提交 27 条（refactor/feat 级），行 id 目前稳定但无弃用政策。
- 上游**没有**面向插件作者的 breaking/deprecation 文档。