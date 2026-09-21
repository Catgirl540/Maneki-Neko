# 后端对接契约（luckycat agent 运行时）

> 2026-09-17。**背景：银行后端尚未开发，本框架先给出对接面。**
> 这份文档只写"你们需要提供什么 / 我们已提供什么"，不含任何特定语言的实现要求。
>
> 我方对应实现：`dsh --profile luckycat`（钉死 `@deepseek-ai/dsh@0.1.6-alpha.2`）
> + `@luckycat/dsh-*` 四个插件；可运行的参考桥：`bridge/run.mjs`。

## 1. 你们要跑的东西

- 一个 **Node `^22.19.0 || >=24`** 的进程或容器，专门承载 agent 运行时。
  **不要让浏览器直连**（做不到，见 §5）。
- 驱动方式用**官方姿势**：子进程 + stdio 上的换行分隔 JSON-RPC。
  可直接用 `@deepseek-ai/dsh-sdk-client`（`DeepSeekHarness` / `HarnessClient`），
  也可以自己按 §3 的协议发包。**不要 in-process import**（上游明确不支持这条）。
- 启动前准备：
  - `DSH_HOME` → 指向**专用目录**（运行时会在这里建 `sessions/`，文件权限是显式 600/700）；
  - `OPENROUTER_API_KEY`（或 `RELAYROUTER_API_KEY` + `LUCKYCAT_RELAYROUTER_BASE_URL`，后者**必须带 `/v1`**）；
  - 首次部署跑一次 `bash scripts/bootstrap.sh`（生成 profile + 安装插件 bundle）；
    生产环境建议把插件包发到 registry 或打成 tarball 再 `dsh plugin add`。

## 2. 术语（避免沟通错位）

- **step**：一次模型请求 + 它触发的工具调用。
- **turn**：零个或多个 step，从"收到输入"到"不再欠任何东西"。
- 工具调用的**返回值不进会话日志**（上游设计如此）：日志里只有渲染后的文本。

## 3. SDK 协议面（你们要对接的全部）

三个 client→server 请求 + 四个 server→client 通知：

| 方向 | 方法 | 载荷要点 |
|---|---|---|
| → | `initialize` | `{ cwd, provider, model, reasoningEffort?, maxTokens? }`——**`provider`/`model` 是"用哪个模型"的唯一开关**，由你们传 |
| → | `session/prompt` | `{ sessionId, contentBlocks }` → 返回**入队回执** `messageId` |
| → | `shutdown` | 无参数 |
| ← | `session.event` | 每次会话事件（工具调用、助手消息、回合边界都在这里） |
| ← | `session.status` | 整个 agent 的 `running`/`idle` 迁移 |
| ← | `subagent.started` / `subagent.finished` | 本框架未用 |

**易错点**：`session/prompt` 的返回值**不代表回答**。回答要从 `session.event` 流里取，
一轮结束看 `session.status` 变成 `idle`。
另外：`initialize` 会**校验路由**，provider/model 路由不存在时后续 `session/prompt` 会被拒。

## 4. 你们对前端暴露什么（建议形状，非强制）

| 你们的接口 | 作用 |
|---|---|
| `POST /agent/sessions` | 建会话，返回你们的 sessionId |
| `POST /agent/sessions/{id}/messages` | `{ text }` → 入队，返回 202 + 队列回执 |
| `GET /agent/sessions/{id}/stream`（SSE）或 `WS …/{id}` | 转发 `session.event` / `session.status` 的必要子集 |
| `POST /agent/sessions/{id}/abort`（可选） | 取消当前轮 |

- **认证与 TLS 必须你们做**：DSH 的 HTTP 面只有"防 DNS rebinding 的信任栅栏"，
  源码原话是 *"authentication stay out of scope"*，且它的 webserver **不带 TLS**。
  我们不走 DSH 的 web 面，所以这块完全在你们侧。
- **会话映射**：你们的 `userId/sessionId` ↔ agent 的 sessionId 记在你们自己的库里。
  业务数据**不要**塞进 `$DSH_HOME`。

## 5. 明确不要做的

1. **不要把 `$DSH_HOME/sessions/*.jsonl` 当业务数据源解析**：那是 agent 的会话日志，
   格式是版本化且会迁移的（当前 `SESSION_FORMAT_VERSION=3`，代际只增不移），属于运行时内部。
2. **不要让浏览器直连 stdio**；也不要让浏览器直接打 DSH 的 `/api`（无认证、无 TLS）。
3. 不要依赖"工具返回值写在日志里"——它有意不写（见 §2）。

## 6. 审批：一个需要业务决策的限制

- SDK 协议里**没有**审批通道；DSH 里唯一的真实 answerer 是它的 **Web 客户端 UI**。
- 因此**在当前 SDK 形态下，需要人工批准的敏感操作会 fail-closed 直接拒绝**
  （这是安全的设计，但业务上表现为"永远批不了"）。
- 如果业务需要"人工点同意"，两条路：
  1. 我们加一条侧通道（你们后端 ↔ agent 的审批通道）；
  2. 改走 DSH 的 web profile（代价：前端要接它的 UI 契约，且它的 `/api` 无认证需你们前置）。
- 这件事请业务先确认"是否真的需要人工审批"，再决定投哪边。

## 7. 失败语义（建议映射成你们的错误码）

- **上游模型失败**：不会静默重连刷屏，而是记成 `assistant/attempt`，内含
  `finish.reason.kind = "error"` 与上游原文（例如 `"Upstream error from Nvidia:
  Service temporarily overloaded"`）。建议映射成一个可重试的业务错误。
- **本框架自己的失败分类**（向量服务）：`MISSING_CREDENTIAL`、`HTTP_STATUS`、
  `MALFORMED_RESPONSE`、`TIMEOUT`、`ENDPOINT_NOT_ALLOWED`、`EMPTY_INPUT`、
  `UNKNOWN_ROUTE`、`DUPLICATE_ROUTE`。
- **重试策略必须显式 `normal`**：DSH 的 `llm-retry` 有 `always` 模式，那是无限重试，
  而且**每次都计费**。

## 8. 最小自测（你们接完可以先跑这个）

1. 起进程 → `initialize({ cwd, provider: 'openrouter', model: 'qwen/qwen3.8-flash' })`
2. `session/prompt({ sessionId, contentBlocks: [{ type: 'text', text: '转账手续费怎么收？单笔最高收多少？' }] })`
3. 在 `session.event` 流里应当看到：一次 `knowledge_lookup` 工具调用，
   以及带出处（`kb-fee#0` / `kb-fee#1`）的回答，内容是"千分之一、单笔上限 50 元"。

我方等价脚本：`scripts/e2e-bank.sh`（可直接当参考实现读，断言全部查会话日志而非肉眼）。