# P6 · 网页 ↔ agent 的演示服务（不接后端）

## 1. 这一层是什么

`framework/bridge/demo-server.mjs` 是**演示服务**：它把浏览器接到 agent 运行时上。
它**不是**银行后端，也**不该**变成银行后端——它只是"等后端就绪之前，让网页真的能用 agent"
的那一段胶水。

```
浏览器 app/ (Vite :5180)
   │  /agent-api/*          ← Vite dev 代理
   ▼
演示服务 demo-server.mjs (:8788，只用 Node 内置模块)
   │  ① stdio JSON-RPC（官方姿势，复用 bridge/run.mjs 的做法）
   │  ② HTTP 长轮询（把待确认事项送给网页、等用户答复）
   ▼
dsh 子进程（profile luckycat，DSH_HOME=framework/.dsh-home）
```

后端就绪后，把这一层换成后端即可：**agent 侧的接口面不变**
（JSON-RPC 是上游固定的；确认通道是本文 §4 的形状）。

## 2. 面向浏览器的接口

| 方法 | 路径 | 作用 |
| --- | --- | --- |
| GET | `/agent-api/health` | 是否可用 + 当前 provider/model（前端据此决定走真 agent 还是回落固定话术） |
| POST | `/agent-api/sessions` | 建会话 → `{ sessionId }` |
| POST | `/agent-api/sessions/:id/messages` | `{ text }` → 202 + `{ accepted: true }`（**入队回执，不代表回答完成**） |
| GET | `/agent-api/sessions/:id/stream` | SSE 事件流 |
| POST | `/agent-api/consent/:challengeId` | `{ decision, paymentPassword? }` → 校验后放行长轮询 |

SSE 事件的形状（`data:` 一行一个 JSON）：

| type | 载荷 | 界面上的意义 |
| --- | --- | --- |
| `hello` | `{ sessionId }` | 订阅已建立（前端据此确认"订阅早于发言"） |
| `status` | `{ status: 'running' \| 'idle' }` | 转圈 / 停下 |
| `assistant` | `{ text }` | 助手文本 |
| `tool-call` | `{ callId, name, arguments }` | 工具调用轨迹（"执行中…"） |
| `tool-result` | `{ callId, isError, text }` | 工具结果（"已完成 / 未执行" + 一行摘要） |
| `consent` | `{ challenge }` | **待确认卡片**（展示交易信息 + 身份验证输入） |
| `consent-resolved` | `{ challengeId, decision }` | 卡片收起（`approve`/`reject`/`timeout`/`abandoned`） |
| `consent-asked` / `consent-decided` | 审计用 | 语言无关的审计轨迹 |
| `error` | `{ message }` | 运行失败（含上游模型失败） |

## 3. 为什么工具结果是占位

本阶段明确"不接后端"，所以 `@luckycat/dsh-bank-demo` 的所有工具都返回**占位数据**：

- 每条结果带 `demo: true` 与「【演示占位数据】」声明；
- 回执号统一 `LCB-DEMO-` 前缀；
- 演示数据文件里**根本没有**完整卡号 / CVV / 支付密码字段（有一条单测专门扫这个）；
- 卡密工具返回 `0000 0000 0000 0000` 这种不可能被误认成真值的占位。

理由：银行场景里，"返回编造的数据"比"功能没做"更糟——模型会把它当事实告诉客户。

## 4. 确认通道的形状（后端要实现的就这一段）

agent 侧（`@luckycat/dsh-consent`）向配置的 `channelUrl` 发一个 **POST，然后挂住**，
直到用户在网页上作答；响应体就是答复。这就是"长轮询"。

请求体（挑战）：

```json
{
  "challengeId": "8f0c…",          // 随机 nonce，防重放
  "sessionId": "web-…",
  "callId": "call_…",
  "toolName": "bank_transfer",
  "kind": "转账",
  "fields": [{ "label": "收款人", "value": "梁乐怡" }, { "label": "转账金额", "value": "800.00 CNY", "emphasis": true }],
  "verification": "payment-password",
  "consequence": "确认并验证支付密码后立即扣款，不可撤销。",
  "createdAt": 1789820911160,
  "expiresAt": 1789820931160
}
```

响应体（答复）：

```json
{ "decision": "approve", "challengeId": "8f0c…",
  "verification": { "method": "payment-password", "verified": true, "ticket": "pw-…" } }
```

要点：

- **`challengeId` 必须原样回传**，对不上按拒绝处理（防"旧答复重放给新操作"）。
- 需要验证的操作必须给 `verified: true` 且 `method` 与挑战一致，否则拒绝。
- `ticket` 只是审计标识，**不得**是密码或验证码本身。
- 只要不是明确的批准，一律拒绝：超时、连不上、返回看不懂，都是拒绝。
- 通道地址的传输安全由插件把关：`https` 任意，明文 `http` 只允许本机回环。

## 5. 本机怎么跑起来

```bash
# 终端 1：agent 演示服务（需要 OPENROUTER_API_KEY）
cd framework
node bridge/demo-server.mjs          # 监听 127.0.0.1:8788

# 终端 2：前端
cd app
npm run dev                          # http://localhost:5180
```

打开 http://localhost:5180 → 登录（任意 11 位手机号 + 密码 `123456`）→ 智能客服。

演示服务不在时，页面自动回落到原来的**固定话术**，并在右上角标明「演示话术（未连接 agent）」。
所以纯静态部署（bank.waveflow.cn）不受影响。

可用环境变量：

| 变量 | 默认 | 作用 |
| --- | --- | --- |
| `LUCKYCAT_DEMO_PORT` | 8788 | 监听端口（只绑 127.0.0.1） |
| `LUCKYCAT_PROVIDER` / `LUCKYCAT_MODEL` | `openrouter` / `inclusionai/ling-3.0-flash-vl:free` | 模型路由 |
| `LUCKYCAT_DEMO_PASSWORD` | `123456` | 演示用支付密码 |
| `LUCKYCAT_DEMO_TOKEN` | 空 | 设了以后所有请求都要带 `x-luckycat-token` |
| `LUCKYCAT_PATCHES` | 空 | 额外 profile overlay（自检用） |

## 6. 已验证 / 未验证

**已验证**：`framework/scripts/e2e-consent.sh`（6 个用例，含"确认前不执行""取消不执行"
"密码错不执行""超时不执行""密码不进日志""只答复一次"）；
`tools/check-agent.mjs`（14 条浏览器断言，含卡片上的收款人/金额/尾号、错误密码被拒、
正确密码后出现回执号、只读查询不要求密码）。

**未验证**：并发多用户、SSE 在弱网下的重连语义、演示服务的限流与鉴权强度
（它默认只绑本机回环；对外暴露必须由后端加认证，见
`design/backend-handoff/AGENT-RUNTIME-CONTRACT.md` §5）。
