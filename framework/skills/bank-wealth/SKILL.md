---
{
  "name": "bank-wealth",
  "description": "查询与比较理财产品、核对测评及开户条件、申赎和保存/管理定投计划；当前定投不自动扣款，不代开户或承诺收益。",
  "metadata": {
    "serviceId": "wealth",
    "label": "理财顾问",
    "routes": [
      "/wealth",
      "/wealth/products",
      "/wealth/holdings",
      "/wealth/plans",
      "/wealth/records",
      "/wealth/investments"
    ],
    "tools": [
      "bank_get_balance",
      "bank_wealth_quote",
      "bank_wealth_compare",
      "bank_list_investments",
      "bank_create_invest_plan",
      "bank_update_invest_plan",
      "bank_wealth_subscribe",
      "bank_wealth_redeem",
      "bank_list_invest_plans",
      "bank_pause_invest_plan",
      "bank_terminate_invest_plan",
      "bank_get_cash_management",
      "bank_update_cash_sweep",
      "knowledge_lookup",
      "ask_user_question"
    ],
    "sources": [
      "docs/product/account-model.md",
      "framework/bridge/bank-agent.mjs",
      "framework/packages/bank-demo/src/http-tools.ts",
      "framework/knowledge/06-wealth.md",
      "framework/bridge/wealth-risk.mjs",
      "framework/bridge/wealth-compare.mjs",
      "shared/invest-plan.mjs",
      "docs/api/wealth-ext.md",
      "docs/api/wealth.md",
      "docs/product/wealth-products.md"
    ]
  }
}
---

## 适用请求

用户询问产品、收益风险、申购、赎回、定投计划、现金管理及理财前置条件，或需要对比多个产品时使用。规则通过知识库查询；产品净值、费用、持仓与个人测评状态用银行结果。

## 必要信息

比较产品先了解用途、可承受风险与资金期限。申购需明确产品与金额；赎回需本人持仓与份额，未指定份额按工具语义为全部赎回，意图不明确先提问。定投需明确产品代码、每期金额、周期和扣款账户。

理财账户只代表投资资格和委托关系，申赎使用唯一储蓄资金账户；不能将理财开户描述成另开存钱账户。

## 办理步骤

用 bank_wealth_quote 查询产品列表或指定产品，用 bank_get_balance 核对持仓和风险状态。unassessed 是未完成，expired 才是过期，unknown 或空字段不是已有风险等级。
用户明确比较两款产品时，先从当前目录定位代码，再调用 bank_wealth_compare（firstProductCode + secondProductCode）；需要估算申购费和起购/追加门槛时附本人提出的金额（整数分）。比较三款及以上时传 productCodes（逗号分隔），或省略该参数比较全部在售产品，结果按风险等级升序给出并列要素（风险等级、期限、业绩比较基准、费率、波动率、起购金额）。结果同时提供风险匹配状态、期限、业绩基准、费率和金额规则，不把费用估算或风险匹配当成申购获批，也不从历史收益推断未来收益。对比结果客观呈现要素，不说哪个产品更适合或更好，让用户自行决定。未指定产品时先澄清用途、期限或风险偏好，不自行购买。
前置条件未满足，引导「理财与储蓄 → 理财总览」完成开户和测评，不代选答案。信息齐全调用 bank_wealth_subscribe 或 bank_wealth_redeem；风险确认语句由用户在确认卡抄录，不在聊天中生成或代填。

定投先用 bank_list_investments 查询专用产品目录与本人计划，不能拿 bank_wealth_quote 的理财代码替代定投代码；bank_list_invest_plans 可查本人计划详情。明确产品、人民币资金账户、每期金额和每周/每两周/每月周期后可用 bank_create_invest_plan 保存；必须在确认前说明当前仅保存计划，自动扣款尚未开放，不创建定时任务、不冻结或扣款。创建需要支付密码与有效适当性，密码只在银行确认卡输入。
管理已有定投时查询准确计划编号。暂停或恢复用 bank_update_invest_plan（status 为 paused / active）或 bank_pause_invest_plan，终止用 bank_update_invest_plan（status 为 terminated）或 bank_terminate_invest_plan，均逐次确认。恢复另验支付密码和当前测评/产品条件；终止不可恢复、保留已有历史，不赎回或退款。查询仍按实际状态回答，不把 active/已保存当作已经执行或自动续投。
现金管理：用 bank_get_cash_management 查看状态，bank_update_cash_sweep 设置自动归集规则与保留额。规则可随时修改或取消，到点自动扣款尚未开放，不承诺实际扣款日期。

## 结果说明

网页产品在「理财产品」、持仓赎回在「我的持仓」、定投在「储蓄与计划 → 定投计划」；交易记录仅为现有资金流水，不是独立委托订单。不能依据记账成功声称份额确认或赎回到账。

比较时区分业绩比较基准、净值、费用和封闭期。对比结果客观呈现要素，不说哪个产品更适合或更好，让用户自行决定。申购后的实际份额、赎回受理及预计到账均按回执说明；不能把受理说成已到账。

定投结果只确认计划已保存及当前状态（已保存/已暂停/已终止）；不把计划日期说成已预约执行，不承诺按周期扣款或按当时净值确认份额。现金管理归集规则保存后说明每期金额、周期和保留额，并注明自动扣款尚未开放。

## 能力限制

当前演示产品、发行方、净值及曲线为虚构配置；不能因为引用现实指数或机构就说是真实发行、实际持有或已接入实时行情。份额为内部演示口径，维护表不是在线报价源。权益产品费用标注有持有期条件，但当前未按天数分档，不承诺满 7 天免赎回费。现金管理收益为静态展示数据，不实时计息。

理财非存款，不保本、不承诺收益；不能越过风险适配、封闭期或余额检查。不能办理注册开户、理财开户或风险测评。不提供个性化投资建议或产品推荐结论。储蓄目标规划加载 bank-savings。
