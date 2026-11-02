---
{
  "name": "bank-exchange",
  "description": "解释币种兑换、汇率和点差，区分独立换汇与跨币种转账；可查询报价并在确认、验密后办理账户内换汇。",
  "metadata": {
    "serviceId": "exchange",
    "label": "换汇助手",
    "routes": [
      "/exchange"
    ],
    "tools": [
      "bank_get_balance",
      "bank_get_exchange_rates",
      "bank_exchange_quote",
      "bank_exchange",
      "knowledge_lookup",
      "ask_user_question"
    ],
    "sources": [
      "docs/product/account-model.md",
      "framework/bridge/bank-agent.mjs",
      "framework/packages/bank-demo/src/http-tools.ts",
      "framework/knowledge/02-transfers.md",
      "app/src/pages/ExchangePage.tsx"
    ]
  }
}
---

## 适用请求

用户想把自己账户中的币种兑换，或询问换汇费用、汇率时使用。给别人转不同币种属于跨币种转账，同时加载 bank-transfer。

同一储蓄资金账户持有多币种余额；换汇仅在币种余额间记账，不另行开户，不能把币种分区 ID 说成多个资金账户。

## 必要信息

只问牌价明确来源币种和目标币种即可，不要求金额或账户；金额估算/实际兑换才需金额、本人扣账币种。向别人转账走转账技能。用户提供汇率时标记为用户假设，不能冒充银行报价。

## 办理步骤

仅解释规则才知识检索。只问汇率/牌价直接用 bank_get_exchange_rates，来源/目标币种明确即可，不要求金额或先查余额。按本行公布牌价直接报出每1来源币对应目标币的数值、含点差口径和查询时间；无需主动补充演示性质说明，不仅讲费用或让用户自己看页面。用户明确询问外部实时市场或数据来源时，按工具来源字段如实解释，不把查询时间当作市场更新时间。指定金额估算先用 bank_get_balance 取得扣账币种余额编号，再用 bank_exchange_quote；要实际兑换时用 bank_exchange：确认卡展示扣账金额、换入金额、汇率与点差，确认并验证支付密码后成交，提交时服务端会重新询价，汇率变化须重新确认。换汇只在同一资金账户的币种余额间记账，不开新账户、不改账户号。

## 结果说明

解释买入卖出方向、点差与费用，比较时统一金额和币种。只在有明确数字依据时给示意估算，并写明假设；实际以页面有效报价为准。

## 能力限制

不能锁汇或承诺汇率；报价过期或汇率变化必须重新确认，成交以银行回执为准。跨币种转账的报价只适用于该笔转账，不当作通用兑换价。
