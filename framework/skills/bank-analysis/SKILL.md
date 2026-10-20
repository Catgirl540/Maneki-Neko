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
      "bank_list_autodebits",
      "bank_analyze_autodebits",
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

查询某笔消费、整月支出、收支变化或扣款合约时使用；用户说“这笔不对”先定位交易，不先认定盗刷。

## 必要信息

用户明确要求微信日程提醒时，确定内容、具体日期、北京时间和本人接收私聊。bank_list_im_reminders 查询现有记录与连接；bank_create_im_reminder 必须经过独立确认卡，不需要支付密码。到期仅发送用户确认的文字，不读取余额或执行扣款。时间不明确先补问，不能从“看看理财”自行建立提醒。scheduled 仅表示已保存，sent 表示微信接口已确认而非用户已读，unknown 不可自动重发，须先核实。取消先查实际编号，bank_cancel_im_reminder 仅能取消尚未发送的提醒，也要确认。

确定账户与时间范围。月度分析接受 YYYY-MM；现金流工具支持最近 7 或 30 天。交易和合约需查询所得编号，不能从商户名或尾号猜编号。

## 办理步骤

账户未知先 bank_get_balance，明细用 bank_list_transactions 与 bank_get_transaction_detail。月度总额用 bank_get_spending，现金流用 bank_get_cashflow。
用户询问重复扣款、金额突增或异常流水时，确定本人账户/币种后用 bank_review_transactions；每次只检查银行第一页 20–200 条（默认 100）样本，报告 returnedCount、bankTotal、truncated 和实际时间范围，不声称最近或完整月/年。只分析成功的餐饮、购物、住房、交通、订阅支出；工资、转账、其他、收入、未完成、无效及未来日期不作异常支出依据。
重复候选来自同商户同金额 5 分钟记录；金额突增至少 100 元/对应币种单位，并达到先前 90 天样本中同商户中位数 3 倍，且有至少 3 个不同北京时间日期的先前记录。展示实际交易编号、金额、时间及历史依据；提示核对，不认定欺诈/重复收费，不将没有候选说成安全。不自动锁卡、退款或报案；需要核查时再查真实回单，用户明确要求时联动人工服务或安全技能。
已有扣款用 bank_list_autodebits 查询；多个同名合约先提问确认，明确启停后调用 bank_set_autodebit。不要把查询扣款理解为要求关闭。

询问订阅续费、近期代扣或重复签约时用 bank_analyze_autodebits，支持从北京时间今天起 7、30、90 个自然日（含今天、不含结束日），默认 30 天。只整理银行已有合约记录的下一次扣款，不从名称猜测所有商户订阅，也不把周期文本展开成多次扣款。分别展示即将扣款、过去日期、日期未知和停用项目；同名启用合约只是待核对候选，不自动停用。

## 结果说明

说明月份、币种、单位与数据范围；金额单位分需换算展示。月度统计按北京时间，趋势截至所选月，previousMonth/previousTotal 是所选月的上一个完整月。monthOverMonthComparable=false 时说明上月无可比支出基数，不把兼容数值 0 当作环比 0%。periodStatus=partial 时是本月至查询时点对上月全月，不是同天数环比。现金流是最近自然日（含今天），独立于支出月份，含成功及清算中交易；月度支出仅成功支出且含普通转账，两者均排除账户内换汇。说明 asOf 和 ignoredDates（对应币种来源中排除的无效/未来日期），失败不得用零金额兜底。只取最近流水时说明样本范围，不推断完整月总额。

人民币、美元和港币分别展示，不能把外币金额标成人民币或直接合计。旧账户编号及历史回单快照只用于兼容与追溯，不代表客户有多个资金账户；当前归属以账户查询结果为准。

续费合计仅包含窗口内每个启用合约的下一次金额，不等于整月/年度消费。日期已过不代表欠费或扣款失败。工具返回 reminderCreated=false；不能说“已经设置提醒/将自动通知”。停用请求使用查询所得准确合约 ID，继续逐次确认；停用代扣不等于取消商户订阅或已产生账单。

## 能力限制

不能创建扣款合约、退款、撤销已发生账单或导出账单文件；导出引导「账单与交易」。停用自动扣款不免除已有账单。异常交易联动 bank-security，转账撤回联动 bank-transfer。
