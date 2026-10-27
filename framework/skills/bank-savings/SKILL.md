---
{
  "name": "bank-savings",
  "description": "根据目标、期限、收支制定储蓄计划，说明生日资金预留与订购待办；普通目标不冻结余额，生日预留须另行核对和支付密码。",
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
      "bank_list_birthday_plans",
      "bank_create_birthday_plan",
      "bank_cancel_birthday_plan",
      "bank_confirm_birthday_order",
      "knowledge_lookup",
      "ask_user_question"
    ],
    "sources": [
      "framework/bridge/bank-agent.mjs",
      "framework/packages/bank-demo/src/http-tools.ts",
      "app/src/pages/SavingsPage.tsx",
      "framework/knowledge/05-analysis.md",
      "shared/linked-plans.mjs",
      "app/src/components/linked/BirthdayPlans.tsx",
      "docs/api/linked-birthdays.md"
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

不能代建、修改储蓄目标或开启自动存入，不能承诺存款利率；执行引导「理财与储蓄 → 储蓄与计划 → 存钱目标」。用户要求买理财时加载 bank-wealth，实际划款加载 bank-transfer。

生日留款可用 bank_list_birthday_plans 查询，bank_create_birthday_plan 须明确联系人、关系、具体生日与币种金额，核对预留/订购待办时间并在银行页验证支付密码，也可引导「储蓄与计划 → 生日联动」。生日预留会减少对应币种可用余额，与不冻结余额的普通存钱目标不同；bank_cancel_birthday_plan 经独立确认只释放该计划金额。到期 bank_confirm_birthday_order 仍需单独确认，当前商户未接入，不生成真实订单、不自动消费预留资金，不能说已购买、已配送。生日过期后未消费预留释放；不读取外部通讯录或猜测爱人生日。
