# 招财猫银行 · Agent 运行时对接契约

面向**从没接触过 agent 这一侧**的后端开发者与部署同学。目标是：只读这一份文档，
就能把"银行后端 → agent 运行时"这段接起来，并知道哪些责任**不在**我们这边。

- 是什么：一个跑在服务端的 agent 运行时（基于 DeepSeek 官方开源的 DeepSeek Harness，钉死 `@deepseek-ai/dsh@0.1.6-alpha.2`），
  能力靠插件提供；我们已实现的插件有：第三方模型路由、向量服务、知识库检索工具、加固层。
- 不是什么：它**不是**业务数据的来源，也**不管**认证、TLS、用户体系。它只负责"把问题变成带出处的回答"。
- **源码就在本仓库里**：框架代码在 `framework/`（自 P0 起 9 条提交的完整历史也在这个仓库的历史里）。
  后端同学可以直接读源码；本文仍把协议面写全，方便不读源码也能对接。

事实来源（本文全部结论都出自这几处，没有一条来自"常见做法"）：

- `bridge/run.mjs` —— 桥的最小实现（子进程 + stdio JSON-RPC 驱动 agent 运行时）
- `scripts/e2e-bank.sh` —— 端到端验证脚本，同时是"怎么断言"的参考实现
- `profiles/luckycat/cordis.patch.yml` —— 运行时组合与全部配置（模型路由、语料、白名单）
- `packages/{embedding,rag,hardening,hello}/src/*.ts` —— 四个自研插件
- `design/{BACKEND-CONTRACT,P0-SPIKE,P1a…,SECURITY-FINDINGS-DSH}.md` —— 决策与验证记录
- 上游源码（只读参考）：`reference/deepseek-harness/`，版本 `dsh-v0.1.6-alpha.2`

约定：

- 术语按上游定义：**step** = 一次模型请求 + 它触发的工具调用；**turn** = 零个或多个 step。
- 协议字段名一律照抄上游，不做意译。
- 凡是**需要业务拍板**或**双方需要对齐**的地方，集中在最后一节，不在正文里替谁做决定。

---

## 1. 边界：谁负责什么

| 环节 | 谁负责 |
| --- | --- |
| agent 运行时（模型调用、工具执行、知识库检索、会话日志） | 框架侧（已实现） |
| 跑这个进程、给它密钥、给它专用目录 | 后端侧 |
| 认证、鉴权、TLS、限流 | **后端侧**（见 §5） |
| 用户体系、会话与业务数据的映射 | **后端侧**（见 §6） |
| 对浏览器暴露接口 | **后端侧**（建议形状见 §4） |
| 人工审批"点同意" | **未定**，需业务决策（见 §7） |

## 2. 你们要跑什么

- 一个 **Node `^22.19.0 || >=24`** 的进程或容器，专门承载 agent 运行时。
  **不要让浏览器直连**（协议是 stdio，做不到；见 §4）。
- 驱动方式用官方姿势：**子进程 + stdio 上的换行分隔 JSON-RPC**。
  可用 `@deepseek-ai/dsh-sdk-client`，也可自己按 §3 发包。
  上游明确**不支持** in-process import（`packages/sdk/client/README.md` 原话：
  *"the client spawns the runtime directly rather than through the `dsh-subprocess` service"*）。
- 启动前准备：

| 环境变量 | 作用 | 备注 |
| --- | --- | --- |
| `DSH_HOME` | 运行时的工作目录 | 会在这里建 `sessions/`；文件权限上游显式设为 `600`、目录 `700`（实测，不依赖 umask） |
| `OPENROUTER_API_KEY` | 云端模型与向量化 | 只以**变量名**被引用，密钥不落配置 |
| `RELAYROUTER_API_KEY` + `LUCKYCAT_RELAYROUTER_BASE_URL` | 备用向量路由 | baseURL **必须带 `/v1`**；本机 `~/.zshrc` 里的 `RELAYROUTER_BASE_URL` 不带版本段，直接用会打到错误路径 |

- 首次部署：`bash scripts/bootstrap.sh`（生成 profile + 把插件作为 bundle 装进 profile）。
  生产环境建议把插件包发布到 registry 或打成 tarball，再 `dsh plugin add <spec>`。
- **装插件 = 执行代码**，且上游写明它 *"executes in-process outside the workspace sandbox"*。
  所以这一步是特权操作，必须在受控环境里由授权的人做。

## 3. SDK 协议面（要对接的全部）

三个 client→server 请求 + 四个 server→client 通知：

| 方向 | 方法 | 载荷要点 |
| --- | --- | --- |
| → | `initialize` | `{ cwd, provider, model, reasoningEffort?, maxTokens? }`——**`provider`/`model` 是"用哪个模型"的唯一开关**，由你们传 |
| → | `session/prompt` | `{ sessionId, contentBlocks }` → 返回**入队回执** `messageId` |
| → | `shutdown` | 无参数 |
| ← | `session.event` | 会话事件流（助手消息、工具调用、回合边界都在这里） |
| ← | `session.status` | 整个 agent 的 `running`/`idle` 迁移 |
| ← | `subagent.started` / `subagent.finished` | 本框架未使用 |

**三个易错点**（都是上游行为，不是我们的选择）：

1. `session/prompt` 的返回值**不代表回答**（只是"已入队"）。
   回答要从 `session.event` 里取；**一轮结束**看 `session.status` 变成 `idle`。
2. `initialize` 会**校验路由**：provider/model 组合不存在时，后续 `session/prompt` 会被拒。
3. **工具返回值不进会话日志**（上游原话：*"deliberately omitted from durable events"*），
   日志里只有**渲染后**的文本。所以"从日志断言工具返回了什么"必须把文本块当 JSON 解析回来。

## 4. 你们对前端暴露什么（建议形状，非强制）

| 你们的接口 | 作用 |
| --- | --- |
| `POST /agent/sessions` | 建会话，返回你们的 sessionId |
| `POST /agent/sessions/{id}/messages` | `{ text }` → 入队，返回 202 + 队列回执 |
| `GET /agent/sessions/{id}/stream`（SSE）或 `WS …/{id}` | 转发 `session.event` / `session.status` 的必要子集 |
| `POST /agent/sessions/{id}/abort`（可选） | 取消当前轮 |

前端侧不必知道 agent 的存在，它只跟你们说话；这也让"换模型/换检索源"完全不碰前端。

## 5. 认证与 TLS：完全在你们这边

- 上游 HTTP 面对认证的态度是明写在源码里的：*"authentication stay out of scope"*，
  它只有一道**防 DNS rebinding 的信任栅栏**（`packages/client/connection/src/api-request-trust.ts`），
  而且它的 webserver **不带 TLS**。
- 我们的框架**不走**上游那个 HTTP 面（我们走 stdio），所以认证、鉴权、TLS、限流
  这些都**没有**代理或兜底，是你们的责任，也是你们的自由。

## 6. 会话与数据边界

- 你们的 `userId`/`sessionId` ↔ agent 的 sessionId 映射，记在你们自己的库里。
- **不要把 `$DSH_HOME/sessions/*.jsonl` 当业务数据源解析**：那是 agent 的会话日志，
  格式是版本化的（当前 `SESSION_FORMAT_VERSION=3`，代际只增不移），属于运行时内部。
- **业务数据不要写进 `$DSH_HOME`**。要审计"这轮依据了哪些资料"，
  请走 §9 里的会话事件，而不是直接读文件。

## 7. 人工审批：当前是 fail-closed，需业务决定

- SDK 协议里**没有**审批通道；上游唯一的真实 answerer 是它的 **Web 客户端 UI**
  （`packages/client/ui-approval`）。因此**在当前形态下，需要人工批准的敏感操作一律被拒绝**。
- 这是**安全上正确的行为**（无 answerer → deny），但业务上表现为"永远批不了"。
- 两条路，取决于业务：
  1. 我们加一条**侧通道**（你们后端 ↔ agent 的审批问答）；
  2. 改走上游的 web profile（代价：前端要接它的 UI 契约，且它的 HTTP 面无认证、需你们前置）。
- **请业务先确认"是否真的需要人工点同意"**，再决定投哪边。

## 8. 失败语义与重试

- **上游模型失败不会被静默吞掉**：会记成 `assistant/attempt`，内含
  `finish.reason.kind = "error"` 与上游原文（例：`"Upstream error from Nvidia:
  Service temporarily overloaded"`）。建议映射成可重试的业务错误。
- **本框架自己的失败分类**（向量服务，稳定 code）：`MISSING_CREDENTIAL`、`HTTP_STATUS`、
  `MALFORMED_RESPONSE`、`TIMEOUT`、`ENDPOINT_NOT_ALLOWED`、`EMPTY_INPUT`、
  `UNKNOWN_ROUTE`、`DUPLICATE_ROUTE`。
- **重试必须显式 `normal`**：上游 `llm-retry` 有 `always` 模式——无限重试，而且**每次都计费**。
  我们的路由已显式写 `mode: normal`。
- 检索的降级是**可见的**：向量不可用时会降级成关键词检索，并在工具结果里写明
  `mode: keyword-only` 与 `degradedReason`，不假装是向量结果。

## 9. 最小自测（建议你们接完先跑这个）

1. 起进程 → `initialize({ cwd, provider: 'openrouter', model: 'inclusionai/ling-3.0-flash-vl:free' })`
2. `session/prompt({ sessionId, contentBlocks: [{ type: 'text', text: '转账手续费怎么收？单笔最高收多少？' }] })`
3. 期望在 `session.event` 流里看到：
   - 一次 `knowledge_lookup` 工具调用；
   - 一条注入块（文本里含 `<knowledge_reference>`，且**字节数 ≤ 2000**）；
   - 回答内容包含「千分之一」与「50」，并写出处 `kb-fee#0` / `kb-fee#1`。

我方等价脚本（可直接当参考实现读，断言全部查会话日志、不靠肉眼）：
`scripts/e2e-bank.sh`（问答）、`scripts/e2e-security.sh`（脱敏与白名单）。

## 10. 需要业务或双方决定的事项

1. **人工审批是否需要**（见 §7）——决定要不要建侧通道。
2. **多轮上下文与业务会话的对应**：你们的一个业务会话 = agent 的一个 sessionId？
   还是按"每次咨询一个 session"？（影响日志量、上下文继承、审计口径）
3. **审计口径**：业务侧要留存的"这次回答依据了哪些资料"，
   是从 `session.event` 里取，还是由我们额外提供一份结构化审计记录？
4. **部署形态**：一个共享 agent 进程（多用户复用）还是每用户/每租户一个进程？
   共享时你们的鉴权与会话隔离必须自己兜住。
5. **模型与向量模型的最终选择**：目前默认是免费档（`inclusionai/ling-3.0-flash-vl:free`
   与 `nvidia/llama-nemotron-embed-vl-1b-v2:free`，2048 维）。上生产要换成哪个，
   由业务按效果与成本定；换模型**只改配置**，不涉及代码。
6. **框架与银行的边界**（原"框架仓库是否上云"已落地：源码就在本仓库 `framework/`，
   且 `framework/` 是它的**唯一事实来源**，改动走本仓库提交）。
   剩下要守的约定是：`framework/` 是**通用框架**、`app/` 是银行前端，
   **银行业务规则不要写进 `framework/`**——业务规则进 `app/` 与你们的后端。
   若将来要把框架独立成自己的仓库，可以从本仓库历史里完整拆出去。