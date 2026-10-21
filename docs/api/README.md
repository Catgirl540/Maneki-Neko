# 招财猫银行 · 客户端接口文档（HTTP）

微信、企业微信机器人与银行助手接入见 [IM 接入说明](im-agent.md)。

本目录是网页客户端（`app/`）与银行后端之间的**接口契约**说明。项目前后端分离：
客户端只依赖 `app/src/api/contract.ts` 的 `BankApi` 与 `routes` 路径表，
后端（`server/` + `framework/bridge/`）把同一份契约映射成 `/api/*`。

账户、币种余额与银行卡的关系以 [账户模型约束](../product/account-model.md) 为准；分区 ID 不代表独立开户。

## 单一事实源

- 路径与接口面：`app/src/api/contract.ts`（`routes` + `BankApi`）
- 请求 / 响应类型：`app/src/api/types.ts`
- HTTP 适配：`app/src/api/http.ts`
- 浏览器模拟：`app/src/api/mock/`；服务端业务：`server/domain/`；单账户纯规则：`shared/account-model.mjs`
- 后端路由映射：`server/bank-api.mjs`（启动时断言 `ROUTES` 与 `BankApi` 双向对齐）；`framework/bridge/demo-bank.mjs` 仅保留历史独立演示入口

改接口时，`types.ts → contract.ts → http.ts → mock → server/api/contract.mjs → server/domain/ → server/bank-api.mjs` 必须一起核对，
再更新本目录与根 `README.md` 的接口清单；`node tools/check-contract.mjs`、`node tools/check-routes.mjs` 用于校验一致性。

## 基本约定

| 项 | 约定 |
| --- | --- |
| Base URL | 本地留空（走 Vite `/api` 代理到 `http://127.0.0.1:8080`）；线上部署在 `/bank/` 时为 `/bank` |
| 鉴权 | 请求头 `Authorization: Bearer <token>`；登录/注册/短信接口除外。401 且 `code=UNAUTHORIZED` 表示登录态失效 |
| 内容类型 | `application/json; charset=utf-8` |
| 金额 | 整数「分」（`Cents`）；不要传格式化字符串 |
| 币种 | ISO 4217：`CNY` / `USD` / `HKD` |
| 时间 | ISO 8601 字符串（如 `2026-10-12T08:30:00.000Z`） |
| 分页 | 查询 `page`（从 1 开始）、`size`；响应 `Paged<T> = { items, page, size, total }` |
| 错误 | 非 2xx 返回 `{ message, code }`；客户端统一抛 `ApiError(status, code)` |
| 敏感操作 | 保留「展示信息 → 用户确认 → 身份验证（支付密码 / 人脸 / 短信）→ 执行」四步；前端守卫不替代后端鉴权 |

备用 `POST /api/support/chat` 返回 `canned=true` 时只提供固定页面引导；没有调用模型、实时查询金融数据或执行业务，不代表余额/当前利率查询、转账到账、锁卡、停用签约或人工工单受理。实现由 `shared/support-guidance.mjs` 供后端与浏览器模拟共用；真实助手通道仍按确认/验密及银行回执办理。

### 通用错误码

| code | HTTP | 含义 |
| --- | --- | --- |
| `UNAUTHORIZED` | 401 | 登录态无效或过期 |
| `NOT_FOUND` | 404 | 资源不存在 |
| `ACCOUNT_NOT_FOUND` | 404 | 账户不存在 |
| `CARD_NOT_FOUND` | 404 | 银行卡不存在 |
| `CARD_NETWORK_LIMIT` | 409 | 同卡组织已持有在用卡（每个卡组织至多一张） |
| `INVALID_AMOUNT` | 400 | 金额非法（≤0 等） |
| `INSUFFICIENT_BALANCE` | 400 | 可用余额不足 |
| `BAD_PAY_PASSWORD` | 400 | 支付密码错误 |
| `VALIDATION_ERROR` | 400 | 字段校验失败 |

## 端点索引

图例：**已实现** = 当前前后端已落地；**规划中** = 契约已设计、尚未实现（见 `roadmap.md`）。

### 1 身份与账户

| 方法 | 路径 | 说明 | 状态 |
| --- | --- | --- | --- |
| POST | `/api/auth/sms-code` | 发送短信验证码（演示回传 `demoCode`） | 已实现 |
| POST | `/api/auth/login` | 登录（手机号 + 密码 + 短信码） | 已实现 |
| POST | `/api/auth/register` | 注册并开立默认储蓄账户 | 已实现 |
| POST | `/api/auth/logout` | 退出登录 | 已实现 |
| GET | `/api/auth/profile` | 当前用户 | 已实现 |
| PATCH | `/api/auth/phone` | 更换登录手机号（人脸 + 新号短信） | 已实现 |
| GET | `/api/accounts` | 资金账户列表（多币种） | 已实现 |
| GET | `/api/accounts/:id` | 单个账户 | 已实现 |
| GET | `/api/accounts/:id/transactions` | 账户流水（分页；支持 `category` / `keyword` / `currency` / `direction` / `from` / `to`；支出分类由服务端自动归类，见 [accounts.md](accounts.md)） | 已实现 |
| GET | `/api/accounts/:id/transactions/export` | 流水导出数据集（与列表同口径的 `category` / `keyword` / `currency` / `direction` / `from` / `to`） | 已实现 |
| GET | `/api/transactions/:id` | 单笔交易详情（凭证） | 已实现 |
| GET | `/api/transactions/:id/receipt` | 电子回单文件 | 已实现 |
| POST | `/api/accounts/:id/deposit` | 转入 | 已实现 |
| POST | `/api/exchange/quote` | 账户内换汇报价 | 已实现 |
| POST | `/api/exchange` | 执行账户内换汇 | 已实现 |

详见 [accounts.md](./accounts.md)。

### 2 存钱计划

| 方法 | 路径 | 说明 | 状态 |
| --- | --- | --- | --- |
| GET | `/api/savings/overview` | 目标 / 凑整规则 / 打卡 / 奖励总览 | 已实现 |
| POST | `/api/savings/goals` | 新建目标 | 已实现 |
| PATCH | `/api/savings/goals/:id` | 修改目标 | 已实现 |
| DELETE | `/api/savings/goals/:id` | 删除目标 | 已实现 |
| PATCH | `/api/savings/roundup` | 配置消费凑整转存 | 已实现 |

详见 [savings.md](./savings.md)。

### 3 银行卡

| 方法 | 路径 | 说明 | 状态 |
| --- | --- | --- | --- |
| GET | `/api/cards` | 卡列表 | 已实现 |
| GET | `/api/cards/products` | 可申请卡产品 | 已实现 |
| POST | `/api/cards/open` | 申请新卡 | 已实现 |
| POST | `/api/cards/:id/lock` | 锁卡 / 解锁 | 已实现 |
| POST | `/api/cards/:id/replace` | 换卡 | 已实现 |
| POST | `/api/cards/:id/secrets` | 查看卡安全码（需支付密码） | 已实现 |
| PATCH | `/api/cards/:id/settings` | 消费开关与限额 | 已实现 |
| POST | `/api/cards/:id/virtual` | 动态一次性卡号 | 已实现 |

详见 [cards.md](./cards.md)。

### 4 我的（邀请 / 会员 / 身份）

| 方法 | 路径 | 说明 | 状态 |
| --- | --- | --- | --- |
| GET | `/api/invitations` | 邀请码、好友进度、奖励 | 已实现 |
| GET | `/api/membership` | 会员中心：等级 / 月均 AUM / 权益 / 贵宾厅额度 | 已实现 |
| POST | `/api/membership/lounge-pass` | 核销一次机场 / 高铁贵宾厅额度（年度次数） | 已实现 |

详见 [profile.md](./profile.md)。

### 5 现有业务（摘要）

| 域 | 端点 | 状态 |
| --- | --- | --- |
| 转账 | `GET /api/banks`、`GET /api/receiving`、`POST /api/cards/bin`、`GET /api/payees`、`POST /api/fps/resolve`、`POST /api/transfers/quote`、`POST /api/transfers/recipient`、`POST /api/transfers`、`POST /api/transfers/:id/recall` | 已实现 |
| 理财 | `GET /api/wealth/products`、`GET /api/wealth/products/:code`、`GET /api/wealth/overview`、`POST /api/wealth/account/open`、`GET /api/wealth/risk/questions`、`POST /api/wealth/risk/assess`、`POST /api/wealth/subscribe`、`POST /api/wealth/redeem` | 已实现 |
| 财务分析 | `GET /api/analysis/spending`、`GET /api/analysis/cashflow`、`GET /api/autodebits`、`PATCH /api/autodebits/:id` | 已实现 |
| 安全中心 | `GET /api/security/overview`、`PATCH /api/security/rules/:id`、`POST /api/security/password`、`POST /api/security/payment-password`、`POST /api/security/verify` | 已实现 |
| 智能客服 | `GET /api/support/messages`、`POST /api/support/chat` | 已实现 |

普通理财字段、申赎和实现限制见 [wealth.md](wealth.md)，虚构产品参数见 [理财产品目录](../product/wealth-products.md)。

自动扣款字段、Agent 续费清单的自然日范围、金额口径和限制见 [autodebits.md](./autodebits.md)。

### 6 工资与备用金

| 方法 | 路径 | 说明 | 状态 |
| --- | --- | --- | --- |
| GET | `/api/cashflow/salary` | 工资入账计划与到账预测 | 已实现 |
| PATCH | `/api/cashflow/salary` | 设置发薪日与预计月薪 | 已实现 |
| GET | `/api/cashflow/overdraft` | 备用金额度与占用 | 已实现 |
| POST | `/api/cashflow/overdraft/activate` | 开通 / 关闭备用金 | 已实现 |

详见 [cashflow.md](./cashflow.md)。

### 7 借款与分期

| 方法 | 路径 | 说明 | 状态 |
| --- | --- | --- | --- |
| GET | `/api/credit/overview` | 额度 / 产品 / 借款 / 分期 / 信用培养 | 已实现 |
| POST | `/api/credit/loans/apply` | 申请借款 | 已实现 |
| POST | `/api/credit/installments/:transactionId/plan` | 消费转分期 | 已实现 |

详见 [credit.md](./credit.md)。

### 8 理财扩展（现金管理 / 投资与定投 / 保险）

| 方法 | 路径 | 说明 | 状态 |
| --- | --- | --- | --- |
| GET | `/api/wealth/cash-management` | 活钱余额 / 7 日年化 / 自动转入 | 已实现 |
| PATCH | `/api/wealth/cash-management/sweep` | 设置活期保留额 | 已实现 |
| GET | `/api/wealth/investments` | 持有市值 / 定投计划 / 可投产品 | 已实现 |
| POST | `/api/wealth/investments/plan` | 新建定投计划 | 已实现 |
| PATCH | `/api/wealth/investments/plan/:id` | 暂停 / 恢复 / 取消本人定投计划；版本检查 | 已实现（仅管理计划，自动扣款未开放） |
| GET | `/api/wealth/insurance` | 保单 / 可投保产品 | 已实现 |
| POST | `/api/wealth/insurance/enroll` | 投保 | 已实现 |

详见 [wealth-ext.md](./wealth-ext.md)。

### 9 人工服务

客户人工服务使用当前客户 Bearer，不使用员工令牌或共享 Agent 密钥。`server/support-api.mjs` 将请求写入同一套员工工单表；仅客户主动提交的公开工单可从客户接口读取。

- `POST /api/support/tickets`：`{requestId, reason, transcript?}`，问题最多 500 字；可选最近 20 条文字摘要，每条最多 2000 字，不收图片。
- `GET /api/support/tickets?page=1`：返回 `Paged<SupportTicket>`，固定每页 20 条。
- `GET /api/support/tickets/:id`：本人公开工单、状态及双向留言，不含员工审计、负责人或审批字段。
- `POST /api/support/tickets/:id/messages`：`{requestId, text}`，留言最多 2000 字；已解决工单返回 `409 TICKET_CLOSED`。

写请求编号须为 16–100 位字母、数字、下划线或连字符。同一客户的相同请求编号与内容重试不会重复建单／留言；编号用于其他内容时返回 `409 REQUEST_CONFLICT`。客户身份和留言发送人均由登录态确定。常见敏感数字在摘要与客户留言中隐藏；密码、验证码与 CVV 不应提交。

状态为 `open`（等待受理）、`processing`（处理中）、`waiting`（待客户补充）、`suspended`（已暂停）、`resolved`（已解决）。客户回复 `waiting` 工单后自动回到 `processing`。页面打开时每 3 秒检查更新，不提供即时接通、固定响应时间或离线推送保证。

Agent 共用以上客户接口，提供 `bank_request_human_support`、`bank_list_support_tickets`、`bank_get_support_ticket`、`bank_reply_support_ticket`，均需确认；转人工不要求支付密码。手动入口不依赖 Agent 在线。验证：`node tools/check-human-support.mjs --browser`，使用临时银行和本地模型协议。真实模型抽查可显式运行 `node tools/check-human-support-live.mjs`，需要进程环境密钥且会产生少量模型费用；仅创建临时本地验收工单。

### 10 规划中（契约已设计，尚未实现）

线上按揭申请与进度；加密资产兑换 / 托管 / Staking（合规与风控未就绪）。详见 [roadmap.md](./roadmap.md)。

## 后端实现说明

- 当前入口 `server/index.mjs` 通过 `server/bank-api.mjs` 运行 `server/domain/` 业务，使用 PostgreSQL；`framework/bridge/demo-bank.mjs` 是历史独立演示入口，不能作为当前存储和部署依据。
- 服务启动时校验后端路由与契约双向对齐；新增接口须同步核对客户端与服务端，不能只修改本说明。
- 客户 Bearer 会话由 `server/customer-auth.mjs` 管理，令牌哈希持久化于 `customer_sessions`，默认有效期 12 小时；服务重启不会仅因内存清空而使未过期会话失效，撤销和到期以数据库状态为准。
- 业务“已实现”指当前契约与演示/服务端路径存在，不表示合作银行、真实产品发行、行情或交易清算已接入。接入模式与不可用行为见 [后端维护说明](../../server/README.md)。
