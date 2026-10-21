# 理财扩展 · 现金管理 / 投资与定投 / 保险保障

普通理财查询、资格与申赎见 [wealth.md](wealth.md)，全部虚构演示目录见 [理财产品目录](../product/wealth-products.md)。

对应 `app/src/api/contract.ts` 的 `wealth/cash-management`、`wealth/investments`、`wealth/insurance` 接口。

## Agent 产品对比

客户 Agent 新增只读工具 `bank_wealth_compare`，参数为 `firstProductCode`、`secondProductCode`（两个不同的当前目录代码）和可选正整数分 `amountCents`。复用已有产品列表及本人理财概览接口，不新增写接口。

返回两款产品的风险、发行方、期限、开放性、业绩基准及依据、净值日期、起购/追加金额、经常性和一次性费率；本人测评保留 `unassessed/expired/valid/unknown` 的区别。提供金额时按当前申购费率和金额规则估算费用与门槛，风险匹配不代表余额充足或申购获批。未知/重复产品、非整数金额、缺失或非法产品费率/风险/基准直接报错，不捏造产品、推荐排名或收益。

网页查询仍经原确认通道；有效绑定且正在执行的 IM 私聊可按只读白名单直接查询。申购、赎回和敏感信息的确认与验证不变，比较不产生持仓或扣款。实现：`framework/bridge/wealth-compare.mjs`、`bank-agent.mjs` 和 HTTP 工具定义。验证：`node --test framework/bridge/wealth-compare.test.mjs`；真实 Harness、本地银行和模型协议夹具的完整工具链包含在 `node tools/local-test-env.mjs agent` 中。

## 现金管理（活钱）

页面 `app/src/pages/CashManagementPage.tsx`，从「理财产品 → 现金管理」进入二级设置页；开关只保存规则，自动执行尚未开放。

| 方法 | 路径 | 请求 | 响应 |
| --- | --- | --- | --- |
| GET | `/api/wealth/cash-management` | — | `CashManagement` |
| PATCH | `/api/wealth/cash-management/sweep` | `CashSweepUpdate` | `CashManagement` |

`CashManagement`：`{ balance, totalYield, sevenDayYield, accountId, sweepEnabled, sweepThreshold, products }`

- `sevenDayYield`：7 日年化小数，如 `0.0219`。
- `sweepThreshold`：保存的活期保留金额（分）；当前没有超额资金自动转入执行器，不产生自动申购。
- `products`：`CashManagementProduct[]`，`{ id, name, sevenDayYield, minAmount, flexible }`。

`CashSweepUpdate` 字段全部可选：`enabled`、`threshold`、`accountId`。
错误：`INVALID_AMOUNT`（保留额为负）、`NOT_FOUND`。

## 投资与定投

页面 `app/src/pages/InvestPage.tsx`，嵌入 `/wealth/plans?tab=invest`；旧 `/wealth/investments` 兼容跳转。

| 方法 | 路径 | 请求 | 响应 |
| --- | --- | --- | --- |
| GET | `/api/wealth/investments` | — | `InvestmentsOverview` |
| POST | `/api/wealth/investments/plan` | `InvestPlanRequest` | `InvestPlan` |
| PATCH | `/api/wealth/investments/plan/:id` | `InvestPlanUpdate` | `InvestPlan` |

`InvestmentsOverview`：`{ holding, totalReturn, plans, products, executionMode: 'plan-only' }`。当前只保存和管理计划，未开放定时扣款执行器；不能把计划日期或 `active` 状态说成已预约执行、已申购、已冻结或已扣款。

- `InvestProduct`：`{ id, code, name, category, nav, risk, oneYearReturn, minAmount }`
  （`category`：`fund` / `etf` / `stock` / `robo`；`risk`：`low` / `medium` / `high`）。
- `InvestPlan`：`{ id, accountId?, productCode, productName, amount, cycle, nextRunAt, executedRuns, totalInvested, status, revision?, updatedAt?, createdAt }`。`status` 为 `active/paused/cancelled`，历史计划无版本时按 `revision=0` 处理；历史投资次数及金额不因管理计划而改写。

`InvestPlanRequest`：`{ productCode, amount, cycle, accountId, paymentPassword }`。需本人人民币资金账户、已开理财账户、有效风险测评且与产品 `low/medium/high` 匹配；不把这套目录的代码/风险标记与普通理财目录混用。周期支持 `每周/每两周/每月`，拟定日期分别从当前北京时间自然日加 7/14 天或一个日历月；月末按下一月最后一天收敛。修复了原来所有周期都填下月 8 日的问题，不重写已有计划日期。

`InvestPlanUpdate`：`{ status, expectedRevision, paymentPassword? }`。暂停、取消需用户确认；恢复 `active` 还需支付密码、本人账户及当前适当性。取消为终态，不能恢复；不赎回或退款。恢复时重算拟定日期，兼容已有“每月 8 日”等 1–28 日的锚点。版本不匹配返回 409，禁止悄悄覆盖同时发生的更改；未知字段不能更改金额或扣款账户。

创建和状态更新支持标准 `Idempotency-Key`：同一客户/键/路径/请求返回原回执，冲突复用返回 409。Agent 为每次授权生成稳定幂等键，密码只经确认页进入银行接口，不进入模型参数或返回值。网页状态按钮也显示确认窗口，恢复时输入支付密码。

Agent 工具：`bank_list_investments` 查询专用目录和本人计划（有效 IM 可直接查询）；`bank_create_invest_plan({productCode,accountId,amountCents,cycle})` 保存；`bank_update_invest_plan({planId,status})` 暂停/恢复/取消。写工具仍逐次确认，创建与恢复验密，并在执行前重新核对产品/计划快照，版本由服务端绑定。不得承诺自动扣款或未来收益。

错误含 `PRODUCT_NOT_FOUND`、`INVALID_AMOUNT`、`INVALID_CYCLE`、`INVALID_INVEST_PRODUCT`、`WEALTH_PREREQUISITE`、`RISK_MISMATCH`、`BAD_PAY_PASSWORD`、`INVEST_PLAN_NOT_FOUND`、`INVEST_PLAN_CHANGED`、`INVALID_PLAN_STATUS`、`INVALID_PLAN_TRANSITION`、`IDEMPOTENCY_CONFLICT`。live 模式未接入合作银行时仍返回不可用，不回退成本地模拟。

## 保险保障

页面 `app/src/pages/InsurancePage.tsx`。

| 方法 | 路径 | 请求 | 响应 |
| --- | --- | --- | --- |
| GET | `/api/wealth/insurance` | — | `InsuranceOverview` |
| POST | `/api/wealth/insurance/enroll` | `InsuranceEnrollRequest` | `InsurancePolicy` |

`InsuranceOverview`：`{ totalCoverage, policies, products }`

- `InsuranceProduct`：`{ id, name, category, insurer, premiumPerYear, coverage, highlight, tags }`。
- `InsurancePolicy`：`{ id, productName, insurer, premium, coverage, status, effectiveAt, expireAt, insuredName }`
  （`status`：`active` / `expired` / `pending`）。

`InsuranceEnrollRequest`：`{ productId, insuredName, paymentPassword? }`。
投保：保费扣账 + 落一笔台账流水 + 增加总保额。
错误：`PRODUCT_NOT_FOUND`、`VALIDATION_ERROR`（姓名为空）、`INSUFFICIENT_BALANCE`、`BAD_PAY_PASSWORD`。

## 网页理财中心与记录口径

五个入口：理财总览 `/wealth`、产品 `/wealth/products`、持仓 `/wealth/holdings`、储蓄与计划 `/wealth/plans`、交易记录 `/wealth/records`。保险仍保留 `/wealth/insurance`，导航移至「个人与安全」。

本次页面整合不变更银行写接口。交易记录调用已有 `listTransactions`，本人唯一资金账户、分类 `other`、关键字分别为 `申购 · ` / `赎回 · `，服务端分页；页码与类型进入 URL，不把旧页缓存显示为新查询。它是资金记账列表，不是理财订单，不能从此接口推算待确认资金、订单阶段或份额；目前理财结算为 CNY，不混入外币合计。详见 [理财中心说明](../product/wealth-workspace.md)。
