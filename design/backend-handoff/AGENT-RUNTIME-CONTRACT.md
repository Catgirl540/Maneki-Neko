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

## 4. 你们对前端暴露什么

业务已经拍板：**涉及交易与敏感信息查看时，必须先展示交易信息、用户确认、身份验证，才允许执行**。
这要求前端能收到"待确认事项"并回传答复，所以接口形状比早期版本多一条确认通道。

| 你们的接口 | 作用 |
| --- | --- |
| `POST /agent/sessions` | 建会话，返回你们的 sessionId |
| `GET /agent/sessions/{id}` | **只读**查询这段会话还在不在（见下） |
| `POST /agent/sessions/{id}/messages` | `{ text }` → 入队，返回 202 + 队列回执 |
| `GET /agent/sessions/{id}/stream`（SSE）或 `WS …/{id}` | 事件流（见下表） |
| `POST /agent/consent/{challengeId}` | 用户对一次待确认事项的答复（**含支付密码**） |
| `POST /agent/sessions/{id}/abort`（可选） | 取消当前轮 |

事件流的形状见 `framework/design/P6-WEB-BRIDGE.md` §2。要点：`consent` 事件携带
待确认事项（交易信息 + 需要的验证方式），前端渲染成确认卡片。

### `GET /agent/sessions/{id}` 的形状

前端把历史对话存在浏览器本地，刷新之后会拿着旧的 sessionId 回来问一句。
这个接口回答"助手还记不记得这段对话"：

```json
{ "sessionId": "…", "known": true, "started": true, "busy": false }
```

- `known`：服务端还认得这个 id。
- `started`：**真的往运行时递过提示词**。只有它为真，助手才记得这段对话——
  "建过"不等于"跑过"。前端只认这一个字段。
- `busy`：正在回答。

**这个查询必须是只读的**：顺手把会话建出来的话，每个历史对话都会被答成"还在"，
"助手已经不记得了"这条提示永远不会出现，前端就会让用户对着一整段完整的记录
等一个答非所问的回复而看不出原因。参考实现与断言见
`framework/design/P7-SESSIONS.md`。

返回 `started:false` 时前端不会去"恢复"上下文，而是**新开一段**并在界面上说清楚。
如果你们要做真正的上下文恢复，请另开一个明确的接口（例如
`GET /agent/sessions/{id}/transcript`），不要把这个只读探测变成有副作用的调用。

**本地已经有一份可跑的参考实现**：`framework/bridge/demo-server.mjs`（演示服务，不接业务后端）
+ `app/src/api/agent.ts`（前端客户端）。后端就绪后按同一形状实现即可，前端只需要改
`VITE_AGENT_URL`，组件不用动。

## 5. 认证与 TLS：完全在你们这边

- 上游 HTTP 面对认证的态度是明写在源码里的：*"authentication stay out of scope"*，
  它只有一道**防 DNS rebinding 的信任栅栏**（`packages/client/connection/src/api-request-trust.ts`），
  而且它的 webserver **不带 TLS**。
- 我们的框架**不走**上游那个 HTTP 面（我们走 stdio），所以认证、鉴权、TLS、限流
  这些都**没有**代理或兜底，是你们的责任，也是你们的自由。
- 特别注意**确认通道**：它承载"用户的真实意思表示"，也就是**放行资金操作的凭据**。
  演示服务只绑 `127.0.0.1` 且默认可选口令；你们实现时必须要求已认证的用户身份，
  不能只靠 challengeId 就对得上。

## 6. 会话与数据边界

- 你们的 `userId`/`sessionId` ↔ agent 的 sessionId 映射，记在你们自己的库里。
- **不要把 `$DSH_HOME/sessions/*.jsonl` 当业务数据源解析**：那是 agent 的会话日志，
  格式是版本化的（当前 `SESSION_FORMAT_VERSION=3`，代际只增不移），属于运行时内部。
- **业务数据不要写进 `$DSH_HOME`**。要审计"这轮依据了哪些资料"，
  请走 §9 里的会话事件，而不是直接读文件。

## 7. 人工审批：已实现（展示 → 确认 → 验身份 → 才执行）

业务已拍板**需要**人工确认，框架侧已落地（`framework/design/P5-CONSENT.md`）。
对接要点：

- **机制在内核层**：工具执行前 `tools/pre-execute` 返回 `ask`，DSH 随即去问审批服务；
  **没有答复者时一律拒绝**，批准是一次性的（`allowed-once`）。所以"漏一次确认就放行"
  在内核层不存在，不是靠提示词或工具 schema 约束的。
- **你们要实现的是"确认通道"**：agent 侧会向一个 HTTP 地址发 POST 并**挂住**，
  等你们把用户在网页/App 上的答复作为响应体返回。请求/响应的完整 JSON 形状见
  `framework/design/P6-WEB-BRIDGE.md` §4。
- **支付密码不进 agent**：网页把密码交给**你们**校验；回到 agent 的只有
  `{ method, verified: true, ticket }` 这个结论。e2e 有一条断言专门盯"密码不得出现在会话日志里"。
- **`challengeId` 必须原样回传**：它同时是防重放的 nonce。对不上、超时、连不上、
  返回看不懂——全部按拒绝处理。
- **审计**：会话日志里会自动留下成对的 `approval/asked`（含展示给用户的信息）与
  `approval/decided`（含结果）。这是只读审计记录，模型看不到。
- **身份验证方式**：框架声明支持 `payment-password` / `sms` / `face`，
  具体实现（短信网关、人脸核身）在你们这边。演示服务只实现了支付密码，
  遇到另外两种会明确返回 501 并**拒绝**，不会静默放行。


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
`scripts/e2e-bank.sh`（问答）、`scripts/e2e-security.sh`（脱敏与白名单）、
`framework/scripts/e2e-consent.sh`（敏感操作：展示 → 确认 → 验身份 → 才执行）。

## 10. 需要业务或双方决定的事项

1. ~~**人工审批是否需要**~~ —— **已拍板：需要**。框架侧已实现，见 §7 与
   `framework/design/P5-CONSENT.md`；你们要实现的是确认通道（形状见
   `framework/design/P6-WEB-BRIDGE.md` §4）。
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
   **银行业务规则不要写进 `framework/` 的通用层**。
   当前唯一的例外是 `framework/packages/bank-demo/`：它是**示例消费者**（占位数据 +
   确认规则表），包名与说明都写明了这一点；真实业务规则应搬进后端自建的同类插件。
7. **身份验证方式**：演示只实现了支付密码；短信验证码与人脸核身需要你们接
   （框架已声明这两种方式；演示服务遇到它们会返回 501 并拒绝，不会静默放行）。
   若将来要把框架独立成自己的仓库，可以从本仓库历史里完整拆出去
   （`framework/` 是 git subtree，history 齐全）。
