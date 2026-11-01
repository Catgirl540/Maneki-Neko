import { calculateAaAllocation, normalizeAaMembers } from '../../shared/aa-payments.mjs'
import { calculateSplitCollection } from '../../shared/split-collection.mjs'
import { bankError } from './bank-error.mjs'
const enc = encodeURIComponent
const text = (value, label) => { if (typeof value !== 'string' || !value.trim() || value.length > 160) throw bankError(`请提供有效的${label}`); return value.trim() }
const cents = value => { if (!Number.isSafeInteger(value) || value < 1 || value > 100000000) throw bankError('金额须为 1 至 100000000 整数分'); return value }
const field = (label, value, emphasis = false) => ({ label, value: String(value), ...(emphasis ? { emphasis: true } : {}) })
const money = (amount, currency) => `${currency} ${(amount / 100).toFixed(2)}`
const time = value => new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', dateStyle: 'medium', timeStyle: 'short', hour12: false }).format(new Date(value)) + '（北京时间）'
export const extendedPasswordTools = ['bank_schedule_transfer', 'bank_report_card_lost', 'bank_recover_card', 'bank_create_birthday_plan']
export const extendedWriteTools = [...extendedPasswordTools, 'bank_cancel_scheduled_transfer', 'bank_update_payee_remark', 'bank_create_split_collection', 'bank_cancel_split_collection', 'bank_confirm_split_payment', 'bank_prepare_split_reminder', 'bank_cancel_birthday_plan', 'bank_confirm_birthday_order', 'bank_create_renewal_reminder']
export const extendedQueryTools = ['bank_list_scheduled_transfers', 'bank_list_split_collections', 'bank_get_billing_report', 'bank_wealth_recommend', 'bank_find_subscription_candidates', 'bank_list_birthday_plans']

/** Reads authoritative data and prepares a review. No instruction is submitted here. */
export async function prepareExtendedBankOperation(name, a, { get, post, requestId }) {
  switch (name) {
    case 'bank_list_scheduled_transfers': return { path: '/api/transfers/scheduled', fields: [field('查询内容', '本人定时转账及实际执行状态')] }
    case 'bank_list_split_collections': return { path: '/api/transfers/splits', fields: [field('查询内容', '本人 AA 收款单及有流水证据的付款状态')] }
    case 'bank_list_birthday_plans': return { path: '/api/linked/birthdays', fields: [field('查询内容', '本人生日预留计划、资金预留及订购待办状态')] }
    case 'bank_get_billing_report': {
      if (!['month', 'year'].includes(a.period) || !['CNY', 'USD', 'HKD'].includes(a.currency)) throw bankError('请选择 month/year 周期及明确币种')
      const value = text(a.value, '统计年月')
      if (!(a.period === 'year' ? /^\d{4}$/ : /^\d{4}-(0[1-9]|1[0-2])$/).test(value)) throw bankError('统计年月格式无效')
      return { path: '/api/statistics/report?' + new URLSearchParams({ period: a.period, value, currency: a.currency }), fields: [field('报告周期', value), field('币种', a.currency), field('口径', '本人该币种全部成功记账流水，排除账户内换汇；本期截至查询时点')] }
    }
    case 'bank_wealth_recommend':
      cents(a.amountCents)
      return { path: '/api/wealth/products', fields: [field('拟投入金额', money(a.amountCents, 'CNY')), field('流动性', a.liquidity === 'open' ? '开放式' : '不限'), field('筛选说明', '依据有效风险测评、金额与期限，低风险后低费用透明排序，不预测收益、不申购')] }
    case 'bank_find_subscription_candidates': {
      const account = await get('/api/accounts/' + enc(text(a.accountId, '币种余额编号')))
      return { path: '/api/accounts/' + enc(account.id) + '/transactions?page=1&size=200', preview: { subscriptionAccount: account }, fields: [field('币种', account.currency), field('识别范围', '本人该币种第一页至多 200 条流水；周期支出仅为有证据的订阅候选，不创建提醒或取消商户订阅')] }
    }
    case 'bank_schedule_transfer': {
      const account = await get('/api/accounts/' + enc(text(a.fromAccountId, '付款币种余额编号')))
      const body = { fromAccountId: account.id, channel: 'bank', scope: 'domestic', payeeBankRegion: 'CN', payeeBankCode: text(a.payeeBankCode, '内地银行代码'), payeeName: text(a.payeeName, '收款人姓名'), payeeAccountNo: text(a.payeeAccountNo, '完整账号'), amount: cents(a.amountCents), memo: a.memo ?? '', executeAt: text(a.executeAt, '定时执行时间'), confirmed: true, clientRequestId: requestId }
      if (!/^\d{12,19}$/.test(body.payeeAccountNo)) throw bankError('请提供 12–19 位完整收款账号')
      const at = Date.parse(body.executeAt)
      if (!/T.*(?:Z|\+08:00)$/.test(body.executeAt) || !Number.isFinite(at) || at < Date.now() + 60000 || at > Date.now() + 366 * 86400000) throw bankError('执行时间须带时区并在一分钟后至未来 366 天内')
      await post('/api/transfers/recipient', { bankCode: body.payeeBankCode, bankRegion: 'CN', accountOrCardNo: body.payeeAccountNo, payeeName: body.payeeName })
      return { path: '/api/transfers/scheduled', body, fields: [field('收款人', body.payeeName), field('完整账号', body.payeeAccountNo), field('收款银行', body.payeeBankCode + ' · CN'), field('金额', money(body.amount, account.currency), true), field('执行时间', time(at), true), field('授权范围', '境内同币种、零转账费；到期按当时余额及风控执行一次；创建不冻结，可提前取消。')] }
    }
    case 'bank_cancel_scheduled_transfer': {
      const id = text(a.planId, '定时转账编号'), path = '/api/transfers/scheduled'
      const plan = (await get(path)).find(row => row.id === id)
      if (!plan || plan.status !== 'scheduled') throw bankError('找不到本人尚未执行的定时转账', 409)
      return { path: path + '/' + enc(id), method: 'DELETE', body: { version: plan.version }, preview: { extendedSnapshot: { path, id, record: plan } }, fields: [field('取消定时转账', plan.id, true), field('收款人', plan.payeeName), field('金额', money(plan.amount, plan.currency)), field('原执行时间', time(plan.executeAt)), field('说明', '取消未来指令；不撤回已执行交易、不退款。')] }
    }
    case 'bank_update_payee_remark': {
      const id = text(a.payeeId, '收款人编号'), path = '/api/payees'
      const payee = (await get(path)).find(row => row.id === id)
      if (!payee) throw bankError('收款人不存在或不属于本人', 404)
      if (typeof a.remark !== 'string' || a.remark.length > 140 || /[\x00-\x1f\x7f]/.test(a.remark)) throw bankError('备注最多 140 字且不能包含控制字符')
      return { path: path + '/' + enc(id), method: 'PATCH', body: { remark: a.remark }, preview: { extendedSnapshot: { path, id, record: payee } }, fields: [field('收款人', payee.name), field('新备注', a.remark || '清空备注', true)] }
    }
    case 'bank_create_split_collection': {
      if (a.members !== undefined) {
        if (['amountCents', 'participantNames', 'collectorName', 'expenses'].some(key => a[key] !== undefined)) throw bankError('手机号 AA 请仅提供 members，不混用旧均分参数')
        let raw
        try { raw = JSON.parse(a.members) } catch { throw bankError('AA 成员须为 JSON 数组') }
        const { members, amount } = normalizeAaMembers(raw)
        let allocationInput
        if (a.allocation !== undefined) {
          try { allocationInput = JSON.parse(a.allocation) } catch { throw bankError('均分清单须为有效 JSON') }
        }
        const allocation = calculateAaAllocation(allocationInput, members)

        if (!['CNY', 'USD', 'HKD'].includes(a.currency)) throw bankError('币种无效')
        return { path: '/api/transfers/splits', body: { title: text(a.title, '收款事由'), currency: a.currency, members, ...(allocationInput !== undefined ? { allocation: allocationInput } : {}), confirmed: true, clientRequestId: requestId }, fields: [field('AA 事由', a.title), ...(allocation?.expenses ? allocation.expenses.map(item => field(item.title, `${money(item.amount, a.currency)}；${item.shares.map(share => `${share.name} ${money(share.amount, a.currency)}`).join('，')}`)) : []), ...members.map(item => field(item.phone, `${money(item.amount, a.currency)}；转账备注：${item.memo}`)), field('待收总额', money(amount, a.currency), true), field('通知范围', '确认后向这些手机号对应的本行账号发送站内付款通知，可在 AA 付款的待付款模块查看；成员须自行确认并验证支付密码，不自动扣款，不发送短信或微信。')] }
      }

      let input
      try {
        input = a.expenses !== undefined
          ? { collectorName: a.collectorName, expenses: JSON.parse(a.expenses), ...(a.amountCents !== undefined ? { amount: a.amountCents } : {}), ...(a.participantNames !== undefined ? { participants: JSON.parse(a.participantNames) } : {}) }
          : { amount: a.amountCents, participants: JSON.parse(a.participantNames) }
      } catch { throw bankError('参与者或分项消费须为有效 JSON 数组') }
      const result = calculateSplitCollection(input)
      if (!['CNY', 'USD', 'HKD'].includes(a.currency)) throw bankError('币种无效')
      return { path: '/api/transfers/splits', body: { title: text(a.title, '收款事由'), currency: a.currency, ...input, clientRequestId: requestId }, fields: [field('AA 事由', a.title),
        ...(result.expenses ? [field('收款人（已垫付全部消费）', result.collectorName), ...result.expenses.map(item => field(item.title, `${money(item.amount, a.currency)}；${item.shares.map(share => `${share.name} ${money(share.amount, a.currency)}`).join('，')}`)), field('本人份额', money(result.selfAmount, a.currency))] : []),
        field('待收总额', money(result.amount, a.currency), true), ...result.participants.map(person => field(person.name, money(person.amount, a.currency))), field('说明', '创建收款记录，不扣参与者资金、不发送催收；回款须匹配本人成功转入流水。')] }
    }
    case 'bank_cancel_split_collection':
    case 'bank_confirm_split_payment':
    case 'bank_prepare_split_reminder': {
      const id = text(a.collectionId, 'AA 单号'), path = '/api/transfers/splits'
      const row = (await get(path)).find(item => item.id === id)
      if (!row || row.status !== 'open') throw bankError('AA 收款单不存在或已关闭', 409)
      const cancelling = name === 'bank_cancel_split_collection', payment = name === 'bank_confirm_split_payment'
      const person = cancelling ? null : row.participants.find(item => item.id === text(a.participantId, '参与者编号'))
      if (!cancelling && (!person || person.status !== 'unpaid')) throw bankError('参与者不存在或已收款', 409)
      const body = { version: row.version, ...(!cancelling ? { participantId: person.id } : {}), ...(payment ? { transactionId: text(a.transactionId, '本人成功转入流水编号') } : {}) }
      return { path: path + '/' + enc(id) + (cancelling ? '' : payment ? '/payments' : '/reminders'), method: cancelling ? 'DELETE' : 'POST', body, preview: { extendedSnapshot: { path, id, record: row } }, fields: [field('AA 单', row.title), field('操作', cancelling ? '取消未收份额' : payment ? '以成功转入流水确认收款' : '生成待自行发送的催收文字', true), ...(person ? [field('参与者', person.name), field('应收金额', money(person.amount, row.currency))] : []), ...(payment ? [field('匹配流水', a.transactionId)] : []), field('说明', '不改资金余额、不代扣、不退款；催收文字不会自动发送。')] }
    }
    case 'bank_create_birthday_plan': {
      const body = { contactName: text(a.contactName, '联系人姓名'), relationship: text(a.relationship, '关系'), eventDate: text(a.eventDate, '生日日期'), amountCents: cents(a.amountCents), currency: a.currency ?? 'CNY', ...(a.accountId ? { accountId: a.accountId } : {}) }
      const terms = await post('/api/linked/birthdays/preview', body)
      return { path: '/api/linked/birthdays', body: { ...body, confirmed: true, requestId }, preview: { birthdayTerms: terms }, fields: [field('联系人与关系', terms.contactName + ' · ' + terms.relationship), field('生日', terms.eventDate), field('预留金额', money(terms.amountCents, terms.currency), true), field('预留时间', time(terms.reserveAt)), field('订购待办时间', time(terms.orderAt)), field('说明', terms.notice)] }
    }
    case 'bank_cancel_birthday_plan':
    case 'bank_confirm_birthday_order': {
      const id = text(a.planId, '生日计划编号'), path = '/api/linked/birthdays'
      const plan = (await get(path)).find(row => row.id === id)
      if (!plan) throw bankError('生日计划不存在或不属于本人', 404)
      const cancel = name === 'bank_cancel_birthday_plan'
      return { path: path + '/' + enc(id) + (cancel ? '/cancel' : '/order'), body: { confirmed: true }, preview: { extendedSnapshot: { path, id, record: plan } }, fields: [field('联系人', plan.contactName), field('生日', plan.eventDate), field('操作', cancel ? '取消计划并释放本计划预留' : '确认鲜花蛋糕订购待办', true), field('预留金额', money(plan.amountCents, plan.currency)), field('说明', cancel ? '只释放本计划冻结，不改其他资金冻结。' : '尚未接入商户，确认后仍为等待商户接入；不会真实下单或扣款。')] }
    }
    default: return null
  }
}
