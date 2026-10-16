# 当前网页设计入口

- 设计依据：[2026-10-15 原始导出稿](exports/2026-10-15/zhaocai-cat-bank.html)，摘要在同目录 `manifest.json`。
- 实施记录：[web-workbench-implementation.md](web-workbench-implementation.md)。
- 当前页面验证截图：`implementation-screenshots/`，同一页面以最新结果为准。
- 登录页后续调整：按用户指定的 [Stripe 登录页](https://dashboard.stripe.com/login) 采用中央白色表单；后续按用户反馈垂直居中，背景改为蓝紫渐变泡泡。保留手机号、密码、短信验证码及注册流程；实现见 `app/src/pages/LoginPage.tsx`、`app/src/styles/login.css`。
- 当前网页标志与客服头像：`app/src/assets/design/`。客服原图：`mascot/support-cat-v1.png`。
- `logo-proposal/` 为标志探索过程，不能直接替换已采用资源；`opendesign-recovery.md` 为本机工具恢复记录。

已弃用的双模式需求、原型截图及金蓝风格已移入 [旧网页归档](../../archive/2026-10-15/web-before-redesign/README.md)。当前网页为单一智能工作台，只验收桌面端。完整版本指引见 [CLIENTS.md](../../CLIENTS.md)。
