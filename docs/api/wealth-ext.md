# 理财扩展 · 现金管理 / 投资与定投 / 保险保障

对应 `app/src/api/contract.ts` 的 `wealth/cash-management`、`wealth/investments`、`wealth/insurance` 接口。

## 当前能力

现金管理与投资总览返回演示余额/持仓、收益及产品；自动转入仅保存开关与阈值，定投仅保存计划，没有实际扣款买入、份额登记、收益计算或定时执行。投保会扣除演示账户保费并新增模拟保单，没有核保、条款签署、承保对接、续期或理赔流程。

## 现金管理（配置保存）

页面 `app/src/pages/CashManagementPage.tsx`。

| 方法 | 路径 | 请求 | 响应 |
| --- | --- | --- | --- |
| GET | `/api/wealth/cash-management` | — | `CashManagement` |
| PATCH | `/api/wealth/cash-management/sweep` | `CashSweepUpdate` | `CashManagement` |

`CashManagement`：`{ balance, totalYield, sevenDayYield, accountId, sweepEnabled, sweepThreshold, products }`

- `sevenDayYield`：7 日年化小数，如 `0.0219`。
- `sweepThreshold`：保存的活期保留金额（分）；当前不会自动转入货币基金。
- `products`：`CashManagementProduct[]`，`{ id, name, sevenDayYield, minAmount, flexible }`。

`CashSweepUpdate` 字段全部可选：`enabled`、`threshold`、`accountId`。
错误：`INVALID_AMOUNT`（保留额为负）、`NOT_FOUND`。

## 投资与定投

页面 `app/src/pages/InvestPage.tsx`。

| 方法 | 路径 | 请求 | 响应 |
| --- | --- | --- | --- |
| GET | `/api/wealth/investments` | — | `InvestmentsOverview` |
| POST | `/api/wealth/investments/plan` | `InvestPlanRequest` | `InvestPlan` |

`InvestmentsOverview`：`{ holding, totalReturn, plans, products }`

- `InvestProduct`：`{ id, code, name, category, nav, risk, oneYearReturn, minAmount }`
  （`category`：`fund` / `etf` / `stock` / `robo`；`risk`：`low` / `medium` / `high`）。
- `InvestPlan`：`{ id, productCode, productName, amount, cycle, nextRunAt, executedRuns, totalInvested, status, createdAt }`。

`InvestPlanRequest`：`{ productCode, amount, cycle, accountId, paymentPassword? }`。当前只保存记录，未绑定扣款账户或按周期执行；支付密码可省略、未检查理财开户与测评状态，均待补齐。
错误：`PRODUCT_NOT_FOUND`、`INVALID_AMOUNT`（低于起投额）、`BAD_PAY_PASSWORD`。

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
模拟投保：保费扣账 + 台账流水 + 增加档案总保额；使用当前理财结算账户，未开理财户时回退首个账户。当前省略支付密码可跳过校验，不能视为支持免密投保。
错误：`PRODUCT_NOT_FOUND`、`VALIDATION_ERROR`（姓名为空）、`INSUFFICIENT_BALANCE`、`BAD_PAY_PASSWORD`。
