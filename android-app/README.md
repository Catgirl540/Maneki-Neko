# 招财猫银行 · Android（Kotlin / Jetpack Compose）

设计依据：`docs/design/mobile-ui/index.md`（UI 树 + 节点截图）与 `docs/design/drafts/2026-10-20-mobile-framework.html`。
每个页面按 UI 树节点的截图实现，不照抄 HTML 结构。

## 环境

| 项 | 值 |
| --- | --- |
| Android SDK | `/data/sdk/Android/Sdk`（platforms 34/35/36，build-tools 35/36/37） |
| JDK | `/usr/lib/jvm/java-21-openjdk-amd64` |
| Gradle | `~/.gradle/wrapper/dists/gradle-8.14-all/8mguqc37c200i71ledpgw8n5m/gradle-8.14/bin/gradle` |
| AGP / Kotlin | 8.13.1 / 2.3.20（Compose BOM 2025.09.01） |
| minSdk / targetSdk | 26 / 36 |

`local.properties` 已写 `sdk.dir=/data/sdk/Android/Sdk`，不要提交到远端前泄露本机路径时再调整。

## 构建

```bash
cd android-app
JAVA_HOME=/usr/lib/jvm/java-21-openjdk-amd64 \
  ~/.gradle/wrapper/dists/gradle-8.14-all/8mguqc37c200i71ledpgw8n5m/gradle-8.14/bin/gradle \
  :app:assembleDebug
```

产物：`app/build/outputs/apk/debug/app-debug.apk`（仅本地调试，不得发布）

### dev 包（打开即登录演示账户）

`dev` 是一个独立构建类型：包名 `com.moneymeow.bank.dev`（可与正式包同机并存）、
应用名「招财猫 Dev」、`BuildConfig.AUTO_LOGIN_DEMO = true`，启动时自动用演示账户
（`13800138000` / `123456`）向演示环境要一条验证码并登录，失败则退回正常登录页。

```bash
cd android-app
JAVA_HOME=/usr/lib/jvm/java-21-openjdk-amd64 \
  ~/.gradle/wrapper/dists/gradle-8.14-all/8mguqc37c200i71ledpgw8n5m/gradle-8.14/bin/gradle \
  :app:assembleDev
```
产物：`app/build/outputs/apk/dev/app-dev.apk`。

接口地址默认仍是线上演示环境，要指向本机后端时加参数：

```bash
… gradle :app:assembleDev -PbankBaseUrl=http://10.0.2.2:8081
```

（模拟器里 `10.0.2.2` 指向宿主机；也可以 `adb reverse tcp:8081 tcp:8081` 后用
`http://127.0.0.1:8081`。）正式包不包含自动登录，`AUTO_LOGIN_DEMO` 恒为 `false`。

### 发布包

发布签名从本机忽略文件 `android-app/keystore.properties` 读取，密钥和口令不进仓库：

```properties
storeFile=/absolute/path/to/release.keystore
storePassword=…
keyAlias=…
keyPassword=…
```

```bash
cd android-app
JAVA_HOME=/usr/lib/jvm/java-21-openjdk-amd64 \
  ~/.gradle/wrapper/dists/gradle-8.14-all/8mguqc37c200i71ledpgw8n5m/gradle-8.14/bin/gradle \
  :app:assembleRelease -x lintVitalAnalyzeRelease -x lintVitalReportRelease -x lintVitalRelease
```

产物：`app/build/outputs/apk/release/app-release.apk`。发布前用
`node tools/package-android-download.mjs <APK>` 核对包名、版本、非调试标记、
大小和 SHA-256，再用 `tools/publish-android-update.mjs <APK> --notes "…"`
上传到 R2 并更新版本清单；脚本会拒绝与元数据不符的包。

银行和客户助手默认分别使用 `https://bank.waveflow.men/api/` 和
`https://bank.waveflow.men/agent-api/`，与线上客户网页走同一入口。
具体上游和数据环境以服务器当前配置为准；本地联调时需显式调整接口地址。

## 运行（本机模拟器）

```bash
/data/sdk/Android/Sdk/emulator/emulator -avd luckycat_ui -no-window -no-audio -no-boot-anim \
  -gpu swiftshader_indirect -no-snapshot &
ADB=/data/sdk/Android/Sdk/platform-tools/adb
$ADB install -r app/build/outputs/apk/debug/app-debug.apk
$ADB shell am start -n com.moneymeow.bank/.MainActivity
$ADB exec-out screencap -p > /tmp/screen.png
```

## 结构

```
app/src/main/java/com/moneymeow/bank/
├── MainActivity.kt      # 单 Activity + 返回栈 + 底栏（五格，中间猫钮）
├── Theme.kt             # 设计 token（与设计稿同一套色板/圆角）
├── Icons.kt             # 线性图标（路径取自网页 icons.tsx 与设计稿 SVG）
├── Screens.kt           # TopBar / SegTabs / ChipRow / KvCard / SwitchRow / PushScreen
├── HomeScreen.kt        # 01 主页
├── AuthScreens.kt       # 登录 + 开户（手机号/实名/人脸凭证/支付密码/承诺书）
├── WealthTab.kt         # 40 理财（总览/产品/持仓/记录）
├── ProductDetail.kt     # 理财详情 + 风险测评入口 + 申购/赎回结果
├── WealthFlows.kt       # 风险测评、理财账户开立、适当性与费率文案
├── NotifyTab.kt         # 41 通知
├── MeTab.kt             # 42 我的
├── CardsScreen.kt       # 34 银行卡
├── TransactionsScreen.kt# 32 交易记录 + 36 更多服务
├── AnalysisScreen.kt    # 37 消费分析
├── TransferScreens.kt   # 10 转出 / 11–13 表单 / 20 金额 / 21 确认 / 22 结果
├── AssistantScreen.kt   # 50 助手 + 52 能力弹层 + 51 历史
├── BankApi.kt           # 登录、开户、账户、流水、安全校验、理财接口
└── SubScreens.kt        # 35 存款 / 31 换汇 / 38 交易详情 / 34c 寄送 / 42c 会员 / 48 储蓄与计划 / 42a-b,d-h
```

## 状态

2026-11-01 完成 1.0.7 UI 重构：表单按需进入二级页或弹层，刷新/复制/筛选统一图标操作，卡片与输入框统一；转账确认入口固定在底部，底栏按实际高度预留空间。变更与验收见 [UI 重构记录](../docs/product/android-ui-refactor-2026-11-01.md)，对应新截图见 [设计树](../docs/design/mobile-ui/index.md)。

助手的智能服务入口由服务端下发：启动安卓助手时读取 `GET /agent-api/services`（唯一来源是 `framework/agent-services.json`），客户端只按 `id` 映射图标；取不到时隐藏入口，不回退本地清单，也不再把中文标签反查成 id。

当前本地源码已接通银行接口：账户与多币种余额、银行卡管理、换汇与双币种转账、香港 FPS、定时转账及 AA 收付款、分页流水与导出、月年报告、支出预算、存钱目标与定投、生日预留、现金管理规则、模拟消费及订阅合约、会员、安全、工资、借款、保险、邀请和人工客服工单。IM 绑定与微信日程复用现有助手服务接口。

接口可用性与部署配置有关；这些本地改动尚未发布。金融请求要求银行支持原子恢复协议，旧服务端会被客户端拒绝。外部银行、商户、短信、人脸及 IM 的演示/未接入限制不能据此视为真实清算能力。通知偏好、英语、物流追踪和正式签章回单暂无对应能力，界面显示实际限制；忘记登录密码引导身份核验与客服，不虚构自助重置成功。

详细路由映射、验收范围及限制见 [安卓与网页对齐清单](../docs/product/android-web-parity.md)。

### 开户与理财接入说明

- 开户调用 `POST /api/auth/register`：手机验证码、实名信息、人脸凭证（`POST /api/security/verify`）、6 位支付密码及账户开立承诺书均通过后才创建唯一储蓄资金账户；成功页只显示服务端返回的账户号、户名、账户类型和开户时间。
- 风险测评调用 `/api/wealth/risk/questions` 与 `/api/wealth/risk/assess`，结果为 C1–C5 及有效期、可购最高风险等级；风险测评过期或等级不匹配时，产品页与申购会引导重新测评。
- 理财账户调用 `/api/wealth/account/open`，要求有效风险测评、短信与人脸凭证、投资协议及人民币结算账户；理财账户只是投资资格，不是第二个储蓄账户。
- 申购要求有效测评、风险匹配、起购金额与追加步长、可用余额、完整抄录风险确认语句和支付密码；结果展示服务端确认的份额、净值、费用与持仓市值。
- 赎回按服务端返回展示实际份额、费用、结算方式和到账说明；演示环境即时到账（`sandbox-immediate`），不显示预计 T+1。
- 理财记录按申购/赎回关键词分别读取资金账户分页流水，可继续加载；不是独立份额登记或确认历史。

### 数据加载与刷新

- 读接口（GET）在 `BankApi` 内做 60 秒内存缓存，按「令牌 + 路径」分键；切换页面优先出上次结果，减少重复请求。`/api/auth/*`、`/api/idempotency/*` 与卡号安全码（`/secrets`）不缓存。
- 任何写操作（转账、换卡、消费、设置变更等）会立即清空读缓存，避免看到过期数据。
- 银行卡页进入时也清空读缓存并重新查询账户，避免先展示上一轮缓存余额。
- 主要数据页均支持下拉刷新（首页、我的、银行卡、交易记录、理财、通知、预算、储蓄与计划、定时与 AA、客服工单、微信提醒、会员等级、账单报告、模拟消费、交易详情、消费分析）：手势触发 `BankApi.invalidateReads()` 后重新拉取；纯静态页（更多服务、语言与地区等）不设刷新。
- 缓存只在内存中，退出应用即清空；不做磁盘缓存。
- 加载态用骨架屏（呼吸灰块）替代“加载中…”文字，避免布局跳变；网络失败统一显示“网络连接失败，请检查网络后重试”，不暴露系统英文异常。

### 代码结构约定

- 网络 I/O 只有一份实现：`HttpTransport.kt` 的 `BankHttp.raw()`，负责建连、超时、错误体解析、401 通知与系统异常文案。`BankApi` 的读缓存、幂等键、资金恢复仍在 `BankApi` 内，不放进传输层。未接入的两处各有原因：`AgentApi` 走独立网关（`/agent-api` + SSE 流式读取）；`UpdateApi` 要下载二进制安装包，不是 JSON 请求。
- 写操作统一走 `Actions.kt` 的 `Submitter`（`rememberSubmitter()`）：防重复点击、异常转文案、收尾复位；页面只提供成功/失败后的动作。
- 页面正文列用 `PageColumn {}`，错误提示用 `ErrorNote()`，列表骨架用 `SkeletonCardList()`，卡片入口行用 `EntryRow()`（`ServiceFormEntry` 是带说明的薄包装）；不要在各页重复写这些结构。
- `org.json` 取值与遍历用 `Json.kt` 的扩展（`objects()` / `forEachObject` / `requiredString` …），解析失败统一抛 `INVALID_RESPONSE`。
- 文字样式用 `Tokens.Text`（`hint` / `note` / `caption` / `body` / `bodyMuted` / `error`），间距用 `Tokens.Space`；新代码不要再写 `fontSize = 11.sp, color = Tokens.Muted` 这一对。图标与头像不允许加底色块，强调只用描边或文字色。

### 姓名展示

- 界面不再渲染用户全名：列表与问候用「姓氏 + 称呼」（`林女士`），个人资料详情用脱敏姓名（`林*满`）。
- 数据来自服务端 `displayName` / `maskedName`；老接口没有时由 `NameDisplay.kt` 按 `shared/name-display.mjs` 的同一套规则现算（兜底默认称呼为女士）。
- 称呼按身份证号第 17 位判定，演示账号没有证件号，走默认值。

### 昵称

- 昵称不是姓名：姓名（实名）在个人资料里始终脱敏（`林*满`），昵称只用于展示。
- 默认等于称呼（`林女士`）；点昵称旁的小铅笔可改，最长 16 字，清空即恢复默认。改动会即时更新首页问候与「我的」头部。
- 数据来自 `nickname` / `customNickname`；本地缓存由 `SessionStore.nickname()` 读取，老接口缺字段时按 `NameDisplay.kt` 的规则兜底。

### 用户头像

- 头像池固定 10 张（`shared/avatars.mjs`），安卓侧 `AvatarPool.kt` 维护 id → `R.drawable.avatar_NN` 映射，`UserAvatar()` 负责圆形裁切与缺失兜底（退回品牌猫）。
- 注册时随机分配一张；「我的 → 个人资料」点头像或在「换头像」处打开选择面板，选中即调 `PATCH /api/auth/profile/avatar` 保存并刷新页面。「我的」页头部与个人资料页共用同一张头像。
- 头像只从池里选，不做上传；服务端对池外 id 返回 `400 INVALID_AVATAR`，客户端也会先拦一次。
- 改池子：同时改 `shared/avatars.mjs`、`app/public/avatars/`、`res/drawable-nodpi/`、`AvatarPool.kt`，然后跑 `node tools/check-avatar-pool.mjs`。

### 已知待办

- `CardsScreen(onDelivery)` 与 `WealthTab(onOpenPlans)` 的回调目前没有被页面使用：卡片页没有寄送入口、理财页没有计划入口，属于功能缺口，不要直接删参数掩盖。
- 仍有约 490 处内联 `fontSize`、95 处内联 `RoundedCornerShape(12.dp)` 这类圆角；`Tokens.Text` 只覆盖了最常用的六种组合，后续按页替换。

### 演示限制

- 人脸步骤只向服务端申请演示人脸凭证，不调用摄像头、不做活体检测；短信验证码须由服务端实际下发。
- 登录页只在 debug 包预填演示手机号与密码（`BuildConfig.DEBUG`），release 包为空表单，不携带默认凭据。
- 客户端不提供理财定时扣款执行器；相关计划仍以服务端状态为准。

## 约束

- 一个资金账户、多币种余额、多张卡：卡面不显示余额，余额只在账户区展示，卡堆滑动不切换账户。
- 按钮近黑 `#101826`，紫色 `#533AFD` 只用于选中态与强调。
- 会员档位取自 `shared/membership.mjs`（普通 / 金卡 ¥10 万 / 白金 ¥50 万 / 钻石 ¥300 万），不得自造档位名称。

安卓银行卡号转账支持选择付款与到账币种，并核对服务端返回的换汇报价；客户端须先确认服务端声明支持同笔支付密码校验与报价确认，否则拒绝提交。手机号入口与 FPS 支持香港已登记的手机号、电邮、FPS ID 和银行账户，非账户标识提交前重新解析并核对确认收款人。定时转账与 AA 收付款使用现有银行接口，AA 待付款从服务端通知列表读取；流水按分区分页，月度和年度报告按选定币种读取完整账本。账户首页显示人民币储蓄余额。普通通知由流水和自动扣款预告推导，不代表服务端通知或已读状态。
# 资金操作结果恢复

转账、撤销在途转账、换汇、理财申赎、开卡、换卡、定时转账、AA 收付款、定投管理、生日预留及模拟消费操作在提交前检查服务端是否支持原子恢复，并将随机操作编号与类别保存到设备；不会保存支付密码或请求体。收到完整成功回执后清除记录；请求结果不明、重启应用或重新登录后需核查：服务端已处理则返回原结果，未处理则封存旧编号，避免迟到请求执行。网络不可用时保留记录，不能据此重新提交。客户端要求先升级服务端；本功能不代表外部合作银行已接入。

## 本地验收

构建 `:app:assembleDebug :app:assembleDebugAndroidTest --offline` 后，将两个调试 APK 安装到专用模拟器（不要使用登录线上账号的设备）。在仓库根运行：

```bash
node tools/check-android-catalog.mjs
node tools/check-android-parity.mjs emulator-5554
```

第二项复用 `tools/local-test-env.mjs` 的可丢弃 PostgreSQL 和测试锁，自动创建夹具、建立 adb reverse、传入仅存在于应用私有目录的测试登录并在结束时清理。截图保存为 `/tmp/maneki-parity-*.png`。不连接线上演示数据库。恢复持久化、并发提交与断流等仪器测试类为 `com.moneymeow.bank.FinancialRecoveryTest`；后端原子封存、隔离与持久化使用 PostgreSQL 集成门禁验证。

商户、预算平台和可订阅选项来自共享目录。修改目录后运行 `node tools/check-android-catalog.mjs --write`，随后重新校验并构建。
