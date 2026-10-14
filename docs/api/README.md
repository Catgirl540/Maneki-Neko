# 招财猫银行 · 客户端接口文档（HTTP）

本目录是网页客户端（`app/`）与银行后端之间的**接口契约**说明。项目前后端分离：
客户端只依赖 `app/src/api/contract.ts` 的 `BankApi` 与 `routes` 路径表，
后端（`server/` + `framework/bridge/`）把同一份契约映射成 `/api/*`。

## 当前实现范围

本文描述代码中的接口，不是业务验收或线上部署清单。新增页面已经接入演示 HTTP 接口；后端复用 `app/src/api/mock/`，配置与模拟记录可落盘，但自动任务、完整资金流程与外部服务接入尚未完成。

- 存钱计划、工资、备用金、现金管理、定投：目前以样例查询、目标或配置保存为主，未实现自动归集、发薪、备用金借还、自动投资或定期执行。
- 会员、邀请：订阅状态与样例记录展示；未实现扣费续订、权益执行、邀请归因和奖励发放。
- OCR、活体：固定资料和直接通过的占位响应，没有上传识别或活体服务。
- 换汇、借款、保险：会修改演示账户余额和流水，但不代表锁价、审批、还款、承保等完整业务已完成。
- 一次性卡号、扩展卡限额：有类型与模拟接口；未接入支付授权及限额执行，扩展卡字段的 SQLite 持久化也未完成。

新增功能仍存在数据迁移、注册初始化及服务端校验问题，不能仅凭构建、路由检查通过认定可发布。员工端和助手是否支持办理，须另查各自工具与流程；这里的网页接口不自动成为助手工具。

## 单一事实源

- 路径与接口面：`app/src/api/contract.ts`（`routes` + `BankApi`）
- 请求 / 响应类型：`app/src/api/types.ts`
- HTTP 适配：`app/src/api/http.ts`
- 浏览器模拟 + 服务端复用：`app/src/api/mock/`
- 后端路由映射：`framework/bridge/demo-bank.mjs`（启动时核对路由表与模拟 API 方法集合）

改接口时，`types.ts → contract.ts → http.ts → mock → demo-bank.mjs` 必须一起改，
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
| 敏感操作 | 应满足「展示信息 → 用户确认 → 身份验证 → 执行」；新增演示接口尚未全部强制验证，不能用前端密码框或本表代替后端校验验收 |

### 通用错误码

| code | HTTP | 含义 |
| --- | --- | --- |
| `UNAUTHORIZED` | 401 | 登录态无效或过期 |
| `NOT_FOUND` | 404 | 资源不存在 |
| `ACCOUNT_NOT_FOUND` | 404 | 账户不存在 |
| `CARD_NOT_FOUND` | 404 | 银行卡不存在 |
| `PLAN_NOT_FOUND` | 404 | 会员套餐不存在 |
| `INVALID_AMOUNT` | 400 | 金额非法（≤0 等） |
| `INSUFFICIENT_BALANCE` | 400 | 可用余额不足 |
| `BAD_PAY_PASSWORD` | 400 | 支付密码错误 |
| `VALIDATION_ERROR` | 400 | 字段校验失败 |

## 端点索引

状态只描述接口当前能力：**演示接口** = HTTP 路由与模拟实现存在；**演示数据** = 返回样例档案；**配置保存** = 仅保存配置；**模拟资金操作** = 改动演示余额/流水；**占位核验** = 无真实识别或核身。以上均不等于完整业务已验收。未实现部分见各域说明和 [roadmap.md](./roadmap.md)。

### 1 身份与账户

| 方法 | 路径 | 说明 | 状态 |
| --- | --- | --- | --- |
| POST | `/api/auth/sms-code` | 发送短信验证码（演示回传 `demoCode`） | 演示接口 |
| POST | `/api/auth/login` | 登录（手机号 + 密码 + 短信码） | 演示接口 |
| POST | `/api/auth/register` | 注册并开立默认储蓄账户 | 演示接口 |
| POST | `/api/auth/logout` | 退出登录 | 演示接口 |
| GET | `/api/auth/profile` | 当前用户 | 演示接口 |
| POST | `/api/auth/phone` | 更换登录手机号（人脸 + 新号短信） | 演示接口 |
| GET | `/api/accounts` | 资金账户列表（多币种） | 演示接口 |
| GET | `/api/accounts/:id` | 单个账户 | 演示接口 |
| GET | `/api/accounts/:id/transactions` | 账户流水（分页；支持 `category` / `keyword` / `currency`） | 演示接口 |
| GET | `/api/accounts/:id/transactions/export` | 流水导出数据集 | 演示接口 |
| GET | `/api/transactions/:id` | 单笔交易详情（凭证） | 演示接口 |
| GET | `/api/transactions/:id/receipt` | 电子回单文件 | 演示接口 |
| POST | `/api/accounts/:id/deposit` | 转入 | 演示接口 |
| POST | `/api/exchange/quote` | 账户内换汇报价 | 演示报价（未锁价） |
| POST | `/api/exchange` | 执行账户内换汇 | 模拟资金操作 |

详见 [accounts.md](./accounts.md)。

### 2 存钱计划

| 方法 | 路径 | 说明 | 状态 |
| --- | --- | --- | --- |
| GET | `/api/savings/overview` | 目标 / 凑整规则 / 打卡 / 奖励总览 | 演示数据 |
| POST | `/api/savings/goals` | 新建目标 | 目标管理 |
| PATCH | `/api/savings/goals/:id` | 修改目标 | 目标管理 |
| DELETE | `/api/savings/goals/:id` | 删除目标 | 目标管理 |
| PATCH | `/api/savings/roundup` | 配置消费凑整转存 | 配置保存 |

详见 [savings.md](./savings.md)。

### 3 银行卡

| 方法 | 路径 | 说明 | 状态 |
| --- | --- | --- | --- |
| GET | `/api/cards` | 卡列表 | 演示接口 |
| GET | `/api/cards/products` | 可申请卡产品 | 演示接口 |
| POST | `/api/cards/open` | 申请新卡 | 演示接口 |
| POST | `/api/cards/:id/lock` | 锁卡 / 解锁 | 演示接口 |
| POST | `/api/cards/:id/replace` | 换卡 | 演示接口 |
| POST | `/api/cards/:id/secrets` | 查看卡安全码（需支付密码） | 演示接口 |
| PATCH | `/api/cards/:id/settings` | 消费开关与限额 | 演示接口 |
| POST | `/api/cards/:id/virtual` | 动态一次性卡号 | 模拟卡号（未接支付） |

详见 [cards.md](./cards.md)。

### 4 我的（邀请 / 会员 / 身份）

| 方法 | 路径 | 说明 | 状态 |
| --- | --- | --- | --- |
| GET | `/api/invitations` | 邀请码、好友进度、奖励 | 演示数据 |
| GET | `/api/membership` | 会员套餐与当前订阅 | 演示数据/订阅状态 |
| POST | `/api/membership/subscribe` | 开通 / 更换会员套餐 | 订阅状态保存（未扣费） |
| POST | `/api/membership/cancel` | 取消自动续费 | 订阅状态保存（无续费任务） |
| GET | `/api/identity/status` | 身份认证状态与开户验证进度 | 演示档案 |
| POST | `/api/identity/ocr` | 证件 OCR 识别 | 占位核验 |
| POST | `/api/identity/liveness` | 人脸活体核验 | 占位核验 |

详见 [profile.md](./profile.md)。

### 5 现有业务（摘要）

| 域 | 端点 | 状态 |
| --- | --- | --- |
| 转账 | `GET /api/banks`、`GET /api/receiving`、`POST /api/cards/bin`、`GET /api/payees`、`POST /api/fps/resolve`、`POST /api/transfers/quote`、`POST /api/transfers/recipient`、`POST /api/transfers`、`POST /api/transfers/:id/recall` | 演示接口 |
| 理财 | `GET /api/wealth/products`、`GET /api/wealth/products/:code`、`GET /api/wealth/overview`、`POST /api/wealth/account/open`、`GET /api/wealth/risk/questions`、`POST /api/wealth/risk/assess`、`POST /api/wealth/subscribe`、`POST /api/wealth/redeem` | 演示接口 |
| 财务分析 | `GET /api/analysis/spending`、`GET /api/analysis/cashflow`、`GET /api/autodebits`、`PATCH /api/autodebits/:id` | 演示接口 |
| 安全中心 | `GET /api/security/overview`、`PATCH /api/security/rules/:id`、`POST /api/security/password`、`POST /api/security/verify` | 演示接口 |
| 智能客服 | `GET /api/support/messages`、`POST /api/support/chat` | 演示接口 |

### 6 工资与备用金

| 方法 | 路径 | 说明 | 状态 |
| --- | --- | --- | --- |
| GET | `/api/cashflow/salary` | 工资入账计划与到账预测 | 演示数据/配置保存 |
| PATCH | `/api/cashflow/salary` | 设置发薪日与预计月薪 | 演示数据/配置保存 |
| GET | `/api/cashflow/overdraft` | 备用金额度与占用 | 演示数据 |
| POST | `/api/cashflow/overdraft/activate` | 开通 / 关闭备用金 | 开关保存（无借还流程） |

详见 [cashflow.md](./cashflow.md)。

### 7 借款与分期

| 方法 | 路径 | 说明 | 状态 |
| --- | --- | --- | --- |
| GET | `/api/credit/overview` | 额度 / 产品 / 借款 / 分期 / 信用培养 | 演示数据 |
| POST | `/api/credit/loans/apply` | 申请借款 | 模拟放款（无审批/还款） |
| POST | `/api/credit/installments/:transactionId/plan` | 消费转分期 | 分期记录保存（无还款） |

详见 [credit.md](./credit.md)。

### 8 理财扩展（现金管理 / 投资与定投 / 保险）

| 方法 | 路径 | 说明 | 状态 |
| --- | --- | --- | --- |
| GET | `/api/wealth/cash-management` | 活钱余额 / 7 日年化 / 自动转入 | 演示数据 |
| PATCH | `/api/wealth/cash-management/sweep` | 设置活期保留额 | 配置保存 |
| GET | `/api/wealth/investments` | 持有市值 / 定投计划 / 可投产品 | 演示数据 |
| POST | `/api/wealth/investments/plan` | 新建定投计划 | 计划保存（无执行任务） |
| GET | `/api/wealth/insurance` | 保单 / 可投保产品 | 演示数据 |
| POST | `/api/wealth/insurance/enroll` | 投保 | 模拟扣费/保单记录 |

详见 [wealth-ext.md](./wealth-ext.md)。

### 9 待完成与远期规划

现有演示域尚缺的迁移、校验、自动任务和完整资金流程，以及未接入的线上按揭、加密资产建议端点，见 [roadmap.md](./roadmap.md)。建议端点尚未进入当前契约。

## 后端实现说明

- 后端是**演示桥接**：`framework/bridge/demo-bank.mjs` 直接复用前端 mock 的业务逻辑（Node 运行时转译 TS），
  数据落 SQLite（`server/data/bank.sqlite`）。因此「接口契约」一处定义，前端 mock 与服务端同源。
- 启动检查核对路由表与模拟 API 方法集合；`tools/check-contract.mjs` 另行静态核对契约、HTTP 与 mock。它们不能证明业务正确、数据隔离、金额安全或定时任务存在。
- 会话：`server/index.mjs` 维护内存 `sessions`（Bearer token，默认 12 小时）；重启后需重新登录。
