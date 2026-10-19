# 已归档客户端与设计

此目录保存历史版本，退出日常开发、构建和发布。当前维护入口见 [CLIENTS.md](../CLIENTS.md)。

## 2026-10-15

- [旧安卓 Kotlin 工程](2026-10-15/android-kotlin/README.md)：原根目录 `android/`。
- [旧网页源码与设计](2026-10-15/web-before-redesign/README.md)：改版前源码快照、金蓝规范、旧截图和已弃用原型。
- [归档清单](2026-10-15/manifest.json)：来源提交、旧安卓源文件摘要及网页快照摘要。

默认搜索与批量修改时排除此目录；回溯时先解压到临时目录，不覆盖当前 `app/`。构建缓存、本机 SDK 配置与 APK 即使在本地归档中存在，也不提交、不用于发布。

## 2026-10-17

- [Flutter 重设计前归档](2026-10-17/flutter-before-redesign/README.md)：提交 `9f0656f` 的 `mobile/` 源码快照，仅作回滚与功能核对；视觉风格已弃用，新设计不得沿用。当前 Flutter 工程仍由 `mobile/` 维护。
