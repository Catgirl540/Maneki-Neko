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
      "bank_list_scheduled_transfers",
      "bank_schedule_transfer",
      "bank_cancel_scheduled_transfer",
      "bank_update_payee_remark",
      "bank_list_split_collections",
      "bank_create_split_collection",
      "bank_cancel_split_collection",
      "bank_confirm_split_payment",
      "bank_prepare_split_reminder",
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
每次转账调用都必须传 amountCents，例如用户说 12.34 元时传 1234；已有金额不得漏传，也不能传元单位。参数校验或确认信息准备失败不等于用户拒绝；尚未提交的调用可按实际错误补齐参数，但不能绕过确认卡或支付密码。 即时转账密码由用户在确认界面输入，银行在提交事务中验证；旧服务不支持时停止提交。密码不得写入对话、确认参数、流水或在途快照。

## 定时转账与收款人备注

已保存收款人可按姓名、账号或本人维护的 remark 检索；用户说“爱人”“房东”只能先查备注并消歧，不凭称呼推断登记姓名。bank_update_payee_remark 修改准确 payeeId 的备注需独立确认，不构成转账授权。香港 FPS 手机号为登记的 8 位标识，内地手机号不可套用，不能虚构解析结果。

用户明确要求未来某日转账时，用 bank_list_scheduled_transfers 查询已有指令避免重复；收集完整姓名、12–19 位账号、内地银行代码、本人付款币种和整数分金额，以及带时区的准确 executeAt。当前 bank_schedule_transfer 仅支持境内银行同币种、零手续费的一次性指令，金额不超过 100000000 分，时间在一分钟后至未来 366 天内。不能把定投计划、在途冻结窗口或微信文字提醒当作定时转账。核验收款人后展示独立确认卡并通过安全输入校验支付密码，禁止在聊天收集密码。

创建不扣款或冻结，说明到期仍需足额可用余额；失败应以实际 failed 原因报告，不承诺必达。executed 只表示原转账路径已受理，settlementStatus=pending 时继续查询原交易，大额仍走风控在途窗口。取消先查本人实际 planId 和当前状态，以 bank_cancel_scheduled_transfer 确认后取消未来指令；版本冲突刷新重确认，不重新创建或退款。超时先查清单核对原幂等指令，不反复提交。

## AA 拆分收款

用户明确要求 AA 时，收集待收总额、明确币种和 2–30 个不重名的付款参与者完整姓名，说明不含本人已自付份额。用 bank_create_split_collection 展示均分及余数顺序并确认，整数分余数按用户给定姓名顺序分配，不替用户改人数、名单或金额。清单与份额只管理收款，没有代扣、发送邀请或新增账户。

bank_list_split_collections 读取真实 open/complete/cancelled 和各参与者状态。bank_confirm_split_payment 须使用本人同币种、同金额、登记户名匹配的成功转入流水，不能凭用户口述、截图或催收文字标记到账；一笔流水不能重复证明多份款项，也不再次增加资金余额。全部付款证据齐全才称已收齐。

bank_prepare_split_reminder 只生成准确未付份额催收文字并记录准备次数，返回 delivered=false，明确未发送消息。用户取消时用 bank_cancel_split_collection 独立确认，保留已付证据、不退款；需要发送消息应另有用户明确授权和可用渠道，不借此工具宣称已送达。

## 结果说明

按回执区分成功、处理中、失败、已撤回；处理中不等于对方到账。撤回仅解除本笔在途指令在原币种的本金及实际记录费用冻结，不影响其他指令或币种，不称退款、取消定时任务或新增账户。确认卡展示原币种、本金和冻结合计，历史只记本金时不猜费用；状态或币种变化需重新确认。超时或断线先查询已提交交易，不自动再次转账。

## 能力限制

不能凭截图认定到账、推测完整账号、提高限额或承诺到账时间。独立换汇加载 bank-exchange；丢卡处置加载 bank-security。未指定收款人、金额或付款币种不得替用户决定；唯一资金账户可在查询确认后使用。
