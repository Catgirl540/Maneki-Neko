# 招财猫银行 · Agent 运行时对接契约

面向**从没接触过 agent 这一侧**的后端开发者与部署同学。目标是：只读这一份文档，
就能把"银行后端 → agent 运行时"这段接起来，并知道哪些责任**不在**我们这边。

- 是什么：一个跑在服务端的 agent 运行时（基于 DeepSeek 官方开源的 DeepSeek Harness，钉死 `@deepseek-ai/dsh@0.1.6-alpha.2`），
  能力靠插件提供；我们已实现的插件有：第三方模型路由、向量服务、知识库检索工具、加固层、
  **敏感操作闸门**（`consent`，业务那条"先展示、再确认、验身份、才执行"就落在它上面）。
- 不是什么：它**不是**业务数据的来源，也**不管**认证、TLS、用户体系。它只负责"把问题变成带出处的回答"。
- **源码就在本仓库里**：框架代码在 `framework/`（自 P0 起 9 条提交的完整历史也在这个仓库的历史里）。
  后端同学可以直接读源码；本文仍把协议面写全，方便不读源码也能对接。

事实来源（本文全部结论都出自这几处，没有一条来自"常见做法"）：

- `framework/bridge/run.mjs` —— 桥的最小实现（子进程 + stdio JSON-RPC 驱动 agent 运行时）
- `framework/bridge/demo-server.mjs` —— **面向浏览器的参考实现**（HTTP + SSE + 确认通道）
- `framework/scripts/e2e-bank.sh`、`framework/scripts/e2e-security.sh`、
  `framework/scripts/e2e-consent.sh` —— 端到端验证脚本，同时是"怎么断言"的参考实现
- `framework/profiles/luckycat/cordis.patch.yml` —— 运行时组合与全部配置（模型路由、语料、白名单）
- `framework/packages/{embedding,rag,hardening,consent,hello}/src/*.ts` —— 五个自研插件
- `framework/packages/tool-fs/` —— **只带补丁、不带代码**的 bundle：
  把官方的 `read` 等文件工具挂进树里（细节见 `framework/design/P10-IMAGE.md` §2）
- `framework/packages/ask/` —— 「问用户」的**答复者**：官方有工具与服务，
  但答复者只有 DSH 自带 Web GUI 里那一份，我们的银行网页要自己写
  （细节见 `framework/design/P12-ASK.md`）
- `framework/packages/bank-demo/` —— **示例消费者**（占位数据 + 确认规则表），不是通用层
- `framework/design/P0-SPIKE.md` ~ `framework/design/P12-ASK.md`、
  `framework/design/BACKEND-CONTRACT.md`、`framework/design/SECURITY-FINDINGS-DSH.md`
  —— 决策与验证记录
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
| 人工审批"点同意" | 框架侧已实现机制，**后端侧实现确认通道**（见 §7） |
| 历史对话列表存哪 | **当前在浏览器本地**，上生产需你们接管（见 §6） |

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
| `POST /agent/sessions/{id}/messages` | `{ text, image?, accountId? }` → 入队，返回 202 + 队列回执（见下） |
| `GET /agent/sessions/{id}/stream`（SSE）或 `WS …/{id}` | 事件流（见下表） |
| `POST /agent/consent/{challengeId}` | 用户对一次待确认事项的答复（**含支付密码**） |
| `POST /agent/asr` | 录音 → 文字（**音频不落盘**） |
| `POST /agent/tts` | 文字 → 音频（回**原始字节**，不是 JSON） |
| `POST /agent/sessions/{id}/abort`（可选） | 取消当前轮 |

事件流的形状见 `framework/design/P6-WEB-BRIDGE.md` §2。要点：`consent` 事件携带
待确认事项（交易信息 + 需要的验证方式），前端渲染成确认卡片。

### 带图消息：`POST /agent/sessions/{id}/messages`

用户在客服页可以直接发截图（账单、转账凭据、报错画面）。请求体：

```json
{
  "text": "这张账单里收了我多少手续费？",
  "image": { "data": "<base64，不带 data: 前缀>", "mimeType": "image/jpeg" },
  "accountId": "u_0001"
}
```

- `image` 选填；**文字和图片都空**要拒（400）。
- `mimeType` 只认 `image/png | image/jpeg | image/webp | image/gif`，别的回 **415**
  并在 `accepted` 里列出认得的类型（不要让调用方猜）。
- 单张 base64 上限 **6MB**，超了回 **413**。
- 带了 `image` 就必须给 `accountId`，否则回 **400**。它是**登录账户的 id**
  （前端从登录态取，见 `APP-INTEGRATION` 一节），服务端拿它决定图片归档到哪个目录。

**图片必须真的进模型上下文，不能只给模型一个文件路径。** 这是实现上最容易走偏的一步：
看起来"把路径告诉模型、让它自己去读"更省事，但模型拿到的会是二进制乱码——
读图的工具和读文本的工具**不是同一个**。所以图片是以**内联内容块**递进运行时的：

```js
blocks = [{ type: 'text', text }, { type: 'image', data, mimeType }]
```

代价是运行时那边必须有 **attachment store**（`ctx.attachments`）在位，
否则内联块会被直接拒掉（`SDK image prompt requires an attachment store`）。
参考实现见 `framework/design/P10-IMAGE.md`。

**归档**：图片同时落盘到 `<DSH_HOME>/uploads/<accountId>/<sha256 前 16 位>.<ext>`
（目录 `0700`、文件 `0600`），文件名取内容哈希，所以同一张图重复发不会堆副本。
`accountId` 走**白名单**校验（`^[A-Za-z0-9_-]{1,64}$`），不匹配就 400——
账户标识会变成路径的一段，绝不能直接拼进路径。

**上生产时你们要决定的**：图片存在哪、留多久、谁有权取、用户能不能要求删除。
演示实现只是把它放在本地目录里，**没有任何保留期与访问控制**。

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

**前端为什么需要它、历史对话现在存在哪、上生产要你们接管什么**，见 §6。

### 语音：`POST /agent/asr` 与 `POST /agent/tts`

前端是**按住说话**的一轮交互（不是全双工）。形状照
`framework/design/P8-VOICE.md`，要点四条：

1. **密钥只能在你们这边**。浏览器只跟你们说话；OpenRouter 的 key 绝不进前端。
   参考实现（`framework/bridge/demo-server.mjs`）就是这么做的。
2. **音频不落盘、不留存**。银行场景里录音是敏感数据，参考实现只在内存里过一道。
   转录出来的**文字**才进会话（那是"用户说了什么"，本来就该在）。
3. **`/tts` 回原始音频字节**，不是 JSON。我们踩过：拿 `.json()` 去解二进制会得到
   一段乱码错误，而且**响应状态还是 200**。前端要能拿到能解码的音频。
4. **`/asr` 的请求体上限要单独放宽**。通用的 256KB 会在录音稍长时直接拒掉
   （60 秒 Opus ≈ 0.5MB，base64 之后还要再涨三分之一）。参考实现用 12MB。

我们实测过、你们实现时要注意的三件事：

- **格式名完全不存在时上游 400，但写错成另一个存在的名字它照样正确转录**
  （按容器内容嗅探）。所以**别靠结果去判断格式名对不对**——参考实现选择
  "不认识的 MIME 一律 415"，理由是这条路上一旦出问题就是静默的。
- **音频格式要按浏览器给的 MIME 映射**（Opus/webm 是 Chrome 系列，
  Safari 给 `audio/mp4`）。前端会把完整 MIME（含 codecs）发给你们。
- **录音上限 60 秒**：转录端点有约 60 秒的处理上限，超了整段失败。
  参考实现把上限也放进 `health`，前端据此在录音端就卡住。

`POST /agent/asr` 请求 `{ audio: <裸 base64>, mimeType, language? }` →
`{ text, seconds?, cost? }`（裸 base64：不带 `data:` 前缀。实测上游其实容忍前缀，
但接口文档写的是裸的，别依赖未写明的宽容行为）。

`POST /agent/tts` 请求 `{ text, voice? }` → `audio/mpeg` 字节。
按字数计费，参考实现截到 600 字并用 `x-luckycat-truncated: 1` 标明截断了。

### 模型问用户：`POST /agent/questions`（长轮询）与 `POST /agent/questions/{id}/answer`

模型缺信息时（转账金额、收款人、附言……）会调 `ask_user_question` 弹一张卡片。
这条链和确认通道**同一个形状**（POST 挂住 → 前端推卡片 → 用户答 → 原路返回）：

```json
POST /agent/questions
{ "sessionId": "…", "questions": [
  { "id": "amount", "question": "这笔转账的金额是多少？", "header": "金额",
    "options": [{ "label": "500 元以内", "description": "小额周转" }], "multiSelect": false },
  { "id": "memo", "question": "附言写什么？" }
] }
```

挂住，直到用户在卡片上答完，回：

```json
{ "answers": [
  { "id": "amount", "selected": ["500 元以内"] },
  { "id": "memo", "selected": [], "custom": "房租" }
] }
```

字段说明：

| 字段 | 说明 |
| --- | --- |
| `multiSelect` | 缺省 `false`（单选）。`true` 时用户可勾多个，`selected` 就是数组 |
| `options` | 选填。**没有选项就是一道纯输入题** |
| `custom` | 用户自己写的答案。和 `selected` **可以并存**（选了又补充一句） |
| 上限 | 一次最多 10 道题、每题最多 20 个选项、自由输入最长 2000 字 |

**校验口径**（两侧都查，不是重复）：

| 位置 | 管什么 |
| --- | --- |
| 你们这边（服务端） | **形状**：`sessionId` 必填、题数上限、答复里的 id 必须问过、单选不能超一个、**每道题都要有实质答复**（选了或写了，纯空白不算） |
| 框架侧（插件） | **语义**：选项必须是给过的、每道题都必须有答复、题目有没有在索要凭据 |

几个必须遵守的行为（都是实测踩出来的）：

1. **超时要回"没答"，不是"用户拒绝"。** 参考实现在插件先放弃 / 超时这两种情况下
   回 `{ "answers": [] }`，插件再据此让模型知道"用户没回答"。
   把超时和拒绝混为一谈，模型会对用户说"您拒绝了"，而用户其实什么都没点。
2. **答复之后要能拿 404。** 插件那边不等了（自身超时、会话取消）之后，
   用户再点提交必须拿到 404，不能回 200 然后什么都不发生。
3. **空白答复不能结算。** 只查"id 问过没有"是不够的：`custom: "   "` 会被当成有效答复，
   问题关闭、模型收到一份什么都没说的答案，而用户以为提交没反应。
   紧接着的正常答复还会因为问题已被消费而拿到 404。

> **安全上你们要自己决定的一件事**：提问卡片是一个**用户会当真的输入框**。
> 只要模型问一句「请把您的支付密码填在这里」，就有一个长得很正规的框在等他把密码打进去。
> 参考实现在框架侧做了代码硬拦（凭据词 + 索要动词 + 无否定 → 拒绝），
> 但那是启发式、只覆盖中文与少量英文。**真实后端应当在你们这边也拦一道**，
> 并且永远不要让凭据走"提问"这条路——身份验证走确认通道（见 §7）。

### 健康检查：`GET /agent/health`

```json
{ "ok": true, "sessions": 0, "voice": { "asr": true, "tts": true, "maxSeconds": 60 } }
```

**这个响应里不许出现模型名、厂商名、语音模型名。**

它是浏览器直接调的，用户在开发者工具里就能看到——界面上"不显示模型名"挡不住这一步，
所以隐藏必须在**源头**做。运维要知道跑的是哪个模型，看服务端启动日志。

`voice` 只描述**有没有能力**（`asr` / `tts` / `maxSeconds`），不描述"用的哪个模型"。
参考实现的 `tools/check-persona.mjs` 把这条钉成了断言：`health` 的**键集合**必须精确等于
`ok,sessions,voice`（多一个键就失败），响应文本里不许出现当时配置的模型 id 与厂商名。

> **只藏界面是不够的，还有一半在助手自己身上。**
> 实测：把界面和 `health` 都清干净之后，直接问一句
> 「你是什么模型？用的是哪家公司的技术？」——模型**照实自报**了
> "我是通义千问（Qwen），由阿里巴巴集团自主研发"。
> 所以人设里必须有一条**明令**：不报出模型与厂商，而且**不许猜**
> （"哪怕你觉得可能是某个模型，那也只是猜测"），并给一句固定的替代回答。
> 这条也是自动断言的（同一个人设检查的 C 段）。

### 语音**绝对不能**用来确认敏感操作

这是业务红线，不是实现细节：**语音只用来发起，绝不用来确认**。
确认卡片必须手点 + 手输支付密码。电视里的声音、放一段录音，都能骗过
"用语音说同意"——而那正是 §7 那道闸门要防的事。

所以：即使前端开了语音模式，`POST /agent/consent/{challengeId}` 也**只能**由
用户的显式点击触发（带支付密码）。不要给语音留任何直通这条接口的路径。

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

### 历史对话列表：现在是浏览器本地的，上生产要你们接管

当前前端**把对话列表与全部聊天内容存在浏览器的 `localStorage`**
（键 `luckycat.agent.sessions.v1`，见 `framework/design/P7-SESSIONS.md`）。
这是"没有后端时唯一诚实的做法"，但它有四个你们必须知道的后果：

1. **只在这台设备上**。换个浏览器、换台机器、清了站点数据，历史就没了。
2. **不加密、可被本机脚本读到**。银行 App 的聊天记录放在这里，在共用设备上是隐私问题。
3. **用户能改**。前端读回来会逐条校验（坏一条丢一条），但"记录本身可被伪造"这件事
   改不掉——所以**本地记录不能当审计依据**。
4. **关掉页面之后到达的回复会丢**。SSE 断了就是断了，演示服务不重放事件。

上生产建议由你们做**两件事**（都不需要改前端组件，只要按同一形状实现接口）：

- **历史对话列表**：加 `GET /agent/sessions?userId=…`（或用你们已有的业务会话列表），
  前端把列表来源从 `localStorage` 换成它。这条要业务拍板——是"每次咨询一段"还是
  "一个业务会话一段"，直接决定列表的粒度，见 §10。
- **断线补齐**：给 `GET /agent/sessions/{id}/transcript` 一个**明确的**真源接口
  （把会话投影成 `user` / `assistant` / `tool-call` / `tool-result` 四类条目，
  形状照 `framework/design/P6-WEB-BRIDGE.md` §2 的 SSE 事件）。
  这样前端刷新后可以拿真源覆盖本地记录，第 4 条自然消失。

**不要**把上面这件事塞进 `GET /agent/sessions/{id}`：那个探测会被前端在每次打开
一段旧对话时调用，必须是**只读**的（理由见 §4）。

### 编辑重发 / 重新生成：**服务端记录退不回去**，这是要你们决定的第二件事

前端已经有这两个动作了（`framework/design/P9-MESSAGE-ACTIONS.md`）。它们的语义是：

1. 把**本地**记录从某条用户消息处截断（那条之后的用户消息、助手回复、工具行一起删掉）；
2. 把那句话**再发一次**——走的还是同一个 `POST /agent/sessions/{id}/messages`，
   **没有新接口**。

所以现在会发生这样的事：**同一句提问在会话日志里出现两次**，而助手那边的上下文
并没有回退——它仍然记得用户已经"删掉"的那几轮。前端把这句话写在了编辑弹框里
（"助手那边的会话记录退不回去"），断言也钉着它，不会悄悄消失。

这对你们的含义，按优先级：

| 选项 | 代价 | 什么时候该选 |
| --- | --- | --- |
| **保持现状**（同一会话里再问一遍） | 上下文不回退，重新生成的结果受原回答影响；日志里有重复提问 | 只要日志如实留痕、且用户看得到这句提示 |
| 真回退：新开一段会话，把截断前的历史**重放**进去 | 一次重发要 N 个请求、N 次计费；重放里可能再次触发确认流程 | 业务要求"重新生成必须是一次干净的重新提问" |
| 真回退：agent 侧支持"截断到第 N 条" | 要动运行时（当前会话日志是只增的，`SESSION_FORMAT_VERSION=3`），且审计语义要重新定义 | 不建议——会牵动审计与合规口径 |

**建议**：先保持现状并在你们的审计口径里把"同一会话内重复提问"记为正常现象；
要真回退就走第二项（新会话 + 重放），它对运行时零改动。

无论选哪项，有一条不能变：**被截断的是本地记录，不是审计日志**。
用户点"编辑"不等于"删掉曾经发生过的事"，审计必须留痕。

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

1. 起进程 → `initialize({ cwd, provider: 'openrouter', model: 'qwen/qwen3.8-flash' })`
2. `session/prompt({ sessionId, contentBlocks: [{ type: 'text', text: '转账手续费怎么收？单笔最高收多少？' }] })`
3. 期望在 `session.event` 流里看到：
   - 一次 `knowledge_lookup` 工具调用；
   - 一条注入块（文本里含 `<knowledge_reference>`，且**字节数 ≤ 2000**）；
   - 回答内容包含「千分之一」与「50」，并写出处 `kb-fee#0` / `kb-fee#1`。

我方等价脚本（可直接当参考实现读，断言全部查会话日志、不靠肉眼）：
`framework/scripts/e2e-bank.sh`（问答）、`framework/scripts/e2e-security.sh`（脱敏与白名单）、
`framework/scripts/e2e-consent.sh`（敏感操作：展示 → 确认 → 验身份 → 才执行；
外加用例 7 专门盯 §4 那个只读探测的语义与**只读性**）。

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
5. **模型与向量模型的最终选择**：chat 侧现在是 **`qwen/qwen3.8-flash`**
   （付费档，$0.15/M 输入、$0.47/M 输出，100 万上下文）。
   选它的过程留下了三条对你们有用的结论：

   - **免费档不能用来跑密集的自动化**：`:free` 走第三方共享池（Novita），
     并发几个请求就 `429 ... upstream_provider_shared_pool`。表现很容易被误读成
     「代码坏了」：助手不回话、确认卡片不出现。**那些检查要串行跑。**
   - **换成付费档并不等于脱离共享池**：付费的 `ling-3.0-flash-vl`（DeepInfra）
     照样 `429 engine_overloaded`，且 **`is_byok: false`** —— OpenRouter 用的是
     **它自己的**上游账号，付费只买到「走 OpenRouter 的额度」，没买到「自己的容量」。
     要真脱离只有 **BYOK** 或**自己托管**。且上游只给这类模型配了一家 provider，
     「换 provider」也走不通。
   - **「能回话」不等于「能用」**：同族的 `ling-3.0-flash` 与 `-fin` 响应很快、
     也会回话，但在真实应用里（10 个工具 + 完整人设）**一个工具都不调**，
     反而反问用户「请确认以上信息是否正确」——于是确认卡片永远不出现，
     **闸门被静默绕过**。它们裸测（两三个工具）反而是正常的。
     所以**换模型必须跑 `e2e-consent.sh`**，不能只打一发 chat 接口。

   对你们的含义：模型选择是**安全属性**，不只是效果与成本问题；
   上线前要把「敏感操作确实走到了确认卡片」当成模型验收项。
   另外：模型必须先登记进 profile 的 `models:` 目录，否则运行时直接拒绝
   （`pi-ai provider "openrouter" has no configured model "…"`）。
   向量侧也一并从免费档换成了付费档 `baai/bge-m3`（$0.01/M，1024 维）——
   原来的 `nvidia/llama-nemotron-embed-vl-1b-v2:free` 是同一个共享池问题；
   而且**它没有可用的付费端点**（付费条目在，但没有任何 provider 在服务），
   所以它不是"换成付费档"，而是必须换模型。选 bge-m3 是实测出来的：
   在 `examples/bank/corpus.json` 上出一组**容易混**的问题（手续费 vs 挂失手续费、
   手机银行 vs 免费、柜面 vs 限额），原来的 2048 维免费档错 1 条、bge-m3 全对。
   换模型**只改配置**（外加跟着改 `dimensions`），不涉及代码；
   向量索引是进程内现算的，没有落盘文件，所以换维度不需要迁移。
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
8. **历史对话列表存哪**（会话管理带来的新问题）：现在是浏览器 `localStorage`
   （见 §6），只在这台设备上、不加密、用户能改。上生产是搬到你们的服务端，
   还是保持本地 + 服务端只存审计？这条同时决定隐私口径与"换设备能不能看到历史"。
9. **语音用哪个模型、谁付费**：TTS 里**只有两个有中文音色**（都是 Qwen），
   而 ASR **没有免费档**。参考实现用的 `qwen-audio-3.0-tts-plus` +
   `qwen3-asr-0.6b` 是按"能用中文 + 便宜"选的，上生产要按效果与合规重新定。
   另外录音要不要留存、留多久，是合规问题不是技术问题——参考实现**不留**。
10. **一段业务会话 = 几个 agent 会话**：现在前端一段对话固定对一个 agent sessionId，
   但"上下文失效后重新开始"会让一段对话先后用过**不止一个** sessionId。
   你们的映射表要按 `(业务会话, 时间段)` 存，还是允许一对多？
   （这直接影响审计能不能还原"这句话是哪次回答的"）
11. **编辑重发 / 重新生成要不要真回退**：现在前端只是把**本地**记录截断、
    在同一会话里再问一遍，所以日志里会出现重复提问、而助手上下文并没有回退
    （详见 §6）。三个选项与代价列在那边，**推荐"保持现状"或"新会话 + 重放"**，
    不要走"让运行时截断会话日志"那条——它会牵动审计口径。
    无论选哪个，**审计必须留痕**：用户点"编辑"不等于"删掉曾经发生过的事"。
12. **消息能不能被复制出去**：这一版的复制按钮会把消息**原文**放进系统剪贴板。
    剪贴板是离开应用边界的：别的程序、剪贴板历史、跨设备同步都可能带走它。
    如果业务认为某些内容（卡号、安全码、完整账号）不该被一键复制，
    要明确"哪些消息不给复制按钮"——现在是**所有**用户发言与助手回复都能复制。
    （卡号与安全码那一块的展示有各自的掩码策略，见 README §12.4。）
