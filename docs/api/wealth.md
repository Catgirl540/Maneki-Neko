# 理财查询、开通与申赎

对应 `BankApi` 的普通理财接口。当前产品为项目内虚构配置，见 [虚构理财产品目录](../product/wealth-products.md)；网页入口见 [理财中心](../product/wealth-workspace.md)。定投、旧活钱与保险接口见 [理财扩展](wealth-ext.md)，不要混用产品代码。

## 接口

| 方法 | 路径 | 入参 | 返回 |
| --- | --- | --- | --- |
| GET | `/api/wealth/products` | 无 | `WealthProduct[]` |
| GET | `/api/wealth/products/:code` | 目录产品代码 | `WealthProduct` |
| GET | `/api/wealth/overview` | 当前客户登录态 | `WealthOverview` |
| GET | `/api/wealth/risk/questions` | 无 | `RiskQuestion[]` |
| POST | `/api/wealth/risk/assess` | `{ answers: number[] }`，各题选项下标 | `RiskAssessment` |
| POST | `/api/wealth/account/open` | `{ smsCode, faceTicket, agreement, settlementAccountId }` | `WealthAccount` |
| POST | `/api/wealth/subscribe` | `{ productCode, amount, paymentPassword, riskAcknowledgement }` | `WealthSubscribeResult` |
| POST | `/api/wealth/redeem` | `{ holdingId, shares? }` | `WealthRedeemResult` |

以上接口均按当前环境执行；`live` 未接入合作银行时返回 `503 BANK_NOT_CONNECTED`，不是可对外办理真实理财的承诺。

## 查询与资格

- 产品包含风险 R1–R5、非保本标记、起购/递增金额、期限、开放性、基准与依据、费用、固定演示净值及生成序列。`navDate` 为查询当日，不能据此认定实时行情。
- 概览包含资格账户、风险状态和本人持仓及汇总；未开通理财时不返回可归属于客户的持仓与收益。汇总为人民币理财持仓口径，不叠加储蓄余额、存钱目标或计划金额。
- 测评未完成时 `done=false`、`expired=false`、`level=null`；已完成才可能过期。有效期一年；C1–C5 最高分别匹配 R1–R5。不可替客户选择答案。
- 开通复用当前登录客户的已实名资料，不重复提交姓名、身份证。先有有效测评，再核验当前手机号短信、人脸凭据和投资协议；`settlementAccountId` 关联本人唯一储蓄资金账户的结算分区，不另开存钱账户。

## 申购

`amount` 为正整数分，必须达到 `minAmount`，且总金额能被 `stepAmount` 整除。服务端核对资格、测评、风险、会员优先购窗口、确认语句、余额与支付密码，前端按钮禁用不能替代后端校验。

当前演示从结算分区扣除申购总额，申购费内扣后生成内部份额；同产品合并持仓及加权买入净值。回执为 `{ holding, confirmedAt, shares, nav, fees }`。当前立即返回确认信息，没有独立的待确认订单或清算日调度。

风险确认语句使用 `app/src/lib/wealth.ts` 中 `RISK_ACKNOWLEDGEMENT`；协议使用 `WEALTH_INVESTMENT_AGREEMENT`。客户端和 Agent 不在聊天中收集支付密码，网页风险语句由本人抄录。

常见错误：`WEALTH_ACCOUNT_REQUIRED`、`RISK_ASSESSMENT_REQUIRED`、`RISK_MISMATCH`、`WEALTH_PRIORITY_WINDOW`、`ACKNOWLEDGEMENT_MISMATCH`、`INVALID_AMOUNT`、`BELOW_MIN_AMOUNT`、`INVALID_STEP`、`INSUFFICIENT_FUNDS`、`BAD_PAY_PASSWORD`。

## 赎回

`holdingId` 必须属于本人；`shares` 大于零且不超过持有份额，省略代表全部赎回。封闭期由后端 `closed` 判断，不允许客户端单凭日期绕过。当前不额外验证支付密码，但保留明确确认步骤。

回执 `{ holdingId, acceptedAt, shares, estimatedAmount, etaText }`。`estimatedAmount` 为扣除费用后的分金额。**当前演示会立即记账入资金账户，回执文案却写预计 T+1**；没有真实异步到账流程，不能把任一文案扩写成已验证的清算承诺。持仓按赎回比例减少本金与份额，全部赎回删除该持仓。

常见错误：`HOLDING_NOT_FOUND`、`IN_CLOSED_PERIOD`、`INVALID_SHARES`、`EXCEED_SHARES`。

## 当前实现限制

份额以分金额参与换算、追加购买未逐笔重设封闭期、权益产品赎回费未按持有天数分档，以及优先购窗口随模块加载生成，均详见 [目录中的交易规则与已知简化](../product/wealth-products.md#5-交易规则与已知简化)。这些是待完善事项，不应复制成真实产品规范。

查询资金记录复用账户流水接口；没有新增理财订单接口。`/wealth/records` 展示相关资金记账，不能据记账成功推断订单已确认、份额准确或赎回已完成真实清算。后续增加订单或清算能力时，同一提交更新契约、业务、网页、知识/技能和断言。
