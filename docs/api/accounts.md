# 账户域 · 身份、账户、流水、换汇

对应 `app/src/api/contract.ts` 中的登录 / 账户 / 流水 / `exchange*` 接口。

## 登录（三步校验）

`POST /api/auth/login` → `{ token, user }`

```json
{ "phone": "13800138000", "password": "123456", "smsCode": "000000" }
```

- `phone`：11 位；`smsCode` 需先调 `POST /api/auth/sms-code`（演示回传 `demoCode`）。
- 失败：`UNAUTHORIZED`（账号或密码错误 / 验证码错误）。

`POST /api/auth/sms-code` → `{ sent: true, demoCode: "000000" }`（演示环境才回传 `demoCode`）。

## 账户列表（多币种）

`GET /api/accounts` → `Account[]`

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | string | 账户 ID |
| `accountNo` | string | 卡号（前端只展示尾号） |
| `label` | string | 账户名 |
| `currency` | `'CNY'\|'USD'\|'HKD'` | 币种 |
| `type` | string | 账户类型 |
| `balance` | Cents | 余额（分） |

> 多币种对账：`Account.currency` 即权威币种；`formatCurrency(balance, currency)` 渲染。

## 流水（分页 / 筛选）

`GET /api/accounts/:id/transactions?page=1&size=20&category=all&keyword=&currency=all`

→ `Paged<Transaction> = { items, page, size, total }`

| 查询参数 | 说明 |
| --- | --- |
| `page` / `size` | 分页，`page` 从 1 开始 |
| `category` | 交易分类，`all` 表示不限 |
| `keyword` | 备注 / 对手方关键字 |
| `currency` | **多币种对账**：按币种筛选，`all` 表示不限 |

## 单笔交易详情 / 回单

- `GET /api/transactions/:id` → `TransactionRecord`（交易编号、渠道、汇率、前后余额等凭证要素）。
- `GET /api/transactions/:id/receipt` → `ReceiptFile`；演示环境 `url=null`，需退回浏览器打印。
- `GET /api/accounts/:id/transactions/export` → `ExportDataset`（后端给列与格式化值，前端落 CSV）。

## 转入

`POST /api/accounts/:id/deposit` → `Account`（金额为整数分）

```json
{ "amount": 100000, "channel": "demo" }
```

## 账户内换汇

两步：先报价锁价，再凭支付密码执行。

### 报价

`POST /api/exchange/quote` → `ExchangeQuote`

```json
{ "fromAccountId": "acc_0001", "toCurrency": "USD", "amount": 100000 }
```

| 响应字段 | 说明 |
| --- | --- |
| `fx` | `FxQuote`：汇率、点差、锁价有效期等（口径同转账报价） |
| `toAccountNo` | 目标币种账户；**不存在时后端返回「将自动开立」并自动开立同币种子账户** |
| `toAvailableAfter` | 换汇后目标账户可用余额（预估） |

### 执行

`POST /api/exchange` → `ExchangeResult`

```json
{ "fromAccountId": "acc_0001", "toCurrency": "USD", "amount": 100000, "paymentPassword": "888888" }
```

| 响应字段 | 说明 |
| --- | --- |
| `transactionId` / `referenceNo` | 交易 ID / 业务参考号 |
| `fromAccountId` / `toAccountId` | 扣账 / 入账账户 |
| `fx` | 成交汇率 |
| `createdAt` | 成交时间 |

错误：`ACCOUNT_NOT_FOUND`（扣账账户不存在）、`INVALID_AMOUNT`、`INSUFFICIENT_BALANCE`、`BAD_PAY_PASSWORD`。
