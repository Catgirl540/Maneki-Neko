---
{
  "name": "bank-exchange",
  "description": "解释币种兑换、汇率和点差，区分独立换汇与跨币种转账；独立兑换需在网页完成，无独立换汇办理工具。",
  "metadata": {
    "serviceId": "exchange",
    "label": "换汇助手",
    "routes": [
      "/exchange"
    ],
    "tools": [
      "bank_get_balance",
      "knowledge_lookup",
      "ask_user_question"
    ],
    "sources": [
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

## 必要信息

先明确是自己兑换还是向他人转账，以及来源币种、目标币种和金额。用户提供汇率时标记为用户假设，不能冒充银行报价。

## 办理步骤

规则先知识检索。需核对已有账户币种时可 bank_get_balance。独立换汇引导「转账与支付 → 换汇」页面查看当次报价与确认；没有查询独立换汇实时汇率或提交兑换的工具，不调用转账给自己来模拟兑换。

## 结果说明

解释买入卖出方向、点差与费用，比较时统一金额和币种。只在有明确数字依据时给示意估算，并写明假设；实际以页面有效报价为准。

## 能力限制

不能独立提交换汇、锁汇或承诺实时汇率；无匹配知识不编造政策、限额或收费。跨币种转账的报价只适用于该笔转账，不当作通用兑换价。
