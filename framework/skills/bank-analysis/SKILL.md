---
{
  "name": "bank-analysis",
  "description": "查询账单交易详情、月度消费、现金流和已有自动扣款；区分统计口径，不用最近流水冒充整月消费。",
  "metadata": {
    "serviceId": "analysis",
    "label": "账单分析",
    "routes": [
      "/analysis",
      "/analysis/statistics",
      "/analysis/autodebits",
      "/transactions/:id"
    ],
    "tools": [
      "bank_get_balance",
      "bank_list_transactions",
      "bank_get_transaction_detail",
      "bank_get_spending",
      "bank_get_cashflow",
      "bank_list_autodebits",
      "bank_set_autodebit",
      "knowledge_lookup",
      "ask_user_question"
    ],
    "sources": [
      "framework/bridge/bank-agent.mjs",
      "framework/packages/bank-demo/src/http-tools.ts",
      "framework/knowledge/04-bills.md",
      "framework/knowledge/05-analysis.md"
    ]
  }
}
---

## 适用请求

查询某笔消费、整月支出、收支变化或扣款合约时使用；用户说“这笔不对”先定位交易，不先认定盗刷。

## 必要信息

确定账户与时间范围。月度分析接受 YYYY-MM；现金流工具支持最近 7 或 30 天。交易和合约需查询所得编号，不能从商户名或尾号猜编号。

## 办理步骤

账户未知先 bank_get_balance，明细用 bank_list_transactions 与 bank_get_transaction_detail。月度总额用 bank_get_spending，现金流用 bank_get_cashflow。
已有扣款用 bank_list_autodebits 查询；多个同名合约先提问确认，明确启停后调用 bank_set_autodebit。不要把查询扣款理解为要求关闭。

## 结果说明

说明月份、币种、单位与数据范围；金额单位分需换算展示。历史趋势与环比遵循工具返回口径，不擅自改成相对所选月份。只取最近流水时说明样本范围，不推断完整月总额。

## 能力限制

不能创建扣款合约、退款、撤销已发生账单或导出账单文件；导出引导「账单与交易」。停用自动扣款不免除已有账单。异常交易联动 bank-security，转账撤回联动 bank-transfer。
