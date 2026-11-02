---
{
  "name": "bank-analysis",
  "description": "查询账单、月度消费、现金流、代扣及续费；按有限样本核查重复或突增支出，说明范围，不认定欺诈或用样本冒充月/年报。",
  "metadata": {
    "serviceId": "analysis",
    "label": "账单分析",
    "routes": [
      "/analysis",
      "/analysis/statistics",
      "/analysis/autodebits",
      "/transactions/:id"
    ],
    "tools": [
      "bank_get_balance",
      "bank_list_transactions",
      "bank_review_transactions",
      "bank_get_transaction_detail",
      "bank_get_spending",
      "bank_get_cashflow",
      "bank_get_billing_report",
      "bank_export_statement",
      "bank_export_billing_report",
      "bank_get_receipt",
      "bank_list_budgets",
      "bank_list_monthly_budgets",
      "bank_set_monthly_budget",
      "bank_delete_monthly_budget",
      "bank_create_budget",
      "bank_update_budget",
      "bank_delete_budget",
      "bank_redeem_budget_pass",
      "bank_list_autodebits",
      "bank_analyze_autodebits",
      "bank_find_subscription_candidates",
      "bank_create_renewal_reminder",
      "bank_set_autodebit",
      "bank_list_im_reminders",
      "bank_create_im_reminder",
      "bank_cancel_im_reminder",
      "knowledge_lookup",
      "ask_user_question"
    ],
    "sources": [
      "framework/bridge/bank-agent.mjs",
      "framework/bridge/autodebit-analysis.mjs",
      "framework/bridge/transaction-review.mjs",
      "framework/packages/bank-demo/src/http-tools.ts",
      "framework/knowledge/04-bills.md",
      "framework/knowledge/05-analysis.md"
    ]
  }
}
---

## 适用请求

查询消费、月支出、收支、预算、代扣/续费；异常先定位交易，不先认定盗刷。借款月供走 bank-credit。

## 必要信息

微信文字提醒须明确内容、日期、北京时间和本人接收私聊。bank_list_im_reminders 查询记录与连接；bank_create_im_reminder 独立确认、不验支付密码。只发确认文字，不读余额、不扣款；时间不明先问，理财查询不授权提醒。scheduled为已保存，sent为平台确认非已读，unknown先核实不可重发。bank_cancel_im_reminder 仅取消未发送提醒且需确认。

明确时间范围：月份 YYYY-MM，现金流7 或 30天。明细和合约使用查询所得编号，不从商户或尾号猜编号。

## 办理步骤

查整月花费/分类/走势直接 bank_get_spending，一次结果足够不再查月度账单或重复确认；只需统计时不先查账户或银行卡。需账户流水且编号未知才 bank_get_balance，明细用 bank_list_transactions 与 bank_get_transaction_detail。现金流用 bank_get_cashflow。
完整月报/年报用 bank_get_billing_report，period=month/year、value=YYYY-MM/YYYY、currency=CNY/USD/HKD。读取该币种全部成功流水，排除账户内换汇，年报 12 个月；说明 asOf、partial/complete 与排除日期数，不用有界样本代替。CSV 由助手办好：流水用 bank_export_statement、月年报用 bank_export_billing_report，返回一次性链接（约 5 分钟、只能打开一次），只说链接与行数，不粘表格内容，失效重新生成。回单用 bank_get_receipt，空地址说明无 PDF，引导到交易详情打印或另存。
问重复扣款、金额突增或异常流水时，确定账户/币种后用 bank_review_transactions；每次只检查银行第一页 20–200 条（默认 100）样本，报告覆盖条数与实际时间范围，不声称最近或完整月/年。只分析成功的餐饮、购物、住房、交通、订阅支出；工资、转账、其他、收入、未完成、无效及未来日期不作依据。
重复候选来自同商户同金额 5 分钟记录；金额突增至少 100 元/对应币种单位，并达到先前 90 天样本中同商户中位数 3 倍，且有至少 3 个不同北京时间日期的先前记录。展示实际交易编号、金额、时间及历史依据；提示核对，不认定欺诈/重复收费，不将没有候选说成安全。不自动锁卡、退款或报案；需要核查时再查真实回单，用户明确要求时联动人工服务或安全技能。
已有代扣用 bank_list_autodebits 查；同名多合约先问，明确启停才 bank_set_autodebit，查询不等于关闭。

预算不查卡、勿折算周期。月目标：bank_list_monthly_budgets 查，bank_set_monthly_budget 设；明确月份/分类/币种/目标整数分并确认，仅对比支出、不拒付。bank_delete_monthly_budget 删除：按月份/分类/币种读本人目标，展示原金额并独立确认，冲突重查；保留流水/每日限额，不退款。每日限额：bank_list_budgets 查额度/已用/剩余/积分；bank_create_budget 新建、bank_update_budget 改、bank_delete_budget 删（连同积分与额度券）；bank_redeem_budget_pass 换券，不扣款、不冻结。

询问订阅续费、近期代扣或重复签约时用 bank_analyze_autodebits，支持从北京时间今天起 7、30、90 个自然日（含今天、不含结束日），默认 30 天。只整理银行已有合约记录的下一次扣款，不从名称猜测所有商户订阅，也不把周期文本展开成多次扣款。分别展示即将扣款、过去日期、日期未知和停用项目；同名启用合约只是待核对候选，不自动停用。

bank_find_subscription_candidates 与网页「自动扣款」可核查按币种第一页最多200条流水的周期订阅候选，三个不同日期的同商户同金额及连续周期是证据，仍须向商户核对。bank_create_renewal_reminder 根据真实合约快照准备一次提醒，再独立确认；网页已启用合约可点「续费提醒」，预填下一次扣款提前两天的文字与北京时间，核对确认后才创建一次性提醒。过期时间不猜下一周期，未自动续建；停扣只影响本行合约，取消商户订阅须去商户办理。

## 结果说明

说明月份/币种/范围，整数分换算展示。月度统计按北京时间，趋势截至所选月，previousMonth/previousTotal 是所选月的上一个完整月。monthOverMonthComparable=false 时说明上月无可比支出基数，不把兼容数值 0 当作环比 0%。periodStatus=partial 时是本月至查询时点对上月全月，不是同天数环比。现金流是最近自然日（含今天），含成功与清算中交易；月度支出仅成功支出、含普通转账；两者均排除账户内换汇。说明 asOf 和 ignoredDates（对应币种来源中排除的无效/未来日期），失败不得用零金额兜底。只取流水时说明样本范围，不推断完整月总额。

三种币种分别展示，不把外币标成人民币或直接合计。旧账户编号与历史回单只用于追溯，不代表多个资金账户。

续费合计只含窗口内每个启用合约的下一次金额，不等于整月消费。日期已过不代表欠费。reminderCreated=false 时不能说已设置提醒。停用要用查询到的准确合约 ID，不等于取消商户订阅或已产生账单。

## 能力限制

需要连接微信时，引导登录网页 `/reminders`，在本页生成微信连接二维码、本人扫码和确认银行绑定；不引导普通客户使用运维账号。扫码验证码只在该页面填写，不进入模型或聊天；不可由助手代扫码或伪造已绑定结果。

不能创建扣款合约、退款或撤销已发生账单。导出用相应导出工具。停用自动扣款不免除已有账单。异常交易联动 bank-security，转账撤回联动 bank-transfer。

## 导出安全

导出链接仅限本人登录态使用；不能声称转发裸链接即可下载，不将 CSV 正文复制到模型对话。分项 AA 确认同时核对活动总额、本人份额和待收总额；不得将本人份额计入向他人收款。
