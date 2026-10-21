---
{
  "name": "bank-savings",
  "description": "根据用户目标、期限、收支和已有积蓄制定储蓄计划；可创建、修改、删除储蓄目标及设置自动归集；不承诺存款利率。",
  "metadata": {
    "serviceId": "savings",
    "label": "储蓄规划",
    "routes": [
      "/dashboard/savings",
      "/wealth/plans"
    ],
    "tools": [
      "bank_get_balance",
      "bank_get_spending",
      "bank_get_cashflow",
      "bank_list_savings_goals",
      "bank_create_savings_goal",
      "bank_update_savings_goal",
      "bank_delete_savings_goal",
      "bank_set_savings_sweep",
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

存钱目标、预算安排、应急金和储蓄进度规划时使用，不等同于推荐理财或转账。用户要创建、修改、删除存钱目标或设置自动归集时也使用本技能。

## 必要信息

询问目标金额、目标日期、已存金额、稳定收入、固定支出和需保留的流动资金。可先给基于已知信息的初稿；缺失关键数字用提问卡补充，不假定收入或收益。创建目标需名称与目标金额；修改需目标编号；自动归集需目标编号、金额、周期和扣款账户。

## 办理步骤

需要账户实际数据才查询 bank_get_balance、bank_get_spending 或 bank_get_cashflow；收支分析可同时加载 bank-analysis。以用户确认的预算计算剩余目标与每期计划，说明不含未确认利息或投资收益。目标管理用 bank_list_savings_goals 查现有目标，bank_create_savings_goal 创建、bank_update_savings_goal 修改、bank_delete_savings_goal 删除、bank_set_savings_sweep 设置自动归集开关。

## 结果说明

给出每月或每周目标、可执行调整与假设。目标无法按期达成时说明缺口，提供延长期限或降低目标的选择。自动归集设置成功后说明每期金额、周期和扣款账户；规则可保存和取消，到点自动扣款尚未开放，不承诺实际扣款日期。

## 能力限制

不能承诺存款利率。可创建、修改、删除储蓄目标并设置自动归集规则；规则保存后可随时修改或取消，到点自动扣款尚未开放，不承诺实际扣款日期。执行引导「理财与储蓄 → 储蓄与计划 → 存钱目标」。用户要求买理财时加载 bank-wealth，实际划款加载 bank-transfer。
