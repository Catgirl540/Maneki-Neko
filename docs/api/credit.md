# 借款与分期

对应 `app/src/api/contract.ts` 的 `credit/*` 接口，页面 `app/src/pages/CreditPage.tsx`。

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

放款：额度扣减 + 账户入账 + 落一笔台账流水。`paymentPassword` 传入时校验。
错误：`PRODUCT_NOT_FOUND`、`INVALID_AMOUNT`（金额越界）、`INVALID_TERM`（期限越界）、`OVER_CREDIT_LIMIT`、`BAD_PAY_PASSWORD`。

## 消费转分期

`POST /api/credit/installments/:transactionId/plan` ← `InstallmentConvertRequest` → `InstallmentPlan`

```json
{ "periods": 12 }
```

- `:transactionId` 为待分期的支出交易 id；仅支出交易可分。
- 期数 3–24 期；`feeRate` 为总手续费率。
- 错误：`NOT_FOUND`、`INVALID_TARGET`（非支出交易）、`INVALID_PERIODS`。
