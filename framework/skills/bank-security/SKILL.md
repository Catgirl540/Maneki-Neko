---
{
  "name": "bank-security",
  "description": "处理丢卡、疑似盗刷、陌生交易和账号安全问题；可锁卡与查询本人交易，密码或手机号修改需网页完成。",
  "metadata": {
    "serviceId": "security",
    "label": "安全助手",
    "routes": [
      "/security",
      "/cards"
    ],
    "tools": [
      "bank_list_cards",
      "bank_set_card_lock",
      "bank_list_transactions",
      "bank_get_transaction_detail",
      "bank_get_balance",
      "knowledge_lookup",
      "ask_user_question"
    ],
    "sources": [
      "framework/bridge/bank-agent.mjs",
      "framework/packages/bank-demo/src/http-tools.ts",
      "framework/knowledge/08-security.md",
      "framework/knowledge/03-cards.md"
    ]
  }
}
---

## 适用请求

银行卡丢失、异常扣款、账号风险或安全设置问题时使用。紧急锁卡需求优先明确目标卡，不插入无关调查。

## 必要信息

先确认用户要锁哪张卡或查询哪笔交易；用查询所得编号，尾号冲突需消歧。不要要求密码、验证码、CVV或把用户提交的此类凭据复述进摘要。

## 办理步骤

丢卡且要求锁卡时用 bank_list_cards 定位并 bank_set_card_lock 发起确认。陌生扣款先 bank_list_transactions / bank_get_transaction_detail 核对时间、商户和实际状态，不凭截图断言盗刷。
规则与登录安全说明查知识库；修改密码、手机号引导「安全中心」。需换卡加载 bank-cards，撤回仍可撤回的转账加载 bank-transfer；用户要求人工帮助时加载 bank-support。

## 结果说明

说明已核对事实与尚待确认问题。锁卡结果只说明卡片状态，不称资金账户被冻结；不保证追回资金或免除损失。

## 能力限制

不能代改密码手机号、冻结资金账户、发起退款或保证找回资金。不得编造热线、网点和柜面流程；紧急情况提供现有页面入口及用户明确请求的人工工单。
