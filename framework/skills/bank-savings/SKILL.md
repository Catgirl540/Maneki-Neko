---
{
  "name": "bank-savings",
  "description": "根据用户目标、期限、收支和已有积蓄制定储蓄计划；不创建储蓄目标、不自动划款或开启自动存入。",
  "metadata": {
    "serviceId": "savings",
    "label": "储蓄规划",
    "routes": [
      "/dashboard/savings"
    ],
    "tools": [
      "bank_get_balance",
      "bank_get_spending",
      "bank_get_cashflow",
      "knowledge_lookup",
      "ask_user_question"
    ],
    "sources": [
      "framework/bridge/bank-agent.mjs",
      "framework/packages/bank-demo/src/http-tools.ts",
      "app/src/pages/SavingsPage.tsx",
      "framework/knowledge/05-analysis.md"
    ]
  }
}
---

## 适用请求

存钱目标、预算安排、应急金和储蓄进度规划时使用，不等同于推荐理财或转账。

## 必要信息

询问目标金额、目标日期、已存金额、稳定收入、固定支出和需保留的流动资金。可先给基于已知信息的初稿；缺失关键数字用提问卡补充，不假定收入或收益。

## 办理步骤

需要账户实际数据才查询 bank_get_balance、bank_get_spending 或 bank_get_cashflow；收支分析可同时加载 bank-analysis。以用户确认的预算计算剩余目标与每期计划，说明不含未确认利息或投资收益。

## 结果说明

给出每月或每周目标、可执行调整与假设。目标无法按期达成时说明缺口，提供延长期限或降低目标的选择，不声称已设置自动存款。

## 能力限制

不能代建、修改储蓄目标或开启自动存入，不能承诺存款利率；执行引导「账户资产 → 储蓄目标」。用户要求买理财时加载 bank-wealth，实际划款加载 bank-transfer。
