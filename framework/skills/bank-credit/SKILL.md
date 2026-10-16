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

用户询问月供、总利息、还款压力和贷款条件时使用。授信、申请与分期办理目前没有 Agent 工具。

## 必要信息

明确本金、期限、年化或月利率口径、等额本息/等额本金或其他方式、费用及还款频率；未知利率不能自行选一个银行利率。

## 办理步骤

先补齐测算条件。等额本息月供 = P×r×(1+r)^n÷((1+r)^n−1)，r 为明确的月利率、n 为期数；零利率为 P÷n。等额本金每期本金 P÷n，利息按剩余本金×r。不同计息或费用条款不能套用这些公式。
需要评估近期现金流时可 bank_get_cashflow；没有必要不查询个人数据。没有可验证计算结果时提供公式与页面测算入口，不编造精确月供。

## 结果说明

标记为基于用户输入的示意测算，列明本金、利率口径、期限、费用是否包含和取整方式；不能当作银行正式报价。

## 能力限制

不能查询个人额度或实际贷款利率、代申请贷款或分期、承诺审批或放款。实际条件引导「全部服务 → 借款」。现金流不是授信依据，余额不代表可借额度。
