# 客户端版本指引

更新于 2026-10-23。开始修改、构建或发布客户端前，先核对以下位置。

## 账户模型

当前产品要求：一个储蓄资金账户、多币种余额、多张银行卡。开卡与换汇不另行开户；理财账户仅用于投资资格。修改前阅读 [账户模型约束](docs/product/account-model.md)，不要从旧页面、数据库表行数或历史设计推导多账户逻辑。

2026-10-19 已合入银行后端与当前网页的 Visa、银联各至多一张规则，以及按上月日均储蓄资产评定的会员等级；以 [账户模型约束](docs/product/account-model.md) 和当前实现为准。银行卡与会员草案、旧接手说明是历史讨论，不能覆盖已实现规则；安卓入口仍需核对其具体版本。

## 当前维护版本

- **网页用户端**：`app/`。当前为 MONEY MEOW BANK 桌面工作台；维护说明见 [app/README.md](app/README.md)。
- **网页设计依据**：[2026-10-15 导出稿](docs/design/exports/2026-10-15/zhaocai-cat-bank.html)。登录后落地 `/dashboard` 总览页；智能助手独立为 `/assistant`（`/support` 兼容跳转），拆分依据 [2026-10-20 草稿](docs/design/drafts/2026-10-20-overview-and-assistant.html)。已取消传统/智能双模式；后续以用户确认的页面调整为准。
- **安卓客户端**：Kotlin + Jetpack Compose 工程 `android-app/`（2026-10-21 起按用户要求新建，设计依据 `docs/design/mobile-ui/` 的 UI 树与截图）。特征为 `settings.gradle.kts`、`app/src/main/java/com/moneymeow/bank/`。历史 Flutter 工程（原 `mobile/`）已于 2026-10-23 仓库清理时删除，需要对照时从 git 历史取，不用它交付安卓功能。
- **工作人员端**：`staff/`，不属于此次归档范围。

**当前安卓实现是 Kotlin（`android-app/`）。** 构建与运行见 [android-app/README.md](android-app/README.md)；也不使用归档的 Kotlin 工程。历史：本工作区曾在 2026-10-15 合入 Flutter 工程（`origin/main` 的 `d6fa636`，含 Flutter 新版、图标与银行卡修正、统一官网入口及员工留言）；该工程已随 2026-10-23 清理删除，只保留在 git 历史中。

安卓安装包从 `android-app/app/build/outputs/apk/debug/app-debug.apk`（调试）获取并核对提交与版本；不从归档的旧 `android/` 工程取包。

## 历史归档

历史工程已于 2026-10-26 从工作区删除，仅保留在 git 历史（删除前提交 `f865b18`）中：

- `archive/2026-10-15/android-kotlin/`：旧 Kotlin / Jetpack Compose 安卓工程。
- `archive/2026-10-15/web-before-redesign/`：网页改版前源码压缩快照、金蓝配色规范、旧截图与已弃用的双模式原型。
- `archive/2026-10-19/dsh-before-0.2.1/`：DSH 升级前框架源码。
- 根目录 `android/` 只保留迁移提示，没有可构建工程。

需要回溯时用 `git show f865b18:<路径>` 或 `git checkout f865b18 -- <路径>`；历史版本不作为新功能、视觉规范、构建或发布的默认来源。当前网页仍复用的接口与业务组件继续保留在 `app/`，不随旧设计一起移走。
