# 自动扣款与 Agent 续费清单

## 已有银行接口

`GET /api/autodebits` 需要客户登录，返回当前客户档案的已有合约数组，不接收其他客户编号。字段为 `id`、`merchant`、`amount`（整数分）、`cycle`、`nextRunAt`、`enabled`、`category`。当前 `AutoDebit` 合约为人民币，网页按 CNY 展示；不是多币种余额合计，也不创建独立资金账户。

`PATCH /api/autodebits/:id` 接收 `{ enabled: boolean }`，只启停本人已有合约；不存在或他人合约不可操作。不新建合约，不撤销已发生账单，不退款，也不等同于取消商户订阅。Agent 使用 `bank_set_autodebit`，提交前核对合约快照并逐次确认。

## Agent 读取工具

`bank_analyze_autodebits({ days?: 7 | 30 | 90 })` 在执行时重新读取上述 GET 接口，默认 30 天。网页沿用查询确认卡；有效绑定的 IM 私聊可在服务端核对登录、归属和本次参数后直接查询。工具没有新增公网端点，不接收客户编号、令牌、日期基准或支付密码。

返回 `scope=owned-bank-autodebit-contracts`、实际 `asOf`、`timeZone=Asia/Shanghai`、含起始日/不含结束日的 `window`、合约 `items`、各状态 `counts`、分币种 `upcomingAmountCentsByCurrency` 和 `possibleOverlapContractIds`。

状态含义：

| status | 含义 |
| --- | --- |
| upcoming | 已启用，银行记录的下一次日期落在窗口内 |
| later | 已启用，下一次日期在窗口之后 |
| past-date | 已启用，但记录的下一次日期早于今天；不能据此判定欠费或失败 |
| unknown-date | 已启用，但银行日期缺失、不合法或没有明确时区 |
| disabled | 已停用，不计入预计扣款合计 |

例如北京时间 10 月 20 日查询 7 天，窗口为 10 月 20 日至 10 月 27 日前；10 月 27 日不计入。日期型字段按北京时间自然日解释，带时区的时间戳换算为北京时间。不会用模型猜测月份或扣款日期。

金额合计每份窗口内启用合约的**下一次**扣款一次，不解析周期文案展开次数，不等于完整月度消费。若将来银行显式提供币种则分别统计，未知币种报错，不换算汇率。金额缺失、非整数、负数、重复合约编号直接报数据错误，不用零代替；无效日期保留项目并标明未知。

同一币种、去首尾空白且忽略大小写的同名启用合约只列为可能重叠，不能认定重复收费或自动停用。`reminderCreated=false` 表示仅有查询快照：没有建立定时提醒、后台推送或扣款执行任务，也不能识别所有第三方订阅。

实现与验证：`framework/bridge/autodebit-analysis.mjs`、同名测试、`im-query.test.mjs` 和 `tools/check-agent-http.mjs`。后者只使用隔离本地银行与本地模型协议夹具。
