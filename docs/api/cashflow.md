# 工资与备用金

对应 `app/src/api/contract.ts` 的 `cashflow/*` 接口，页面 `app/src/pages/CashflowPage.tsx`。

## 工资入账计划

| 方法 | 路径 | 请求 | 响应 |
| --- | --- | --- | --- |
| GET | `/api/cashflow/salary` | — | `SalaryPlan` |
| PATCH | `/api/cashflow/salary` | `SalaryUpdate` | `SalaryPlan` |

`SalaryPlan`：`{ salaryDay, amount, employer, accountId, nextPayday, history }`

| 字段 | 说明 |
| --- | --- |
| `salaryDay` | 每月发薪日，1–28 |
| `amount` | 预计月薪（分） |
| `employer` | 发薪单位 |
| `accountId` | 入账账户 |
| `nextPayday` | 下次发薪日 `YYYY-MM-DD` |
| `history` | `SalaryRecord[]`，`{ id, month, amount, paidAt }` |

`SalaryUpdate` 字段全部可选：`salaryDay`、`amount`、`accountId`、`employer`。
错误：`INVALID_SALARY_DAY`（发薪日越界）、`INVALID_AMOUNT`、`NOT_FOUND`（账户不存在）。

## 备用金

| 方法 | 路径 | 请求 | 响应 |
| --- | --- | --- | --- |
| GET | `/api/cashflow/overdraft` | — | `OverdraftFacility` |
| POST | `/api/cashflow/overdraft/activate` | `{ active: boolean }` | `OverdraftFacility` |

`OverdraftFacility`：`{ active, creditLimit, used, available, apr, activatedAt, interestNote }`
（`apr` 为年化利率小数，如 `0.058`；`interestNote` 为计息口径说明）。

错误：`OVERDRAFT_IN_USE`（尚有未还清备用金时不能关闭）。
