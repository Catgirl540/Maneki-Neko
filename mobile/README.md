# Flutter 安卓客户端

## 1. 位置与范围

`mobile/` 是按 Open Design 稿重写的 Flutter 客户端，Android 包名仍为 `cn.waveflow.luckycat`，最低 Android 8.0。原 `android/` Kotlin 工程保留供迁移核对，不参与 Flutter 构建。

设计参考：`../design/android/open-design-reference.html`。主导航为「账户、理财、助手、我的」，转入、转出在账户内用底部弹窗办理。使用米白背景、深色余额卡、金色操作和 Lucide 图标；余额与产品数据全部由接口返回。

已接入：注册与登录、短信和身份核验、账户与收款信息、分页流水及详情、明细导出与电子回单入口、银行/FPS 转出与报价确认、转入、在途撤销、换汇、银行卡申请/换卡/锁卡/支付开关/限额/安全信息、消费分析/现金流/自动扣款、风险测评/理财开户/产品/申购/赎回、安全规则/设备/日志/改密/换号，以及 Agent 对话、图片、语音输入、回复朗读、确认卡、提问卡和本机历史。

## 2. 运行与接口

使用 Flutter 3.38.6 / Dart 3.10.7 或兼容版本、JDK 21 与 Android SDK。仓库银行服务本身仍是演示业务后端；Flutter 通过真实 HTTP 调用它，不在客户端生成模拟余额或固定助手答复。

```sh
cd mobile
flutter pub get
flutter run --dart-define-from-file=config/local-emulator.json
```

配置中 `BANK_BASE_URL` 拼接 `/api/*`，`AGENT_BASE_URL` 拼接 `/agent-api/*`。地址可以含反代前缀（例如 `https://host/bank`），不重复填写 `/api`、`/agent-api`。二者都发送当前客户的 Bearer token。Android 模拟器通过 `10.0.2.2` 访问电脑；真机使用能访问的服务器或局域网地址。

未指定配置时连接已核对的公网前缀 `http://120.48.123.112/bank`，银行与 Agent 的未登录请求均返回 401。配置见 `config/public-server.json`。旧的域名 `https://bank.waveflow.cn` 检查时无法建立连接，IP 根路径 `/agent-api` 则是其他应用，不能省略 `/bank`。调试版允许当前 HTTP 服务，登录页右上角也可修改服务地址；正式版用构建参数配置并只允许 HTTPS。模型、ASR、TTS 的密钥只在服务端配置。

在仓库根目录启动隔离银行（不连接客户数据库）：

```sh
BANK_PORT=18080 BANK_DB_FILE=/tmp/luckycat-flutter-bank.sqlite \
  BANK_STATE_FILE=/tmp/luckycat-flutter-bank-state.json node server/index.mjs
```

Agent 接到同一银行服务后，在 `18788` 端口提供 `/agent-api`。沿用 `framework/` 的 bootstrap、build 与运行方式，设置 `LUCKYCAT_BANK_URL=http://127.0.0.1:18080`、`LUCKYCAT_DEMO_PORT=18788`。接口类型以 `app/src/api/types.ts`、路径以 `app/src/api/contract.ts` 为准。

## 3. 关键实现

- `lib/core/api.dart`：JSON 请求、金额分值、错误、SSE 握手与游标续接。首帧或连接失败时切到短请求接收，不自动重发用户消息。
- `lib/core/session.dart`：内存登录态、账户刷新及过期退出。旧请求不能覆盖新账户；身份失效时清掉页面返回栈。
- `lib/core/chat.dart`：对话与事件状态。优先恢复服务端会话，仅在确定旧会话不存在时迁入文字历史。
- `lib/pages/`：四个主页面与业务弹窗。`ui/common.dart` 集中主题、表单、加载和错误状态。
- `core/files.dart` 与 Android `MainActivity`：服务端导出数据转 CSV，通过系统分享文件；电子回单只打开后端提供的地址，接口未提供文件时如实提示。

支付密码只进入验证/业务接口，不进入聊天记录。历史以「银行地址 + 客户 ID」隔离并通过安全存储保存，不包含图片原始数据、确认密码、工具参数或卡密。卡密按接口时限消失，切后台也清除。正式版禁止截图和备份。金融提交遇到无法确定结果的网络错误时停止重复提交，先让用户核对记录。

当前身份核验沿用项目 `/api/security/verify` 的能力；该演示后端返回核验票据，客户端没有自行实现真实活体识别。是否支持 ASR/TTS 取 Agent 的健康检查结果。录音最长 60 秒，识别后先填入输入框供用户核对；回复通过 `/tts` 合成后播放。文字回复使用 SSE 流式更新。

## 4. 验证与构建

```sh
cd mobile
flutter analyze
flutter test --reporter expanded
# 仅接受 localhost 的隔离银行，测试会产生转账/申赎等数据
flutter test test/live_bank_test.dart \
  --dart-define=LIVE_BANK=http://127.0.0.1:18080 --reporter expanded
flutter build apk --debug --dart-define-from-file=config/local-emulator.json
# 连接现有公网银行的手机调试包
flutter build apk --debug --split-per-abi --dart-define-from-file=config/public-server.json
```

`test/` 覆盖金额精度、鉴权、无效响应、SSE 分包与降级游标、账户并发刷新、窄屏和转账入口、CSV 转义。`integration_test/app_test.dart` 可在已启动的 Android 测试设备上跑登录、导航与截图：

```sh
flutter test integration_test/app_test.dart -d emulator-5580 \
  --dart-define-from-file=config/local-emulator.json
```

仓库根目录运行 `node mobile/tool/check-live.mjs` 可自动启动并清理临时银行、真实 Agent 和本机模型协议夹具，串行验证真实资金操作、Flutter 会话握手、历史恢复、流式文字回复与卡密不落盘。需先完成 `framework/scripts/bootstrap.sh`、`build.sh`；Flutter 不在 PATH 时通过 `FLUTTER_BIN` 指定可执行文件。

本次已验证银行 HTTP 联调及 `node tools/check-agent-http.mjs` 的真实 Harness 回归；后者使用本机模型协议夹具，不调用外部模型。相册、摄像头、麦克风授权与音频播放需在实际 Android 设备上继续验收，不能用组件测试代替。

手机调试 APK：`build/app/outputs/flutter-apk/app-arm64-v8a-debug.apk`（多数手机），另生成 armeabi-v7a 和 x86_64 版本。当前公网服务为 HTTP，正式发布前须配置可用的 HTTPS 地址，并准备 `android/key.properties`（不提交）中的 `storeFile`、`storePassword`、`keyAlias`、`keyPassword`，再执行 `flutter build apk --release --dart-define-from-file=...`。升级原 Kotlin 应用必须使用原签名；缺少正式签名时 Release 构建会直接报错，不使用调试签名冒充发布版。

官网 `/bank/download` 提供安卓安装包，手机访问网页客户端会统一进入下载页。默认使用 `flutter build apk --debug --dart-define-from-file=config/public-server.json` 生成的通用 APK，兼容 arm64-v8a、armeabi-v7a 与 x86_64。在仓库根目录运行 `npm --prefix app run prepare:android` 后再构建官网，版本和文件大小从 APK 生成。正式包可用 `node tools/package-android-download.mjs /绝对路径/app-release.apk` 替换；后续每次更新安装包都要重新准备并发布整个网页产物，见 [网页维护手册](../app/README.md#7-构建与发布)。

## 5. 应用内更新

1.0.1 起支持启动时检查一次，以及「我的 → 检查更新」。检查失败不打断登录；业务弹窗已经打开时不弹出启动更新提示。点击下载后显示进度，支持取消与失败重试；在应用内返回其他页面时下载继续，进程被系统结束后需重新下载。

更新源默认是 `BANK_BASE_URL/downloads/android.json`，可通过构建配置 `UPDATE_BASE_URL` 指定官网前缀（例如 `https://host/bank`）。静态更新请求不携带银行 token，不跟随重定向；正式版只接受 HTTPS。`lib/core/updates.dart` 负责版本判断、大小/摘要校验及私有缓存下载，`lib/pages/update.dart` 负责界面。原生 `AndroidUpdater` 和 `ApkIntegrity` 使用 Android 的 apksig 验证真实 APK 签名，再核对包名、版本、系统及当前应用签名，拒绝降级和不同签名的包。

下载与校验完成后需点击「安装更新」。未授权时打开系统的安装来源设置，返回后点「继续安装」，最后由系统安装器确认；打开安装界面不等于更新已完成。安装来源权限使用 Android 官方的 [`canRequestPackageInstalls`](https://developer.android.com/reference/android/content/pm/PackageManager#canRequestPackageInstalls()) 流程。

发布新版时，递增 `pubspec.yaml` 的 `+build` 数字，沿用同一签名，可在 `releases/<version>.md` 写不超过 2000 字的更新说明。重新构建 APK，运行 `prepare:android` 和 `build:server`，把网页与安装包一起发布。不能只改元数据中的版本号，也不需要新增银行接口。1.0.0 尚无更新代码，需要先手动安装一次 1.0.1；后续版本才可在应用内升级。

准备新包时，旧的官网包会移到本机 `build/download-archive/`，网页产物只携带当前 APK。需要回滚时，用原包重新执行准备与发布流程。

`flutter test test/updates_test.dart` 覆盖版本/兼容性、取消清理、损坏下载、重试及权限状态。原生校验可对已签名的实际 APK 验证：

```sh
cd mobile/android
UPDATE_TEST_APK="$PWD/../build/app/outputs/flutter-apk/app-debug.apk" \
  ./gradlew :app:testDebugUnitTest --no-daemon
```

原生测试覆盖 Android 8.0 与当前系统的签名验证、不同签名、错误长度/摘要，以及连同元数据摘要一起修改的篡改 APK。实际手机上的安装来源授权和覆盖安装仍需真机验收。
