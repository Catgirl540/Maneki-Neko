# Android 发布说明

`tools/package-android-download.mjs` 会把这里与 APK `versionName` 同名的 `<version>.md` 正文写入 `app/public/downloads/android.json` 的 `releaseNotes` 字段，供官网下载页和 App 内更新展示。

- 文件名用 APK 的 `versionName`，例如 `1.0.3.md`。
- 首行标题会被去掉，正文最长 2000 字符。
- 没有对应文件时不写入说明，不会报错。
