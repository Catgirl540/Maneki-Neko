# 检查与工具脚本

仓库里的可执行检查都在这里。命名规则：`check-*` 是断言脚本，`gen-*` 生成资产，`shoot-*` 截图，其余是一次性运维工具。

## 怎么跑

```bash
node tools/check-routes.mjs                                  # 纯静态
node --import ./tools/ts-resolve-hook.mjs tools/check-card-state.mjs   # 需要解析 app/src 的 .ts
node tools/check-agent.mjs --shots                           # 需要浏览器：另开 dev server 并设 CHROME_PATH
```

- 报 `ERR_MODULE_NOT_FOUND ... .ts` 就是少 `--import ./tools/ts-resolve-hook.mjs`。
- 需要真实模型或微信的脚本（`*-live.mjs`、`check-voice`、`check-image`）默认跳过，必须显式配密钥才会发请求，会产生费用。
- 需要数据库的脚本要求专用隔离库 `BANK_TEST_DATABASE_URL`，**不许指向生产库**；入口是 `node tools/local-test-env.mjs integration`。

## 常用门禁

| 脚本 | 校验什么 | 依赖 |
| --- | --- | --- |
| `check-contract.mjs` | `BankApi` / mock / HTTP 三层方法一致 | 静态 |
| `check-routes.mjs` | 站内链接都指向真实路由 | 静态 |
| `check-account-model-docs.mjs` | 账户模型文档与代码一致 | 静态 |
| `check-single-account.mjs` | 一个资金账户、多币种余额 | TS 解析 |
| `check-bank-api-wiring.mjs` | 服务端路由真实初始化 + 事务回滚 | TS 解析 |
| `check-card-state.mjs` | 卡状态机（激活/锁定/挂失/消费）服务端 + 浏览器双端 | TS 解析 |
| `check-wealth-redemption.mjs` | 赎回批次、费率和即时到账口径 | TS 解析 |
| `check-assets.mjs` | 引用的图/字体真的存在 | 静态 |
| `check-postgresql-integration.mjs` | 后端与 PostgreSQL 整合 | 专用库 |

## 分组

| 域 | 主要脚本 |
| --- | --- |
| 账户与转账 | `check-account-flows` `check-transfer-holds` `check-transfer-quotes` `check-transfer-status-ui` `check-receiving` `check-fx-export` `check-bank-data` `check-bank-logos` `check-card-bin` `check-amounts` `check-salary-plan` |
| 卡与消费 | `check-card-limit` `check-card-secrets` `check-card-state` `check-card-bin-ui` `check-spend` `check-budgets` |
| 理财 | `check-wealth-products` `check-wealth-workspace` `check-wealth-redemption` `check-membership` |
| 账单与计划 | `check-bills-filter-ui` `check-payment-plans` `check-linked-plans` `check-categorize` |
| 网页 UI | `check-toggle` `check-tx-detail` `check-stale-data` `check-watermark` `check-responsive` `check-scroll-top` `check-motion` `check-motion-browser` `check-landing` `check-login` `check-registration-ui` `check-unified-site` `check-web-*` |
| 助手（Agent） | `check-agent-*` `check-ask` `check-image` `check-persona` `check-sessions` `check-message-actions` `check-markdown` `check-speech` `check-waveform` `check-voice` `check-model-fallbacks` `check-question-drafts` |
| IM 与客服 | `check-im-page-ui` `check-im-reminders-ui` `check-human-support` `check-support-guidance` |
| 员工端与运维 | `check-staff-*` `check-operations*` `check-ops-agent*` `check-deployed` `check-web-deployment` |
| 生成与打包 | `gen-bin-table` `gen-luckycat-logo` `gen-android-brand` `package-android-download` `publish-android-update` `shoot` `shoot-mobile-ui` |
| 测试基础设施 | `local-test-env` `ts-resolve-hook` `reset-demo` `wealth-ui-fixture` `api-methods.test` `legacy-sqlite-fixture-disabled`（拦截已停用的 SQLite 入口） |

新增脚本时保持三个习惯：文件名带 `check-` 前缀、在 [`docs/api/README.md`](../docs/api/README.md) 或本文补一行、失败时打印可执行的修复动作而不是只有堆栈。
