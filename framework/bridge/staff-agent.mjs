/** Staff Bearer stays in this bridge. All tools use the employee API and one-use, argument-bound consent. */
import { createHash } from 'node:crypto'
import { bankError } from './bank-error.mjs'
import { STAFF_TOOLS } from '../packages/staff-tools/src/definitions.mjs'
const enc = encodeURIComponent
const stable = value => JSON.stringify(value, (_, v) => v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.keys(v).sort().map(k => [k, v[k]])) : v)
const digest = value => createHash('sha256').update(stable(value) ?? 'null').digest('hex')
const field = (label, value, emphasis = false) => ({ label, value: String(value), emphasis })
const money = value => `¥${(value / 100).toFixed(2)}`
const text = (v, label) => { if (typeof v !== 'string' || !v.trim() || v.length > 5000) throw bankError(`${label}不能为空且不能超过 5000 字`); return v.trim() }
const choice = (v, values, label) => { if (!values.includes(v)) throw bankError(`${label}必须为 ${values.join(' / ')}`); return v }
const roles = { csr: '客服专员', supervisor: '主管', ops: '运维人员' }
const ticketStatuses = ['open', 'processing', 'waiting', 'resolved', 'suspended']
const decisions = { settle: '立即到账', intercept: '拦截转账', approved: '批准', rejected: '驳回' }
const actions = { lockCard: '锁卡', unlockCard: '解锁卡片', updateCardSettings: '修改日限额', patchAutodebit: '停用自动扣款' }
const interceptReasons = ['疑似诈骗', '收款方风险名单', '交易行为异常', '客户来电要求叫停']
// Defense in depth for legacy free-text payloads and transcripts; business tokens never leave the bridge.
export function sanitizeStaffResult(value) {
  if (Array.isArray(value)) return value.map(sanitizeStaffResult)
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value)
    .filter(([k]) => !/password|token|secret|cvv|^pan$|^accountNo$|transcript/i.test(k))
    .map(([k, v]) => [k, sanitizeStaffResult(v)]))
  if (typeof value === 'string') return value.replace(/\b\d{11,19}\b/g, '[号码已隐藏]').replace(/((?:密码|验证码|password|authorization|token)\s*[:：=]\s*)[^\s,，;；]+/gi, '$1[已隐藏]')
  return value
}

export function createStaffAgent({ baseUrl, sessions, publish, opsOnly = false, nativeTools = [] }) {
  const base = new URL(baseUrl)
  if (base.protocol !== 'https:' && !(base.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(base.hostname))) throw bankError('员工服务必须使用 HTTPS 或本机回环地址')
  const grants = new Map()
  const key = c => `${c.sessionId}\0${c.callId}`
  async function call(token, path, body, method = body === undefined ? 'GET' : 'POST', requestId) {
    if (!path.startsWith('/staff-api/')) throw bankError('员工工具不能访问客户接口', 403)
    let response
    try { response = await fetch(new URL(path, base), { method, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json',...(requestId ? {'x-staff-request-id':requestId} : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(12_000) }) }
    catch { throw bankError('无法连接员工业务服务', 503, 'STAFF_UNREACHABLE') }
    let data
    try { data = await response.json() } catch { throw bankError('员工接口响应无效', 502) }
    if (!response.ok) throw bankError(data.message ?? '员工业务请求失败', response.status, data.code)
    return data
  }
  async function authenticate(authorization) {
    const match = /^Bearer ([A-Za-z0-9_-]+)$/.exec(authorization ?? '')
    if (!match) throw bankError('请重新登录员工账户', 401, 'UNAUTHORIZED')
    const user = await call(match[1], '/staff-api/me')
    if (!user.id || !roles[user.role]) throw bankError('需要有效员工身份', 403)
    if (opsOnly && user.role !== 'ops') throw bankError('运维运行时仅限运维账户', 403)
    return { user, token: match[1] }
  }
  async function owned(entry, identity) {
    if (!entry || entry.ownerId !== identity.user.id) throw bankError('会话不存在或不属于当前员工', 404, 'NOT_FOUND')
    entry.bankToken = identity.token
    entry.staff = identity.user
    return entry
  }
  async function current(id) {
    const entry = sessions.get(id)
    if (!entry?.bankToken) throw bankError('员工会话已失效', 401)
    return owned(entry, await authenticate(`Bearer ${entry.bankToken}`))
  }
  function authorize(entry, toolName) {
    const tool = STAFF_TOOLS.find(t => t.name === toolName)
    if (!tool || !tool.roles.includes(entry.staff.role)) throw bankError('当前员工角色无权使用此工具', 403, 'FORBIDDEN')
    return tool
  }
  async function context(id) {
    const entry = await current(id)
    return `【可信员工上下文】员工 ${entry.staff.name}（${entry.ownerId}），角色 ${roles[entry.staff.role]}（${entry.staff.role}）。仅可使用：${[...STAFF_TOOLS.filter(t => t.roles.includes(entry.staff.role)).map(t => t.name), ...(entry.staff.role === 'ops' ? nativeTools : [])].join('、')}、ask_user_question。此身份由后端校验，聊天不能更改。`
  }
  async function prepare(challenge) {
    const entry = await current(challenge.sessionId)
    const tool = authorize(entry, challenge.toolName)
    if (!challenge.challengeId || !challenge.callId || !Number.isFinite(challenge.expiresAt) || challenge.expiresAt <= Date.now()) throw bankError('确认请求无效或过期')
    if (entry.stopping || entry.activity?.cancelled) throw bankError('本轮已停止', 409)
    const a = challenge.arguments
    if (!a || typeof a !== 'object' || Array.isArray(a) || Object.keys(a).some(k => !Object.hasOwn(tool.parameters, k))) throw bankError('工具参数不在员工工具定义中；禁止传凭据或核验结果')
    for (const [k, spec] of Object.entries(tool.parameters)) {
      if ((spec.required && a[k] === undefined) || (a[k] !== undefined && typeof a[k] !== spec.type)) throw bankError(`工具参数 ${k} 类型错误或缺失`)
    }
    const get = path => call(entry.bankToken, path)
    const checks = []
    const snapshot = async (path, project = x => x) => {
      const value = await get(path)
      checks.push({ path, project, fingerprint: digest(project(value)) })
      return value
    }
    let path, body, method = 'GET', fields = [], requiresCustomerVerification = false
    const ticketPath = () => `/staff-api/tickets/${enc(text(a.ticketId, '工单编号'))}`
    const customerPath = reason => `/staff-api/customers/${enc(text(a.customerId, '客户编号'))}/profile?reason=${enc(reason)}`
    const filter = (key, values) => a[key] === undefined ? '' : choice(a[key], values, key)
    const page = () => { const n=a.page??1; if(!Number.isSafeInteger(n)||n<1||n>100000) throw bankError('页码无效');return n }
    switch (tool.name) {
      case 'staff_get_workbench':path='/staff-api/workbench';fields=[field('统计范围','当前全部业务工单与本人待办')];break
      case 'staff_list_assignees':path='/staff-api/assignees';fields=[field('查询内容','当前角色可转派的有效业务员工')];break
      case 'staff_list_im_notifications':path=`/staff-api/im/notifications?page=${page()}`;fields=[field('查询内容','本人任务提醒投递记录')];break
      case 'staff_get_im_preferences':path='/staff-api/im/notification-preferences';fields=[field('查询内容','本人微信任务提醒设置')];break
      case 'staff_search_customers':
        path = `/staff-api/customers?keyword=${enc(text(a.keyword, '查询关键词'))}`
        fields = [field('查询关键词', a.keyword)]; break
      case 'staff_get_customer':
        path = customerPath(text(a.reason, '查询理由'))
        fields = [field('客户编号', a.customerId), field('查询理由', a.reason)]; break
      case 'staff_list_tickets':
        path = `/staff-api/tickets?status=${enc(filter('status', ticketStatuses))}&keyword=${enc(a.keyword ?? '')}&assignee=${enc(a.assignee??'')}&page=${page()}&size=30`
        fields = [field('工单状态', a.status ?? '全部'), field('关键词', a.keyword || '全部')]; break
      case 'staff_get_ticket':
        path = ticketPath(); fields = [field('工单编号', a.ticketId)]; break
      case 'staff_create_ticket': {
        const customer = await get(customerPath('核对新建工单客户'))
        path = '/staff-api/tickets'; method = 'POST'
        body = { customerId: customer.customerId, reason: text(a.reason, '工单事由'), channel: choice(a.channel ?? 'web', ['app', 'im', 'web'], '渠道'), priority: choice(a.priority ?? 'normal', ['normal', 'high'], '优先级') }
        fields = [field('客户', `${customer.name} · ${customer.customerId}`), field('事由', body.reason), field('渠道', body.channel), field('优先级', body.priority)]; break
      }
      case 'staff_assign_ticket': {
        const ticket=await snapshot(ticketPath(),t=>({id:t.ticketId,status:t.status,assigneeId:t.assigneeId,version:t.version,updatedAt:t.updatedAt}))
        if(ticket.status==='resolved') throw bankError('已解决工单不能转派',409)
        const targets=await get('/staff-api/assignees'),target=targets.find(v=>v.id===a.assigneeId)
        if(!target) throw bankError('请选择真实可转派的员工',403)
        path=`${ticketPath()}/status`;method='PATCH';body={status:ticket.status,assigneeId:target.id,expectedVersion:ticket.version}
        fields=[field('工单',a.ticketId),field('原负责人',ticket.assigneeId??'未分配'),field('新负责人',`${target.name} · ${roles[target.role]}`,true)];break
      }
      case 'staff_update_ticket_status':
      case 'staff_post_ticket_message': {
        const ticket = await snapshot(ticketPath(), t => ({ id: t.ticketId, customerId: t.customerId, status: t.status, assigneeId: t.assigneeId, version:t.version,updatedAt: t.updatedAt }))
        path = `${ticketPath()}/${tool.name === 'staff_post_ticket_message' ? 'messages' : 'status'}`
        method = tool.name === 'staff_post_ticket_message' ? 'POST' : 'PATCH'
        body = method === 'POST' ? { text: text(a.text, '回复正文'),visibleToCustomer:a.visibleToCustomer??false,expectedVersion:ticket.version } : { status: choice(a.status, ticketStatuses, '目标状态'),expectedVersion:ticket.version }
        if (method === 'PATCH' && ticket.status === body.status) throw bankError('工单已经处于目标状态，不需要重复更新', 409)
        fields = [field('工单', a.ticketId), field('客户', ticket.customerName ?? ticket.customerId), field('当前状态', ticket.status), field(method === 'POST' ? '回复正文' : '目标状态', body.text ?? body.status, true),...(method==='POST'?[field('对话可见范围','客户自建工单对话对客户可见；员工内部工单整单不公开'),field('额外客户端收件箱提醒',body.visibleToCustomer?'发送':'不发送（不代表私密留言）')]:[])]; break
      }
      case 'staff_create_approval': {
        const customer=await get(customerPath('核对审批申请客户'))
        const bizType=choice(a.bizType,['transfer','card_lock','limit_adjust','wealth_subscribe','other'],'审批类型')
        const payload={customerId:customer.customerId,reason:text(a.reason,'申请事由')}
        if(['card_lock','limit_adjust'].includes(bizType)) {
          if(!customer.cards?.some(v=>v.id===a.cardId)) throw bankError('卡片不存在或不属于客户',404)
          payload.cardId=a.cardId
          if(bizType==='limit_adjust') payload.dailyLimit=choice(a.dailyLimit,[200000,500000,1000000,5000000],'限额')
        }
        if(bizType==='wealth_subscribe') {payload.productId=text(a.productId,'产品编号');if(!Number.isSafeInteger(a.amount)||a.amount<=0)throw bankError('申请金额必须为正整数分');payload.amount=a.amount}
        body={customerId:customer.customerId,bizType,payload}
        let transferFields=[]
        if(bizType==='transfer') {
          body.transferId=text(a.transferId,'在途指令编号')
          const records=await get(`/staff-api/approvals?status=pending&transferId=${enc(body.transferId)}`)
          const existing=records.find(v=>v.bizType==='transfer'&&v.payload?.transactionId===body.transferId&&v.payload?.customerId===customer.customerId)
          if(!existing)throw bankError('未找到该客户有效的在途处置记录，请刷新后再申请',409)
          const frozen=await snapshot(`/staff-api/approvals/${enc(existing.approvalId)}`)
          if(frozen.status!=='pending'||!Number.isFinite(Date.parse(frozen.payload?.holdUntil))||Date.parse(frozen.payload.holdUntil)<=Date.now())throw bankError('在途处置窗口已结束',409)
          transferFields=[field('原在途指令',body.transferId),field('冻结业务参数',JSON.stringify(sanitizeStaffResult(frozen.payload))),field('处置截止',frozen.payload.holdUntil)]
        }
        path='/staff-api/approvals';method='POST';fields=[field('客户',`${customer.name} · ${customer.customerId}`),field('业务类型',bizType),field('申请信息',JSON.stringify(payload)),...transferFields,field('结果','仅创建审批申请，不执行资金业务')];break
      }
      case 'staff_list_approvals':
        path = `/staff-api/approvals?status=${enc(filter('status', ['pending', 'approved', 'rejected', 'settled', 'intercepted', 'recalled']))}&page=${page()}&size=30`
        fields = [field('处置状态', a.status ?? '全部')]; break
      case 'staff_get_approval':
        path = `/staff-api/approvals/${enc(text(a.approvalId, '处置编号'))}`
        fields = [field('处置编号', a.approvalId)]; break
      case 'staff_decide_approval': {
        const approvalPath = `/staff-api/approvals/${enc(text(a.approvalId, '处置编号'))}`
        const approval = await snapshot(approvalPath)
        if (approval.status !== 'pending') throw bankError('处置记录已处理，请重新查询', 409)
        if (approval.applicantId === entry.ownerId) throw bankError('不能处置自己发起的记录', 403)
        const isTransfer = approval.bizType === 'transfer'
        if (isTransfer && (!Number.isFinite(Date.parse(approval.payload?.holdUntil)) || Date.parse(approval.payload.holdUntil) <= Date.now())) throw bankError('转账处置窗口已结束，请重新查询', 409)
        const decision = choice(a.decision, isTransfer ? ['settle', 'intercept'] : ['approved', 'rejected'], '处置决定')
        body = { decision }
        if (decision === 'intercept') body.reasonCode = choice(a.reason, interceptReasons, '拦截理由')
        else if (decision === 'rejected') body.reason = text(a.reason, '驳回理由')
        else if (a.reason) body.reason = text(a.reason, '处理理由')
        path = `${approvalPath}/decide`; method = 'POST'
        fields = [field('处置编号', a.approvalId), field('业务类型', approval.bizType), field('决定', decisions[decision], true), ...(isTransfer ? [field('付款金额', `${approval.payload.request?.confirmedQuote?.fromCurrency ?? '币种见业务参数'} ${(approval.payload.amount / 100).toFixed(2)}`, true), field('收款人', approval.payload.request?.payeeName ?? '见冻结业务参数'), field('处置截止', approval.payload.holdUntil)] : []), field('冻结业务参数', JSON.stringify(sanitizeStaffResult(approval.payload))), field('风险摘要', approval.riskSummary), field('理由', a.reason || '未填写')]; break
      }
      case 'staff_customer_action': {
        const action = choice(a.action, Object.keys(actions), '代客操作')
        const ticket = await snapshot(ticketPath(), t => ({ customerId: t.customerId, status: t.status, assigneeId: t.assigneeId }))
        if (ticket.customerId !== a.customerId) throw bankError('工单不属于该客户', 403)
        if (['resolved', 'suspended'].includes(ticket.status)) throw bankError('需要正在受理的客户工单', 409)
        const profilePath = customerPath(text(a.reason, '办理理由'))
        const select = p => action === 'patchAutodebit' ? p.autoDebits?.find(v => v.id === a.autoDebitId) : p.cards?.find(v => v.id === a.cardId)
        const profile = await snapshot(profilePath, select)
        const target = select(profile)
        if (!target) throw bankError('卡片或签约不存在或不属于该客户', 404)
        if (action !== 'patchAutodebit' && target.status === 'replaced') throw bankError('已换卡的旧卡不能办理', 409)
        body = { ticketId: a.ticketId, reason: a.reason }
        if (action === 'patchAutodebit') { body.autoDebitId = text(a.autoDebitId, '签约编号'); body.enabled = false }
        else body.cardId = text(a.cardId, '卡片编号')
        if (action === 'updateCardSettings') {
          if (!Number.isSafeInteger(target.dailyLimit)) throw bankError('后台未提供当前卡片限额，无法核对变更，请更新员工业务服务', 503)
          body.dailyLimit = choice(a.dailyLimit, [200000, 500000, 1000000, 5000000], '日限额（分）')
        }
        path = `/staff-api/customers/${enc(a.customerId)}/actions/${action}`; method = 'POST'; requiresCustomerVerification = true
        fields = [field('客户', `${profile.name} · ${profile.customerId}`), field('工单编号', a.ticketId), field('操作', actions[action], true), field('目标', action === 'patchAutodebit' ? `${target.merchant ?? ''} · ${a.autoDebitId}` : `尾号 ${target.last4} · ${a.cardId}`), ...(body.dailyLimit ? [field('当前日限额', money(target.dailyLimit)), field('新日限额', money(body.dailyLimit), true)] : []), field('理由', a.reason)]; break
      }
      case 'staff_get_transfer_threshold':
        path = '/staff-api/settings/transfer-threshold'; fields = [field('查询内容', '延迟到账阈值')]; break
      case 'staff_set_transfer_threshold': {
        path = '/staff-api/settings/transfer-threshold'
        const setting = await snapshot(path)
        const next = a.transferReviewCents
        if (!Number.isSafeInteger(next) || next <= 0 || next > setting.maxTransferReviewCents) throw bankError('新阈值必须为正整数分且不超过后台上限')
        body = { transferReviewCents: next }; method = 'PUT'
        fields = [field('当前阈值', money(setting.transferReviewCents)), field('新阈值', money(next), true)]; break
      }
      case 'staff_audit_logs':
        path = '/staff-api/audit-logs'; fields = [field('查询范围', '最近 30 条员工审计记录')]; break
      case 'staff_operations_overview':
        path = '/staff-api/ops/overview'; fields = [field('查询范围', '服务、数据库、会话与告警汇总')]; break
      default: throw bankError('员工工具未实现', 403)
    }
    const expiresAt = Math.min(challenge.expiresAt, Date.now() + 180_000)
    const prepared = { challenge: { challengeId: challenge.challengeId, sessionId: challenge.sessionId, callId: challenge.callId, toolName: tool.name, kind: tool.kind,
      createdAt: Date.now(), expiresAt, fields: [field('操作员工', `${entry.staff.name} · ${roles[entry.staff.role]}`), ...fields], requiresCustomerVerification,
      consequence: tool.write ? '确认后提交员工业务后台，以实际回执为准。' : '查询结果会显示在本次员工对话中。' },
      path, method, body, checks, fingerprint: digest(a), ownerId: entry.ownerId, role: entry.staff.role,authVersion:entry.staff.authVersion, activity: entry.activity, approved: false }
    const k = key(challenge)
    if (grants.has(k)) throw bankError('工具调用已存在确认', 409)
    prepared.timer = setTimeout(() => grants.delete(k), expiresAt - Date.now()); prepared.timer.unref()
    grants.set(k, prepared)
    return prepared.challenge
  }
  function forget(challenge) { const g = grants.get(key(challenge)); if (g) clearTimeout(g.timer); grants.delete(key(challenge)) }
  async function approve(challenge, verification) {
    const entry = await current(challenge.sessionId)
    authorize(entry, challenge.toolName)
    const g = grants.get(key(challenge))
    if (!g || g.challenge.challengeId !== challenge.challengeId || g.challenge.expiresAt <= Date.now()) throw bankError('确认已过期', 404)
    if (g.approved || g.activity !== entry.activity || g.role !== entry.staff.role || g.authVersion!==entry.staff.authVersion || entry.stopping || entry.activity?.cancelled) throw bankError('本轮确认已处理或失效', 409)
    if (g.challenge.requiresCustomerVerification) {
      if (!verification || verification.result !== 'passed' || !['phone', 'sms', 'face'].includes(verification.method)) throw bankError('请由员工在确认卡中完成客户身份核验', 400, 'CUSTOMER_VERIFICATION_REQUIRED')
      g.body.verificationMethod = verification.method; g.body.verificationResult = 'passed'
    }
    g.approved = true
  }
  async function execute(input) {
    const entry = await current(input.sessionId)
    const tool = authorize(entry, input.toolName)
    const g = grants.get(key(input))
    if (!g || !g.approved || g.activity !== entry.activity || g.ownerId !== entry.ownerId || g.role !== entry.staff.role || g.challenge.toolName !== input.toolName || g.fingerprint !== digest(input.arguments) || g.challenge.expiresAt <= Date.now() || entry.stopping || entry.activity?.cancelled) throw bankError('缺少本次操作的员工授权', 403, 'CONSENT_REQUIRED')
    forget(g.challenge) // Consume before any async operation: retries or simultaneous requests cannot replay a write.
    for (const check of g.checks) {
      const fresh = await call(entry.bankToken, check.path)
      if (digest(check.project(fresh)) !== check.fingerprint) throw bankError('业务状态已变化，请重新查询并确认', 409, 'STALE_CONFIRMATION')
    }
    if (entry.stopping || g.activity?.cancelled || g.activity !== entry.activity) throw bankError('本轮已停止，未提交操作', 409)
    // Revalidate employee identity immediately before submitting after metadata lookups.
    await current(input.sessionId); authorize(entry, input.toolName)
    if (g.role !== entry.staff.role || entry.stopping || g.activity?.cancelled || g.activity !== entry.activity) throw bankError('员工角色或运行状态已变化，未提交操作', 409)
    if(g.authVersion!==entry.staff.authVersion) throw bankError('员工权限版本已变化，请重新确认',409)
    const data = await call(entry.bankToken, g.path, g.body, g.method, tool.write ? digest({session:input.sessionId,call:input.callId}) : undefined)
    if (tool.write) publish(input.sessionId, { type: 'bank-updated' })
    let result = sanitizeStaffResult(data)
    if (Array.isArray(result?.items) && result.items.length>30) result={...result,items:result.items.slice(0,30),returned:30,truncated:true,notice:'此页仅展示前30项，保留后台总数与页码；不是完整业务历史。'}
    if (Array.isArray(result)) result = { items: result.slice(0, 30), returned: Math.min(result.length, 30), truncated: result.length > 30, notice: '仅返回后台有限的最近记录；请缩小查询范围，不代表完整业务历史。' }
    else if (tool.name === 'staff_get_ticket' && result.messages) result.messages = result.messages.slice(-30)
    return { dataSource: 'http', audience: 'staff', result }
  }
  function forgetSession(sessionId) { for (const g of grants.values()) if (g.challenge.sessionId === sessionId) forget(g.challenge) }
  function close() { for (const g of grants.values()) clearTimeout(g.timer); grants.clear() }
  async function approveRoutineQuery(challenge) {
    const g=grants.get(key(challenge))
    if(!g || g.challenge.challengeId!==challenge.challengeId || g.challenge.toolName!==challenge.toolName || g.method!=='GET' || g.body!==undefined || g.challenge.requiresCustomerVerification || !STAFF_TOOLS.some(v=>v.name===challenge.toolName&&!v.write&&v.roles.some(r=>['csr','supervisor'].includes(r)))) return false
    await approve(challenge);return true
  }
  return { authenticate, owned, current, context, prepare, approve, approveRoutineQuery, execute, forget, forgetSession, close }
}
