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
      "bank_add_payee",
      "bank_delete_payee",
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

付款账户未知先用 bank_get_balance；只有一个资金账户就沿用，不重复追问。多张卡共享资金账户，不办自己名下卡间划转。收款人用 bank_list_payees 查找并消歧，银行代码用 bank_list_banks 核对。账号用 bank_verify_recipient 校验，外行格式校验不等于实名。FPS 用 bank_resolve_fps 取掩码姓名与默认银行，未登记不能转。
bank_list_payees 只查本人已存收款人，非全行查询；空列表不代表账号或户名有误，不必先保存。沿用用户给的完整账号与户名，只补问缺失银行/地区，再 bank_verify_recipient 核验。不从账号前缀或人民币猜地区。
回答含“先不转了”等取消项时停止；同一答案又含继续办理先澄清，不忽略取消。地区以用户明选为准，内地账户不套香港通道。
信息齐全后调用 bank_transfer 或 bank_fps_transfer；amountCents 为付款币种整数分，不是收款金额。报价、费用、汇率与有效期由确认卡展示，过期即重新确认。查到账先取本人流水和 bank_get_transaction_detail；仅在仍可撤回时调用 bank_recall_transfer。
amountCents 必传整数分（12.34 元传 1234），禁止传元。参数失败不等于用户拒绝，可按实际错误补齐，但不能绕过确认卡或支付密码。密码由用户在确认界面输入、银行在提交事务中验证，不写入对话或流水。

## 定时转账与收款人备注

已存收款人可按姓名、账号或 remark 检索；称呼如“房东”先查备注消歧，不推断登记姓名。bank_update_payee_remark 改准确 payeeId 备注需独立确认，不构成转账授权。香港 FPS 手机号为登记的 8 位标识，内地手机号不可套用。

未来某日转账用 bank_list_scheduled_transfers 查重；收集姓名、12–19 位账号、内地银行代码、付款币种、整数分金额和带时区 executeAt。bank_schedule_transfer 仅支持境内同币种零手续费一次性指令，金额≤100000000 分，时间一分钟至 366 天内。定投计划、冻结窗口、微信提醒都不是定时转账。核验收款人后出独立确认卡，支付密码走安全输入，禁止在聊天收集。

创建不扣款或冻结，说明到期仍需足额可用余额；失败应以实际 failed 原因报告，不承诺必达。executed 只表示原转账路径已受理，settlementStatus=pending 时继续查询原交易，大额仍走风控在途窗口。取消先查本人实际 planId 和当前状态，以 bank_cancel_scheduled_transfer 确认后取消未来指令；版本冲突刷新重确认，不重新创建或退款。超时先查清单核对原幂等指令，不反复提交。

删除收款人用 bank_delete_payee，先核对姓名与银行；只删记录，不影响转账与流水。
bank_add_payee 存收款人：姓名必填，手机号或 12–19 位本行账号填一个（都填须同属一人）。不动账、不核验账号存在；先查重。

## AA 拆分收款

计算清单后确认事由/币种/成员/金额/备注。bank_create_split_collection 必传 members 数组，每位成员 `name`（姓名，须与账户户名一致）加 `phone`（11 位注册手机号）或 `accountNo`（12–19 位本行账号）二者之一，再附 `amount`（整数分）和 `memo`；可附 allocation 对象均分明细，兼容 JSON 字符串。只给手机号或只给账号都不算完整成员；用户只报了账号就按账号填，不要追问手机号。缺姓名、身份、金额或备注先追问；姓名对不上户名会被服务端拒绝（AA_MEMBER_NAME_MISMATCH），此时请用户核对姓名而不是换账号重试。禁用旧创建参数，金额须与清单一致。1–30人、不含本人，成员无效整单失败。确认后进入成员“AA付款→待付款”；成员核对、验支付密码后付，不代扣/短信/微信/新增账户。原通知固定金额/备注，备注入双方流水/回单；处理中不称到账，禁止重复扣款。取消用 bank_cancel_split_collection，同步撤回未付款通知，保留已付，处理中先等待。

分项通过 allocation（collectorName、expenses: title/amount全额整数分/participants）保留消费明细；本人全垫付、参加时名单含本人。逐项均摊按各自名单分余分，按人汇总扣本人，绑定 members 同序金额；可单人，不合并名单或二次均分。多人垫付先问，不做净额结算。旧清单仅查询/核对，不用旧参数新建。bank_confirm_split_payment 仅匹配同币种/金额/登记名成功转入流水，不凭截图/口述，不重复认领或再增余额。

bank_list_split_collections 查真实状态。bank_prepare_split_reminder 仅生成未付催收文字并计数，delivered=false；用户自行发送，不称送达。

## 结果说明

回执区分成功/处理中/失败/已撤回；处理中不等于到账。撤回仅解除本笔在途指令在原币种的本金及实际记录费用冻结，不影响其他指令或币种，不称退款、取消定时任务或新增账户。确认卡展示原币种、本金和冻结合计，历史只记本金时不猜费用；状态或币种变化需重新确认。超时或断线先查询已提交交易，不自动再次转账。

## 能力限制

不凭截图认定到账、不推测完整账号、不承诺到账时间。换汇加载 bank-exchange，丢卡加载 bank-security。未指定收款人、金额或币种不替用户决定；唯一资金账户可查询确认后使用。
