# 安卓客户端

原生 Kotlin / Jetpack Compose，使用现有银行与 Agent 接口。

## 本地构建

需要 JDK 21、Android SDK 36。`local.properties` 设置本机 SDK 路径。

```sh
cd android
./gradlew :app:assembleDebug
```

调试本机银行服务时，使用主机根地址；银行和 Agent 需通过同一个本地反向代理访问：

```sh
./gradlew :app:assembleDebug -Pluckycat.agentBase=http://10.0.2.2:8080
```

安装包：`app/build/outputs/apk/debug/app-debug.apk`。上述覆盖仅用于调试构建。

## 图标

桌面自适应图标、圆形图标、Android 13 主题图标及登录/卡面猫标，共用网页端 `app/src/components/brand/cat-mark.ts` 的几何数据。

在仓库根目录使用 Node 24：

```sh
node tools/gen-android-brand.mjs
node tools/gen-android-brand.mjs --check
```

生成资源直接提交到仓库。修改品牌形状后重新生成，不要单独改 XML。业务图标使用 `drawable/ic_*.xml` 的透明填充描边，通过 `NavGlyph` 着色。

## 银行卡管理

入口：首页的银行卡入口，或「我的 → 银行卡」。

- 申请新卡：选择接口提供的产品，核对制卡/寄送费，填写地址并验证支付密码。
- 换卡：按原卡卡组织读取产品费用。成功后旧卡失效，新卡以接口返回状态显示。
- 锁卡/解锁、网上支付、境外支付及单日限额：提交后采用接口返回结果，失败保留原值。
- 待激活和已换卡的卡片禁用不适用的操作。当前没有激活接口，客户端不自行将新卡标成正常。
- 查看卡信息：单独验证支付密码，读取 `pan`、`cvv`、`expiry` 和 `revealSeconds`。到期、关闭弹窗、退到后台或离开页面时清除；延迟响应不会重新显示。密码和卡密不持久化，敏感弹窗禁止截屏。

卡列表按登录客户隔离。产品加载失败可重试；申卡/换卡不会自动重试扣费请求。

## 验证

```sh
cd android
./gradlew :contract:test :domain:test
./gradlew :app:connectedDebugAndroidTest \
  -Pandroid.testInstrumentationRunnerArguments.class=cn.waveflow.luckycat.CardsFlowTest,cn.waveflow.luckycat.CardsManagementTest,cn.waveflow.luckycat.IconVectorTest,cn.waveflow.luckycat.LauncherIconTest
```

界面测试使用本地 MockWebServer，覆盖申卡/换卡、费用与地址、失败重试、限额单位、卡状态、卡密超时和晚到响应；不操作公网客户数据。
