# P13 · 安卓客户端（原生 Kotlin + Compose）

> 状态：**第 1 步已落地并跑通**（脚手架 + 纯 JVM 契约测试 + debug APK 构建成功）。
> 第 2 步起（聊天界面、语音、Room）未开始。
> 相关：`P6-WEB-BRIDGE.md`（要实现的接口面）、`P8-VOICE.md`（流式语音的协议与坑）、
> `P5-CONSENT.md`（确认卡片与支付密码）、`P7-SESSIONS.md`（会话历史）、
> `P12-ASK.md`（提问卡片）、`P11-PERSONA.md`（语气与"不暴露模型"）。
> 代码：`android/`（`:app` 安卓应用 + `:contract` 纯 JVM 契约层）、
> `android/scripts/gate.sh`（门禁）、`android/gradle/libs.versions.toml`（版本目录）。

## 是什么

把现在这个**只给桌面浏览器**的前端，做一个安卓原生版。为什么单独做原生而不是
把 web 改成响应式：

- 现有前端 **0 个响应式断点**——它压根不是"窄一点"就能用的东西，是照桌面宽度
  排的版。改成手机版等于重排一遍，而重排完还是网页。
- **语音是重点，而语音在原生上更强**：`AudioTrack` 直接喂 PCM16 就没有浏览器那套
  自动播放策略（`playBlocked` / 用户手势解锁）；`MediaRecorder` 的容器格式也比
  浏览器的 `webm` 更好对上桥接的 ASR 映射。
- 手机端要的是"能揣兜里用"，PWA 在安卓上仍然会受浏览器策略与后台限制。

**App 只实现 `P6` / `P8` 已经文档化的接口面，桥接一行不改。** 这是这一层的意义：
换客户端不动后端。

## 技术栈（版本按这台机器已预热的组合钉死）

这台机器上 `/data/sdk/Android/Sdk` 已有 SDK（另一个盘上，比 `~/Android/Sdk` 新），
`~/.gradle` 里已有 Gradle 与 AGP 的缓存，`~/.gradle/init.gradle` 已配华为/腾讯/阿里云
优先镜像（实测华为 4.8MB/s）。所以版本不是"挑最新"，而是**挑已经暖过的**，
避免第一次构建就卡在下载上。

| 项 | 版本 | 说明 |
| --- | --- | --- |
| JDK | **21** | 机器上 21 和 25 都有，**默认是 25**；AGP 8.13 跑不了 25。所以 `android/gradle.properties` 里把 `org.gradle.java.home` 钉到 21（实测：launcher 是 25，daemon 起的是 21） |
| Gradle | **8.14** | `~/.gradle/wrapper/dists` 里**唯一下完的**发行版。`gradle-8.14.3-all` 只有一个 `.part`——**这是个坑**，wrapper 写 8.14.3 会重新下载 |
| AGP | 8.13.1 | 已缓存。AGP 现在已经是 9.x（要 Gradle 9），不走 |
| Kotlin | 2.2.20 | 已缓存，且与 Compose BOM 2025.09.01 同时代（新库配旧编译器会有元数据不兼容） |
| compileSdk / targetSdk | 36 | `/data/sdk/Android/Sdk/platforms` 有 android-36.1 |
| minSdk | 26 | 覆盖够老，且免掉一堆兼容分支 |
| UI | Jetpack Compose + Material 3 | BOM 2025.09.01 |
| 异步 | Coroutines + Flow | SSE 流式与录音回调天然配合 |
| 网络 | **OkHttp 5.1.0** + kotlinx.serialization 1.9.0 | 见下 |
| 本地 | Room 2.8.1（会话）+ DataStore 1.1.7（登录态） | 替代 web 端的 `localStorage['luckycat.agent.sessions.v1']` 与内存 token |

**上面每一个版本号都对着镜像核过存在性**（`maven-metadata.xml` + 具体 pom 的 200），
没有一个是猜的。

### 依赖按需，不上全家桶

`OkHttp`（HTTP + SSE 手动解析）、`kotlinx.serialization`（JSON）、`Room`、`DataStore`。
**不引** Retrofit（就十来个端点，OkHttp 直接写更清楚，SSE 本来也要手写）、
不引 Hilt（手写构造注入，模块少到用不上）。

Markdown / KaTeX：web 端助手回复支持 Markdown + KaTeX（`tools/check-markdown.mjs`）。
安卓端**先降级成纯文本 + 代码块**，公式这坑单独记一笔——不假装支持。

## 四块硬骨头

### 1. 流式语音（安卓这边反而简单）

`POST /agent-api/tts/stream` 是 SSE：`start{format:'pcm',sampleRate}` → `audio`×N
（裸 PCM16 LE 的 base64）→ `end{frames,bytes,truncated}`，失败回 `error{message}`。

安卓侧：每帧 base64 解码 → **`AudioTrack`（24000Hz / mono / PCM16）直接 write**，
首帧到达就出声。比 Web Audio 那套少了自动播放策略，但**必须照搬 web 端踩出来的三条**：

| 坑 | 结论 |
| --- | --- |
| 取消 ≠ 失败 | 用户主动停要静默，真失败要上报。web 端的 bug 是 `teardownPlayback()` 先 abort 了 controller，再读 `signal.aborted` 永远是 true，**真失败被吞掉**。安卓侧要在关流之前先记 `wasAborted` |
| 波形在整段合成完之后才算 | 不要边收边算 |
| 说话不能算数 | 见下 §3 |

按住说话：`MediaRecorder` → AAC/MP4 → base64 → `POST /agent-api/asr`。
桥接按 MIME 映射格式（`audio/mp4→m4a`、`audio/aac→aac`），**安卓默认产出哪种容器
要真机验一遍**，这是没验过的一条。

### 2. 确认通道 / 提问通道

`consent` 事件带 `challenge`，用户作答走 `POST /agent-api/consent/:challengeId`
`{ decision, paymentPassword? }`；提问走 `POST /agent-api/questions/:questionId/answer`。
**这两个都是"答完才放行长轮询"**，所以客户端不能超时就当拒绝——超时语义见 `P5` / `P12`。

### 3. 安全：支付密码绝不进 agent

照 `P5-CONSENT.md`：**展示交易信息 → 用户确认 → 输入支付密码 → 才执行**，
密码只发桥接，绝不进对话、绝不进模型上下文。**语音只提醒，不代答**。

这是整个原生重写里风险最高的一块，也是 web 端门禁最多的一块
（`check-agent.mjs` 51 条里大半是它）。安卓侧必须单独写门禁，不能靠"看起来对"。

### 4. 测试（原生重写最大的代价，先认账）

web 端那套 Playwright 门禁（100+ 断言）**对不上原生**。重来，但分两层：

- **契约测试（最值钱，纯 JVM，不需要模拟器）**：直接打桥接 `/agent-api/*`，
  断言响应形状、SSE 事件序列、consent 通道。**web 端和安卓端跑同一份**——
  桥接契约一改，两端同时红。这一层能立刻跑，是第一步就做的理由。
- **安卓 UI 测试**：Compose UI Test（模拟器）+ 真机冒烟（语音、录音、音频焦点）。
  门禁思想照搬 web：**用 `testTag` 当锚点**（等价于 web 的 `data-*`），
  每条新门禁都做变异验证，空断言要标注出来。

## 联调与部署

- **桥接现在只监听 `127.0.0.1`**（`demo-server.mjs` 的 `server.listen(PORT, '127.0.0.1')`），
  真机连不上。联调要改绑 `0.0.0.0`。
- 访问口令**已经有了**，不用新做：服务端 `LUCKYCAT_DEMO_TOKEN` + 请求头
  `x-luckycat-token`，设了口令以后所有请求都要带（`demo-server.mjs` 里那段 401）。
  客户端这边 `AgentApi(token = …)` 已经把这个头带上。
  也就是说改绑 `0.0.0.0` 时**必须同时设 `LUCKYCAT_DEMO_TOKEN`**——
  把 demo-server 暴露到局域网而不设口令是不能接受的。
- 真机联调：手机与电脑同一 Wi-Fi，App 里把桥接地址配成 `http://<电脑局域网IP>:8788`。
  手机上的 `127.0.0.1` 是手机自己，模拟器访问宿主机才是 `10.0.2.2`。
- 明文 HTTP：只有 **debug** 构建允许（`app/src/debug/AndroidManifest.xml` 里的
  `usesCleartextTraffic`）。这是银行客户端，release 不该默认允许明文。
- 线上 `bank.waveflow.cn` 是**旧版本、完全没有语音**；要让手机端真正可用，
  最终要把新版前端 + 桥接一起重新部署。这不在本轮范围内，但别忘。

## 一条容易搞错的服务端语义（写进契约测试了）

确认通道上，**支付密码错误时服务端回 401 且「不结算」挑战**——用户还能再输一次
（`demo-server.mjs` 的 `answerConsent` 分支）。所以客户端必须把 401 当**重试**，
不能当"失败"把卡片收起来：收起来以后用户没有第二次机会，而 agent 那边还在等。
`AgentApiTest.确认通道的 401 是密码不对 不是终态` 钉的就是这条。

## 实施顺序

1. ~~**脚手架 + 纯 JVM 契约测试**~~ —— **已完成**（见上一节）。
2. **契约客户端**：OkHttp 封装 + SSE 解析 + 类型（照 `P6` 抄）。—— **已完成**，
   `:contract` 里那四个文件就是。
3. **登录 + 首页 + 账户列表**：第一块能点起来的 UI。← 下一步
4. **客服聊天**：SSE 事件流、消息气泡、确认卡片、提问卡片（先卡片，后语音）。
5. **语音**：`AudioTrack` 流式朗读 + 按住说话 ASR。
6. **会话历史 Room + 门禁补齐**（Compose UI 测试 + 真机冒烟）。
   Room / DataStore 已在版本目录里登记（版本核过），等做到这层再 apply。

## 第 1 步：实际落地了什么（都是跑出来的，不是推断的）

`:contract`（纯 JVM，不依赖 Android SDK）：

- `Sse.kt` —— 增量 SSE 解析器。**按行喂**而不是按块：OkHttp 的 `readUtf8Line()`
  已经把 `\n` 与 `\r\n` 都处理掉了，分块解析要自己处理"块边界切在 `\r` 和 `\n`
  中间"，白白多一份容易错的代码。注释行（桥接的 `: ping` 保活）必须安静吃掉。
- `AgentEvent.kt` —— P6 那张表的 11 种事件。**未知类型走 `Unknown` 而不是崩**
  （唯一的向前兼容硬要求）；坏帧走 `Malformed` 而不是静默丢弃。
- `AgentApi.kt` —— OkHttp 客户端：health / 建会话 / 只读问会话 / 发消息 /
  事件流 / 确认通道 / 提问通道 / ASR / 流式 TTS。两条流都是 `channelFlow`，
  **取消会真的掐掉 HTTP 连接**，不是留着连接只停止收集。
- `TtsFrame.kt` —— 语音流的帧，音频帧是**裸 PCM16 LE**。

`:app`：Compose + Material 3，一个「契约自检」页，直接打真桥接的 `/agent-api/health`。
明文 HTTP 只在 debug 清单里放开（银行客户端，release 不该默认允许明文）。

**实测结果**：

| 项 | 结果 |
| --- | --- |
| debug APK | 构建成功，11.9MB，`cn.waveflow.luckycat`，minSdk 26 / targetSdk 36，标签「招财猫银行」 |
| 契约测试（离线） | **55 条全过**（SseParser 14 + AgentEvent 15 + AgentApi 26），真桥接那 5 条跳过 |
| 契约测试（真桥接） | **60 条全过**（含 LiveContract 5 条） |
| 门禁 | `bash android/scripts/gate.sh` → 全部通过 |

### 真桥接那一层抓到一个真 bug（离线抓不到）

`LiveContractTest.事件流第一帧是 hello` 一跑就红：

```
java.net.SocketException: Socket closed
  at okhttp3.internal.http1.Http1ExchangeCodec$ChunkedSource.readChunkSize
  at LiveContractTest$事件流第一帧是 hello$1$first$1.invokeSuspend(LiveContractTest.kt:72)
```

原因是**取消被当成了失败**：界面订阅事件流后常常只要前几帧就取消
（`first()` 就是这个形状），取消触发 `awaitClose` 里的 `call.cancel()`，
阻塞中的读取于是抛 `SocketException: Socket closed`，而它被当成错误往收集方报了。
用户按"停止"就会看到一条报错。

修法是判据用 `isActive`：**取消导致的 IOException 吞掉，真失败照旧上报**。
和 web 端那个坑正好是反面——那边是 `teardownPlayback()` 先 abort 再读
`signal.aborted`，把**真失败**吞掉了。

### 一条空断言，以及为什么离线抓不到它

修完以后我按纪律做了变异验证（把 `isActive` 改回"一律上报"），
结果**离线那两条"取消不抛异常"照样绿**——它们是空断言。

原因是时序：`first()` 拿到值就取消了收集，reader 随后抛的异常被送进一个
**已经没人读的 channel**，静默丢掉，观测不到。试过 `SocketPolicy.KEEP_OPEN`
想让读取真的阻塞住，也不行，同一个原因。

真桥接那条则稳定抓到：变异版**连跑 3 次全红**。所以：

- **取消竞态的唯一有效守卫是真桥接那条**（已在测试文件里写明，别删了当成冗余）；
- 离线那两条保留，但注释里明确写了"这条不覆盖那个 bug"，只值"浅层不崩"这一点；
- 反向那条（`流到一半被掐断要抛出来`）是确定性的，也做了变异验证：
  把 IOException 一律吞掉，它立刻红。

## 验收（第 1 步）

- [x] 版本组合能在这台机器上**真的构建出 APK**（不是"应该能"）。
- [x] `:contract` 的契约测试打真桥接，**真的红/绿**，且做了变异验证。
- [x] 一条新门禁进 README 的门禁表（`bash android/scripts/gate.sh`）。
      没进 `verify.sh`：那条链是框架自身的验证（profile/插件树/DSH 版本），
      安卓门禁要在有 JDK 21 + Gradle 的机器上跑，混进去会让框架验证多一个无关前提。
