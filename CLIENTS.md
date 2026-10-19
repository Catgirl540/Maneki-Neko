# 客户端版本指引

更新于 2026-10-19。开始修改、构建或发布客户端前，先核对以下位置。

## 账户模型

当前产品要求：一个储蓄资金账户、多币种余额、多张银行卡。开卡与换汇不另行开户；理财账户仅用于投资资格。修改前阅读 [账户模型约束](docs/product/account-model.md)，不要从旧页面、数据库表行数或历史设计推导多账户逻辑。

2026-10-19 用户新增要求：Visa、银联各至多一张；数量限制尚未实现。会员分级仍在讨论，见 [银行卡与会员草案](docs/product/cards-and-membership-proposal.md) 和 [接手说明](design/handoff/AGENT-HANDOFF.md)，不要把建议门槛当作已确认规则或已发布功能。

## 当前维护版本

- **网页用户端**：`app/`。当前为 MONEY MEOW BANK 桌面工作台；维护说明见 [app/README.md](app/README.md)。
- **网页设计依据**：[2026-10-15 导出稿](docs/design/exports/2026-10-15/zhaocai-cat-bank.html)。使用单一智能首页，已取消传统/智能双模式；后续以用户确认的页面调整为准。
- **安卓客户端**：Flutter 工程 `mobile/`，特征为 `pubspec.yaml`、`lib/` 和 `mobile/android/`。它与原仓库根目录的 Kotlin `android/` 不是同一工程。
- **工作人员端**：`staff/`，不属于此次归档范围。

**本工作区已合入 Flutter 工程。** 2026-10-15 提交网页改版时同步合入 `origin/main` 的 `d6fa636`，包含 Flutter 新版、图标与银行卡修正、统一官网入口及员工留言。后续仍须核对远端最新提交；安卓修改在 `mobile/` 完成，不回到旧 Kotlin 工程。

安卓安装包必须从目标 Flutter 工作区的 `mobile/build/app/outputs/flutter-apk/` 获取，并核对提交、版本、包名和签名；不能使用旧 `android/app/build/outputs/apk/` 下的文件。

## 已归档版本

归档入口：[archive/README.md](archive/README.md)。

- `archive/2026-10-15/android-kotlin/`：旧 Kotlin / Jetpack Compose 安卓工程，退出日常开发和发布。
- `archive/2026-10-15/web-before-redesign/`：网页改版前源码压缩快照、金蓝配色规范、旧截图与已弃用的双模式原型。
- 根目录 `android/` 只保留迁移提示，没有可构建工程。

归档只用于回溯和对照；不作为新功能、视觉规范、构建或发布的默认来源。当前网页仍复用的接口与业务组件继续保留在 `app/`，不随旧设计一起移走。
