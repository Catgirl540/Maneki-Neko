# 理财扩展 · 现金管理 / 投资与定投 / 保险保障

对应 `app/src/api/contract.ts` 的 `wealth/cash-management`、`wealth/investments`、`wealth/insurance` 接口。

## 现金管理（活钱）

页面 `app/src/pages/CashManagementPage.tsx`。

| 方法 | 路径 | 请求 | 响应 |
| --- | --- | --- | --- |
| GET | `/api/wealth/cash-management` | — | `CashManagement` |
| PATCH | `/api/wealth/cash-management/sweep` | `CashSweepUpdate` | `CashManagement` |

`CashManagement`：`{ balance, totalYield, sevenDayYield, accountId, sweepEnabled, sweepThreshold, products }`

- `sevenDayYield`：7 日年化小数，如 `0.0219`。
- `sweepThreshold`：活期保留金额（分），超出部分自动转入货币基金。
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

`InvestPlanRequest`：`{ productCode, amount, cycle, accountId, paymentPassword? }`。
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
投保：保费扣账 + 落一笔台账流水 + 增加总保额。
错误：`PRODUCT_NOT_FOUND`、`VALIDATION_ERROR`（姓名为空）、`INSUFFICIENT_BALANCE`、`BAD_PAY_PASSWORD`。
