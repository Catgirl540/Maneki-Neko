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
      "docs/product/account-model.md",
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

付款账户未知先用 bank_get_balance；查询仅返回一个资金账户时沿用该账户，不重复追问账户选择。多张卡共享资金账户，不办理自己名下卡间划转；币种分区 ID 仅用于币种余额记账。保存的收款人用 bank_list_payees 查找并请用户消歧，银行代码用 bank_list_banks 核对。账号用 bank_verify_recipient 校验，外行格式校验不等于实名。FPS 用 bank_resolve_fps 取得掩码姓名与默认银行，未登记不能转，不猜全名或另选银行。
bank_list_payees 只查询当前客户已保存的收款人，不是全行账户查询；空列表不代表账号不存在或户名错误，也不要求先保存收款人。用户已提供完整账号和户名时沿用原值，只补问尚未明确的银行、地区等信息，再用 bank_verify_recipient 核验；核验失败以该工具的实际错误为准。不得从账号前缀或人民币币种猜银行地区，也不得把姓名看起来像“测试收款人”就认作缺少户名。
提问卡回答含“先不转了”等取消选项时停止办理；若同一答案又含继续办理的自填内容，先澄清，不能自行忽略取消。银行地区以用户明确选择为准，不将本行中国大陆账户套用香港通道。
信息齐全后调用 bank_transfer 或 bank_fps_transfer；amountCents 是付款币种的整数分，不是收款金额。报价、费用、汇率和有效期由确认卡展示，过期或变化重新确认。查到账先取本人流水和 bank_get_transaction_detail；仅在交易仍可撤回时调用 bank_recall_transfer。
每次转账调用都必须传 amountCents，例如用户说 12.34 元时传 1234；已有金额不得漏传，也不能传元单位。参数校验或确认信息准备失败不等于用户拒绝；尚未提交的调用可按实际错误补齐参数，但不能绕过确认卡或支付密码。

## 结果说明

按回执区分成功、处理中、失败、已撤回；处理中不等于对方到账。撤回仅解除本笔在途指令在原币种的本金及实际记录费用冻结，不影响其他指令或币种，不称退款、取消定时任务或新增账户。确认卡展示原币种、本金和冻结合计，历史只记本金时不猜费用；状态或币种变化需重新确认。超时或断线先查询已提交交易，不自动再次转账。

## 能力限制

不能凭截图认定到账、推测完整账号、提高限额或承诺到账时间。独立换汇加载 bank-exchange；丢卡处置加载 bank-security。未指定收款人、金额或付款币种不得替用户决定；唯一资金账户可在查询确认后使用。
