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

适用转账、FPS、到账查询与撤回。问费用和限额先检索知识库；余额、当次费用与交易状态不能从规则推断。

## 必要信息

明确付款账户、付款币种与金额、收款方式。银行账号方式需要完整账号、户名、银行代码和地区；FPS 非账号方式需要完整标识及明确收款币种。尾号/同名/币种模糊用提问卡补齐。

## 办理步骤

付款账户未知先用 bank_get_balance；查询仅返回一个资金账户时沿用该账户，不重复追问账户选择。多张卡共享资金账户，不办理自己名下卡间划转；币种分区 ID 仅用于币种余额记账。保存的收款人用 bank_list_payees 查找并请用户消歧，银行代码用 bank_list_banks 核对。账号用 bank_verify_recipient 校验，外行格式校验不等于实名。FPS 用 bank_resolve_fps 取得掩码姓名与默认银行，未登记不能转，不猜全名或另选银行。
bank_list_payees 仅查本人已存收款人，非全行查询；空列表不代表账号/户名错误，不必先保存。沿用用户完整账号和户名，仅补问缺失银行/地区，再用 bank_verify_recipient 核验，以实际错误为准。禁止从账号前缀/人民币猜地区，禁止把“测试收款人”等姓名认作缺户名。
提问卡回答含“先不转了”等取消选项时停止办理；若同一答案又含继续办理的自填内容，先澄清，不能自行忽略取消。银行地区以用户明确选择为准，不将本行中国大陆账户套用香港通道。
信息齐全后调用 bank_transfer 或 bank_fps_transfer；amountCents 是付款币种的整数分，不是收款金额。报价、费用、汇率和有效期由确认卡展示，过期或变化重新确认。查到账先取本人流水和 bank_get_transaction_detail；仅在交易仍可撤回时调用 bank_recall_transfer。
每次转账必传 amountCents 整数分（12.34 元传1234），禁止漏传或传元。参数校验或确认信息准备失败不等于用户拒绝；尚未提交的调用可按实际错误补齐参数，但不能绕过确认卡或支付密码。即时转账密码由用户在确认界面输入，银行在提交事务中验证；旧服务不支持时停止提交。密码不得写入对话、确认参数、流水或在途快照。

## 定时转账与收款人备注

已保存收款人可按姓名、账号或本人维护的 remark 检索；用户说“爱人”“房东”只能先查备注并消歧，不凭称呼推断登记姓名。bank_update_payee_remark 修改准确 payeeId 的备注需独立确认，不构成转账授权。香港 FPS 手机号为登记的 8 位标识，内地手机号不可套用，不能虚构解析结果。

用户明确要求未来某日转账时，用 bank_list_scheduled_transfers 查询已有指令避免重复；收集完整姓名、12–19 位账号、内地银行代码、本人付款币种和整数分金额，以及带时区的准确 executeAt。当前 bank_schedule_transfer 仅支持境内银行同币种、零手续费的一次性指令，金额不超过 100000000 分，时间在一分钟后至未来 366 天内。不能把定投计划、在途冻结窗口或微信文字提醒当作定时转账。核验收款人后展示独立确认卡并通过安全输入校验支付密码，禁止在聊天收集密码。

创建不扣款或冻结，说明到期仍需足额可用余额；失败应以实际 failed 原因报告，不承诺必达。executed 只表示原转账路径已受理，settlementStatus=pending 时继续查询原交易，大额仍走风控在途窗口。取消先查本人实际 planId 和当前状态，以 bank_cancel_scheduled_transfer 确认后取消未来指令；版本冲突刷新重确认，不重新创建或退款。超时先查清单核对原幂等指令，不反复提交。

## AA 拆分收款

均分清单计算后绑定手机号/备注发通知，确认事由/币种/名单/金额。bank_create_split_collection 传 members JSON（phone/amount/memo），可附 allocation 均分明细，金额须一致；不混用旧顶层参数。1–30人、不含本人，任一成员无效整单失败。确认后进入成员“AA付款→待付款”；成员核对、验支付密码后付，不代扣/短信/微信/新增账户。原通知固定金额/备注，备注入双方流水/回单；处理中不称到账，禁止重复扣款。取消用 bank_cancel_split_collection，同步撤回未付款通知，保留已付，处理中先等待。

旧分项（本人全垫付）传 expenses（title/amount全额整数分/participants含参加的本人）及 collectorName；逐项均摊按各自名单分余分，再按人汇总扣本人，可单人，不合并名单/二次均分。多人垫付先问，不做净额结算。旧 amountCents/participantNames 传扣本人后金额及2–30个唯一完整姓名；不猜或改金额/名单/顺序。旧清单不发通知，bank_confirm_split_payment 仅匹配同币种/金额/登记名成功转入流水，不凭截图/口述，不重复认领或再增余额。

bank_list_split_collections 查真实状态。bank_prepare_split_reminder 仅生成未付催收文字并计数，delivered=false；用户自行发送，不称送达。

## 结果说明

回执区分成功/处理中/失败/已撤回；处理中不等于到账。撤回仅解除本笔在途指令在原币种的本金及实际记录费用冻结，不影响其他指令或币种，不称退款、取消定时任务或新增账户。确认卡展示原币种、本金和冻结合计，历史只记本金时不猜费用；状态或币种变化需重新确认。超时或断线先查询已提交交易，不自动再次转账。

## 能力限制

不能凭截图认定到账、推测完整账号、提高限额或承诺到账时间。独立换汇加载 bank-exchange；丢卡处置加载 bank-security。未指定收款人、金额或付款币种不得替用户决定；唯一资金账户可在查询确认后使用。
