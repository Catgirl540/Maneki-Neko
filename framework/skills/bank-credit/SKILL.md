---
{
  "name": "bank-credit",
  "description": "解释借款本金、利率口径、期限、还款方式与测算条件；不查询个人授信、不申请贷款或承诺审批结果。",
  "metadata": {
    "serviceId": "credit",
    "label": "借款测算",
    "routes": [
      "/credit",
      "/cashflow"
    ],
    "tools": [
      "bank_get_cashflow",
      "bank_get_credit",
      "bank_activate_overdraft",
      "bank_apply_loan",
      "bank_convert_installment",
      "knowledge_lookup",
      "ask_user_question"
    ],
    "sources": [
      "framework/bridge/bank-agent.mjs",
      "framework/packages/bank-demo/src/http-tools.ts",
      "app/src/pages/CreditPage.tsx",
      "app/src/pages/CashflowPage.tsx"
    ]
  }
}
---

## 适用请求

用户询问月供、总利息、还款压力和贷款条件时使用；工资与备用金也在此。授信总览用 bank_get_credit 查询，备用金状态读 /api/cashflow/overdraft；账单与支出历史走 bank-analysis。

## 必要信息

明确本金、期限、年化或月利率口径、等额本息/等额本金或其他方式、费用及还款频率；未知利率不能自行选一个银行利率。

## 办理步骤

先补齐测算条件。等额本息月供 = P×r×(1+r)^n÷((1+r)^n−1)，r 为明确的月利率、n 为期数；零利率为 P÷n。等额本金每期本金 P÷n，利息按剩余本金×r。不同计息或费用条款不能套用这些公式。
需要评估近期现金流时可 bank_get_cashflow；没有必要不查询个人数据。没有可验证计算结果时提供公式与页面测算入口，不编造精确月供。

## 结果说明

标记为基于用户输入的示意测算，列明本金、利率口径、期限、费用是否包含和取整方式；不能当作银行正式报价。

## 能力限制

可以启用或关闭备用金（bank_activate_overdraft，有未还清金额时不能关闭）、申请借款（bank_apply_loan，确认卡展示本金、期限、年化利率、预计总利息与月供，确认并验证支付密码后从可用授信放款到指定账户）、把符合条件的支出转为分期（bank_convert_installment，3–24 期，费率以返回为准，原交易保留）。

不能承诺审批、放款或调额，不能用未返回的利率估算月供；现金流不是授信依据，余额不代表可借额度。备用金是授信额度，不是存款。额度或产品不符时直接说明拒绝原因，不改参数硬凑。
