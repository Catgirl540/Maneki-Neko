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

- 已实现：主页、登录、开户全流程、理财四段、理财详情、风险测评、理财账户开立、申购与赎回、通知、我的、银行卡、交易记录、消费分析、转出全流程、助手、存款、换汇、交易详情、寄送信息、会员等级、储蓄与计划、我的各二级页。
- 未实现（仍是占位页）：转入弹层、申请新卡弹层、通知与交易筛选抽屉、更多服务里的自动扣款/工资备用金/借款/保险/邀请。
- 登录、开户和理财流程已接入 HTTP 接口，使用服务端返回的账户号、风险等级、份额、费用和到账结果；页面不再展示虚构开户成功或固定 T+1 回执。其余未完成或仍带演示内容的页面不能视为全部业务已接通。

### 开户与理财接入说明

- 开户调用 `POST /api/auth/register`：手机验证码、实名信息、人脸凭证（`POST /api/security/verify`）、6 位支付密码及账户开立承诺书均通过后才创建唯一储蓄资金账户；成功页只显示服务端返回的账户号、户名、账户类型和开户时间。
- 风险测评调用 `/api/wealth/risk/questions` 与 `/api/wealth/risk/assess`，结果为 C1–C5 及有效期、可购最高风险等级；风险测评过期或等级不匹配时，产品页与申购会引导重新测评。
- 理财账户调用 `/api/wealth/account/open`，要求有效风险测评、短信与人脸凭证、投资协议及人民币结算账户；理财账户只是投资资格，不是第二个储蓄账户。
- 申购要求有效测评、风险匹配、起购金额与追加步长、可用余额、完整抄录风险确认语句和支付密码；结果展示服务端确认的份额、净值、费用与持仓市值。
- 赎回按服务端返回展示实际份额、费用、结算方式和到账说明；演示环境即时到账（`sandbox-immediate`），不显示预计 T+1。
- 理财记录读取结算资金账户最近 50 条流水中的申购/赎回记录，不是独立的全量申赎历史。

### 演示限制

- 人脸步骤只向服务端申请演示人脸凭证，不调用摄像头、不做活体检测；短信验证码须由服务端实际下发。
- 登录页保留演示手机号与密码的预填，仅用于本地联调，不是生产凭据。
- 客户端不提供理财定时扣款执行器；相关计划仍以服务端状态为准。

## 约束

- 一个资金账户、多币种余额、多张卡：卡面不显示余额，余额只在账户区展示，卡堆滑动不切换账户。
- 按钮近黑 `#101826`，紫色 `#533AFD` 只用于选中态与强调。
- 会员档位取自 `shared/membership.mjs`（普通 / 金卡 ¥10 万 / 白金 ¥50 万 / 钻石 ¥300 万），不得自造档位名称。

安卓目前仅支持经核验的境内银行卡号同币种转账；客户端须先确认服务端声明支持同笔支付密码校验与报价确认，否则拒绝提交。手机号、FPS 和跨币种转账仍未开放。账户首页显示人民币储蓄余额；交易页汇总仅覆盖最近获取的流水。通知由流水和自动扣款预告推导，不代表服务端通知或已读状态。
