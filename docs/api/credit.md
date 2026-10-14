# 借款与分期

对应 `app/src/api/contract.ts` 的 `credit/*` 接口，页面 `app/src/pages/CreditPage.tsx`。

## 当前能力

总览含演示额度、产品、借款与信用分。申请借款会直接减少模拟授信并向指定演示账户入账，没有审批流程；消费转分期只新增记录，没有资金重分类、还款、扣款或逾期处理。当前存在密码可省略、金额/期数校验不完整和重复办理问题，未完成业务验收。

## 总览

`GET /api/credit/overview` → `CreditOverview`

| 字段 | 说明 |
| --- | --- |
| `creditLimit` / `availableCredit` | 总授信 / 可用额度（分） |
| `products` | 可借产品 `LoanProduct[]` |
| `loans` | 我的借款 `Loan[]` |
| `installments` | 分期计划 `InstallmentPlan[]` |
| `builder` | 信用培养进度 `CreditBuilder` |

`LoanProduct`：`{ id, name, description, minAmount, maxAmount, minTermMonths, maxTermMonths, apr, disbursement, tags }`。

`Loan`：`{ id, productName, principal, outstanding, termMonths, monthlyPayment, apr, nextDueDate, paidPeriods, totalPeriods, status, createdAt }`。

`InstallmentPlan`：`{ id, title, merchant, totalAmount, remainingAmount, periods, paidPeriods, monthlyPayment, nextDueDate, feeRate, createdAt }`。

`CreditBuilder`：`{ score, level, streakMonths, nextMilestone, tips }`。

## 申请借款

`POST /api/credit/loans/apply` ← `LoanApplyRequest` → `Loan`

```json
{ "productId": "loan_quick", "amount": 600000, "termMonths": 12, "purpose": "日常消费", "accountId": "acc_0001", "paymentPassword": "888888" }
```

模拟放款：额度扣减 + 账户入账 + 台账流水。当前 `paymentPassword` 仅在传入且非空时校验，省略会跳过；这是待修复的校验缺口，不能作为允许免密办理的业务规则。
错误：`PRODUCT_NOT_FOUND`、`INVALID_AMOUNT`（金额越界）、`INVALID_TERM`（期限越界）、`OVER_CREDIT_LIMIT`、`BAD_PAY_PASSWORD`。

## 消费转分期

`POST /api/credit/installments/:transactionId/plan` ← `InstallmentConvertRequest` → `InstallmentPlan`

```json
{ "periods": 12 }
```

- 当前只检查 `:transactionId` 存在且为支出，没有限制为已成功的消费交易，也未拦截重复分期。
- 期数 3–24 期；`feeRate` 为总手续费率。
- 错误：`NOT_FOUND`、`INVALID_TARGET`（非支出交易）、`INVALID_PERIODS`。
