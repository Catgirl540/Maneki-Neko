---
{
  "name": "bank-cards",
  "description": "查询银行卡和卡产品、申请新卡、换卡、锁卡解锁、支付开关和限额、模拟消费，以及安全展示卡号或 CVV。",
  "metadata": {
    "serviceId": "cards",
    "label": "银行卡管家",
    "routes": [
      "/cards"
    ],
    "tools": [
      "bank_get_balance",
      "bank_list_cards",
      "bank_card_products",
      "bank_apply_card",
      "bank_replace_card",
      "bank_set_card_lock",
      "bank_update_card_settings",
      "bank_spend",
      "bank_list_budgets",
      "bank_reveal_card_secret",
      "knowledge_lookup",
      "ask_user_question"
    ],
    "sources": [
      "docs/product/account-model.md",
      "docs/api/spend.md",
      "framework/bridge/bank-agent.mjs",
      "framework/packages/bank-demo/src/http-tools.ts",
      "framework/knowledge/03-cards.md",
      "shared/spend-platforms.mjs",
      "app/src/pages/CardsPage.tsx"
    ]
  }
}
---

## 适用请求

申请或管理已有银行卡时使用；申请新卡与注册开立储蓄账户是不同业务。每位客户只有一个资金账户，多张银行卡共享该账户；不得为新卡创建账户或描述卡间划转。每位客户每个卡组织（Visa / 银联）至多一张：使用中、锁定、寄送中的卡占名额；同组织已有卡时引导换卡，不要重复提交申请（后端返回 CARD_NETWORK_LIMIT 且不收费）。

## 必要信息

用本人卡片列表确认目标卡，尾号重名时提问消歧；产品代码从产品查询取得。新卡或换卡需用户提供收件人、手机号、省份、城市、详细地址和可选邮编，不从历史或截图猜寄送地址。

## 办理步骤

用 bank_list_cards 查询状态、卡编号及设置，bank_card_products 查询可申请产品和实际费用（`held` 为 true 的卡组织不可再申请，`feeQuote` 为按会员等级折算的实付价；等级按 AUM 分普通 / 金卡 / 白金 / 钻石）。新卡调用 bank_apply_card，换卡调用 bank_replace_card，并明确旧卡失效。
锁定/解锁用 bank_set_card_lock；只修改用户明确要求的字段，调用 bank_update_card_settings。查看卡号或安全码调用 bank_reveal_card_secret，内容由安全弹窗展示，不要求用户回传。
用户在演示环境要求刷卡消费时，用 bank_spend：先确认本人使用中的卡、预设商户或自定义商户名、金额；金额以分为单位，上限 ¥50000.00，备注最多 80 字且必须由用户给出。只在本行沙箱演示环境可用，不产生真实商户交易，也不需要支付密码。
用户问「今天还能花多少」「为什么被拦」时，用 bank_list_budgets 读取支出预算：只报返回的今日额度、已用、剩余与积分，不创建或修改预算，也不代用户兑换额度券（这些只在网页 /analysis/budgets 办理）。

## 结果说明

新卡和换卡结果可能是寄送中，不能称已激活。锁卡关闭线上与境外支付，但不冻结资金账户；解锁不自动恢复开关。设置和费用按返回说明。模拟消费返回的是银行回执：余额按卡所属资金账户扣减、生成卡消费流水，分类由后台任务异步完成，返回的 `category` 恒为 other，不能当成最终分类或商户真实扣款凭证。

## 能力限制

寄送中或已换卡的旧卡不能借解锁激活，锁定卡不能开支付。不能提高到账户转账额度。不得在正文展示、保存或索取完整卡安全信息。丢卡联动 bank-security。bank_spend 只支持 12 个预设商户与 custom、stripe 两个自由收单入口；不支持退款、撤销、分期或修改已生成流水，也不能据此声称商户确已收款。
