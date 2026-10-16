---
{
  "name": "bank-transfer",
  "description": "办理境内或香港银行转账、FPS、跨币种转账，核对收款人并查询或撤回在途交易；不适用于仅在自己账户兑换币种。",
  "metadata": {
    "serviceId": "transfer",
    "label": "智能转账",
    "routes": [
      "/transfer",
      "/receiving",
      "/transactions/:id"
    ],
    "tools": [
      "bank_get_balance",
      "bank_list_banks",
      "bank_list_payees",
      "bank_verify_recipient",
      "bank_resolve_fps",
      "bank_transfer",
      "bank_fps_transfer",
      "bank_list_transactions",
      "bank_get_transaction_detail",
      "bank_recall_transfer",
      "knowledge_lookup",
      "ask_user_question"
    ],
    "sources": [
      "framework/bridge/bank-agent.mjs",
      "framework/packages/bank-demo/src/http-tools.ts",
      "framework/knowledge/02-transfers.md",
      "framework/bridge/transfer-agent.mjs"
    ]
  }
}
---

## 适用请求

用户说转钱、转入转出、FPS、查到账或撤回时使用。问费用和限额先检索知识库；余额、当次费用与交易状态不能从规则推断。

## 必要信息

明确付款账户、付款币种与金额、收款方式。银行账号方式需要完整账号、户名、银行代码和地区；FPS 非账号方式需要完整标识及明确收款币种。只有尾号、同名联系人或模糊币种时用提问卡补齐。

## 办理步骤

付款账户未知先用 bank_get_balance；保存的收款人用 bank_list_payees 查找并请用户消歧，银行代码用 bank_list_banks 核对。账号用 bank_verify_recipient 校验，外行格式校验不等于实名。FPS 用 bank_resolve_fps 取得掩码姓名与默认银行，未登记不能转，不猜全名或另选银行。
信息齐全后调用 bank_transfer 或 bank_fps_transfer；amountCents 是付款币种的整数分，不是收款金额。报价、费用、汇率和有效期由确认卡展示，过期或变化重新确认。查到账先取本人流水和 bank_get_transaction_detail；仅在交易仍可撤回时调用 bank_recall_transfer。

## 结果说明

按回执区分成功、处理中、失败、已撤回；处理中不等于对方到账。撤回解除在途冻结，不称退款。超时或断线先查询已提交交易，不自动再次转账。

## 能力限制

不能凭截图认定到账、推测完整账号、提高限额或承诺到账时间。独立换汇加载 bank-exchange；丢卡处置加载 bank-security。未指定收款人、金额或付款账户不得替用户决定。
