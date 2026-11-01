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

先明确是自己兑换还是向他人转账，以及来源币种、目标币种和金额。用户提供汇率时标记为用户假设，不能冒充银行报价。

## 办理步骤

规则先知识检索。用 bank_get_balance 确认扣账币种余额与可用金额。只问汇率或估算时用 bank_exchange_quote；要实际兑换时用 bank_exchange：确认卡展示扣账金额、换入金额、汇率与点差，确认并验证支付密码后成交，提交时服务端会重新询价，汇率变化须重新确认。换汇只在同一资金账户的币种余额间记账，不开新账户、不改账户号。

## 结果说明

解释买入卖出方向、点差与费用，比较时统一金额和币种。只在有明确数字依据时给示意估算，并写明假设；实际以页面有效报价为准。

## 能力限制

不能锁汇或承诺汇率；报价过期或汇率变化必须重新确认，成交以银行回执为准。跨币种转账的报价只适用于该笔转账，不当作通用兑换价。
