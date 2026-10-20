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

## 唯一资金账户与多币种余额

`GET /api/accounts` → `Account[]`。本地实现返回一个资金账户，多张银行卡关联同一 `id`。

`currencyBalances` 是该账户下的币种记账分区，每项包含 `id`、`currency`、`balance`、`available` 等字段，共享同一个 `accountNo`。分区 `id` 用于兼容既有流水和换汇接口，不代表另外开立账户。不同币种金额不得直接相加。

PostgreSQL 档案 v20 保留退役账本行。旧分区 ID 和旧账号仍可解析到当前归属；历史交易的 SQL 原始关联与回单账号快照保留，读取时返回当前 `accountId` 及可选的 `legacyAccountId`。首次换汇只初始化币种余额，跨币种 FPS 按确认报价贷记收款人的登记币种分区。

员工客户档案的 `accounts[].currencyBalances` 与 `recentTransactions[].currency` 指明金额币种；显示外币不得加人民币符号。未提供交易币种的旧客户端夹具仍按原人民币契约兼容。

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | string | 账户 ID |
| `accountNo` | string | 银行账户号，与银行卡号分开 |
| `label` | string | 账户名 |
| `currency` | `'CNY'\|'USD'\|'HKD'` | 币种 |
| `kind` | string | 账户类型 |
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

`Transaction.category` 由服务端在记账时确定：`salary`、`transfer` 与带 `businessType` 的流水（如账户内换汇）按业务语义写死；其余支出流水经 OpenRouter 决策模型自动归类（见 [服务端说明](../../server/README.md#交易自动分类)），超时或响应无效时回落 `other`。客户端和助手都不能手动改分类，回落 `other` 不等于交易未发生。

### Agent 流水样本核查

`bank_review_transactions({ accountId, limit? })` 复用本人账户及上述第一页接口，默认 100 条，上限为 20–200 的整数。不新增银行写接口，不读取其他客户。旧币种分区 ID 经本人账户接口解析，实际使用返回的归属 ID 和权威币种，输出不直接合计外币。

结果含 `scope=owned-account-transaction-sample`、币种、实际 `asOf`、北京时间说明，以及 `coverage`（请求上限、返回条数、银行总数、截断标志、有效记录的实际时间范围、纳入/排除数量）。数组顺序取决于银行返回，不能声称样本一定是最近记录；即使未截断，也不据此声称覆盖完整年度或所有外部银行交易。

仅纳入 `success/out` 且正金额的餐饮、购物、住房、交通、订阅记录。收入、零金额、在途/失败、转账、工资及 `other` 不作异常消费依据；无效/缺时区/未来日期明确排除。金额与 signedAmount、归属、币种、重复编号或分页结构不一致时报错，不补造金额。

规则：同账户币种、同商户（去首尾空白、忽略大小写）、同金额的记录，在以首笔为锚的 300 秒窗口内至少两笔时列为重复候选；不把相邻 5 分钟无限串成长时段。金额突增仅与同商户**严格早于该笔**的前 90 天样本比较：至少 3 笔且跨 3 个北京时间自然日，当前金额至少 10,000 分且不低于历史中位数 3 倍。规则是本地核查启发式，不是银行欺诈评分或订阅合同识别。

`duplicateCandidates/amountSpikeCandidates` 附真实交易编号、金额、时间和先前样本依据；各类最多返回 20 组，单项最多 5 条证据，超出时分别标明截断和实际候选数量。零候选不能保证安全，有候选也不能认定重复收费、欠费或欺诈。进一步核对可用原交易详情/人工服务；核查不锁卡、退款、取消订阅或报案。IM 有效绑定可直接只读查询，网页仍走原查询确认。

实现与验证：`framework/bridge/transaction-review.mjs`、同名规则测试、`im-query.test.mjs` 和实际 Harness 本地银行夹具 `tools/check-agent-http.mjs`。

## 单笔交易详情 / 回单

- `GET /api/transactions/:id` → `TransactionRecord`（交易编号、渠道、汇率、前后余额等凭证要素）。
- `GET /api/transactions/:id/receipt` → `ReceiptFile`；演示环境 `url=null`，需退回浏览器打印。
- `GET /api/accounts/:id/transactions/export` → `ExportDataset`（后端给列与格式化值，前端落 CSV）。

## 在途转账与撤销

转账返回 `settlementStatus=pending,pendingReason=inflight,holdUntil` 时，尚未扣余额，已从实际付款币种可用余额预留本金和手续费。它不是用户设定日期的定时转账；`pending/clearing` 则已扣款，仅等待清算状态更新，不能按在途指令撤销。

`POST /api/transfers/:id/recall`（本人登录，空请求体）只接受仍在有效窗口内的本人在途指令，返回 `{transactionId,status,memo}`。撤销和员工拦截只释放本笔 `heldFrozenAmount`，历史缺此字段时按当时只冻结的本金 `amount` 兼容；释放回原 CNY/USD/HKD 分区，旧 ID 经资金账户映射解析，其他冻结保持不变。回单保留编号和撤销原因，`status=failed` 不等于扣款后退款。窗口到点或员工放行会先释放同一预留，再按原交易身份与已确认条件实际扣本金/费用；持久化失败整个业务回滚，审批保持待处理，不能报成功。

Agent 的 `bank_recall_transfer` 仍逐次确认，无需支付密码，有效 IM 只读权限不能自动批准撤销。确认卡用本人账户权威币种显示本金、冻结合计和记录的费用，历史未记费用时明确说明。执行前重读交易/币种；快照变化、过期、清算/已结算/拦截/撤回、跨客户均拒绝，不自动重做。错误包括 `NOT_FOUND`、`NOT_RECALLABLE`、`CONSENT_REQUIRED`；不能把撤销在途等同于取消定时转账任务。

验证：`server/transfer-hold-currency.test.mjs` 用真实隔离 PostgreSQL 和实际换汇/转账核对多币种同时冻结、撤销、员工拦截/放行、费用注入失败回滚与重试；`framework/bridge/transfer-recall.test.mjs` 覆盖 Agent 原币种确认、一次性授权、状态重读、客户隔离、非法金额和历史指令。本地整合门禁必须包含外币冻结回归。

本次修复待处理指令的解冻查找，不批量修正历史已结单可能遗留的冻结。历史余额与可用余额的差额可能包含其他有效预留，需依据原指令及账务逐笔核对，不能直接抹平差额；本轮未读取远程库确认是否存在此类记录。

## 收支统计

`GET /api/analysis/spending?month=YYYY-MM`（省略为当前北京时间月份）返回所选月成功支出、分类及截至该月的 6 个月走势。顶层兼容 CNY，`byCurrency.CNY/USD/HKD` 分别返回相同结构，金额为各币种分，不直接相加。普通转账仍计入支出，账户内换汇排除。

`previousMonth/previousTotal` 为所选月的上一个完整月；`monthOverMonthComparable=false` 表示无可比支出基数，兼容字段 `monthOverMonth=0` **不能**解释成 0% 变化。`periodStatus=complete/partial/future` 区分过去、本月及未来月，本月仅截至查询时点，和上月全月比较，并非等天数环比。

`GET /api/analysis/cashflow?days=7` 返回最近 1–366 个自然日（含今天）的每日收支和总额，网页及 Agent 支持 7/30 天。独立于支出月份。包含成功交易与 `pending/clearing`，其他在途及失败不计；排除账户内换汇，普通转账仍纳入。币种结构同上。

两种统计统一 `timeZone=Asia/Shanghai`、`asOf`（实际查询截止时间 ISO）；`ignoredDates={invalidDate,futureDate}` 是本币种符合相应状态/方向规则的全部来源记录中，因日期无效（含缺时区）或晚于查询时点而排除的数量，不限于所选窗口。不得把未来流水计入已发生收支。非法金额或安全整数溢出报错，不补零。顶层和分币种快照使用同一查询时点。

桌面 `/analysis/statistics` 支持月份与币种切换、现金流 7/30 天切换；查询失败显示重试，不能以旧月份结果或另一币种代替。共享规则由后端和浏览器模拟复用，`server/statistics.test.mjs` 覆盖跨时区、跨日/月、无基数、记录状态及金额安全。

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
| `toAccountNo` | 唯一资金账户号；缺少目标币种时仅初始化该币种余额，不另行开户 |
| `toAvailableAfter` | 换汇后目标币种可用余额（预估） |

### 执行

`POST /api/exchange` → `ExchangeResult`

```json
{ "fromAccountId": "acc_0001", "toCurrency": "USD", "amount": 100000, "quoteId": "报价返回的 quoteId", "paymentPassword": "888888" }
```

| 响应字段 | 说明 |
| --- | --- |
| `transactionId` / `referenceNo` | 交易 ID / 业务参考号 |
| `fromAccountId` / `toAccountId` | 扣账 / 入账记账分区 ID（保留原接口字段名） |
| `fx` | 成交汇率 |
| `createdAt` | 成交时间 |

错误：`ACCOUNT_NOT_FOUND`（扣账账户不存在）、`INVALID_AMOUNT`、`INSUFFICIENT_BALANCE`、`BAD_PAY_PASSWORD`。
