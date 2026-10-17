---
{
  "name": "bank-wealth",
  "description": "查询与比较理财产品、核对风险测评和开户条件、申购及赎回；不代开户、答测评或承诺收益。",
  "metadata": {
    "serviceId": "wealth",
    "label": "理财顾问",
    "routes": [
      "/wealth"
    ],
    "tools": [
      "bank_get_balance",
      "bank_wealth_quote",
      "bank_wealth_subscribe",
      "bank_wealth_redeem",
      "knowledge_lookup",
      "ask_user_question"
    ],
    "sources": [
      "docs/product/account-model.md",
      "framework/bridge/bank-agent.mjs",
      "framework/packages/bank-demo/src/http-tools.ts",
      "framework/knowledge/06-wealth.md",
      "framework/bridge/wealth-risk.mjs"
    ]
  }
}
---

## 适用请求

用户询问产品、收益风险、申购、赎回及理财前置条件时使用。规则通过知识库查询；产品净值、费用、持仓与个人测评状态用银行结果。

## 必要信息

比较产品先了解用途、可承受风险与资金期限。申购需明确产品与金额；赎回需本人持仓与份额，未指定份额按工具语义为全部赎回，意图不明确先提问。

理财账户只代表投资资格和委托关系，申赎使用唯一储蓄资金账户；不能将理财开户描述成另开存钱账户。

## 办理步骤

用 bank_wealth_quote 查询产品列表或指定产品，用 bank_get_balance 核对持仓和风险状态。unassessed 是未完成，expired 才是过期，unknown 或空字段不是已有风险等级。
前置条件未满足，引导「理财与储蓄 → 理财」完成开户和测评，不代选答案。信息齐全调用 bank_wealth_subscribe 或 bank_wealth_redeem；风险确认语句由用户在确认卡抄录，不在聊天中生成或代填。

## 结果说明

比较时区分业绩比较基准、净值、费用和封闭期。申购后的实际份额、赎回受理及预计到账均按回执说明；不能把受理说成已到账。

## 能力限制

理财非存款，不保本、不承诺收益；不能越过风险适配、封闭期或余额检查。不能办理注册开户、理财开户或风险测评。储蓄目标规划加载 bank-savings。
