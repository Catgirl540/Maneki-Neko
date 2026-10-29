import test from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'
import { fixture as bankFixture, testOptions } from '../../server/testing/http-fixture.mjs'
import { createStaffAgent, sanitizeStaffResult } from './staff-agent.mjs'
import { prepareTransfer } from './transfer-agent.mjs'
import { checkPolicy } from '../scripts/check-staff-tool-policy.mjs'

test('员工工具在独立 PostgreSQL HTTP 后端验证权限、确认与真实业务', { ...testOptions, timeout: 60000 }, async t => {
  const backend = await bankFixture({ reviewThreshold: 50000000, holdSeconds: 300 })
  const root = fileURLToPath(new URL('../../', import.meta.url))
  const base = backend.base
  const api = async (path, token, body, method = body === undefined ? 'GET' : 'POST') => {
    const res = await fetch(base + path, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
    const value = await res.json(); if (!res.ok) throw Object.assign(Error(value.message), { status: res.status }); return value
  }
  const sessions = new Map(), events = []
  const agent = createStaffAgent({ baseUrl: base, sessions, publish: (id, event) => events.push({ id, ...event }) })
  const input = (id, name, args = {}) => ({ sessionId: id, callId: randomUUID(), challengeId: randomUUID(), toolName: name, arguments: args, expiresAt: Date.now() + 60_000 })
  const exec = async (id, name, args = {}, verification) => {
    const i = input(id, name, args); const c = await agent.prepare(i); await agent.approve(c, verification); return agent.execute(i)
  }
  try {
    const csr = await backend.staffLogin('王小明')
    const supervisor = await backend.staffLogin('李主管')
    const ops = await backend.staffLogin('运维人员')
    for (const [id, who] of [['csr', csr], ['supervisor', supervisor], ['ops', ops]]) sessions.set(id, { ownerId: who.staff.id, bankToken: who.token, activity: { cancelled: false }, stopping: false })
    let customerId, cardId, ticketId, customerLogin
    await t.test('配置只允许员工业务工具和提问工具', () => assert.equal(checkPolicy(join(root, 'framework/profiles/staff/cordis.patch.yml')), 21))
    await t.test('拒绝客户令牌和跨员工会话', async () => {
      const sms = await api('/api/auth/sms-code', null, { phone: '13800138000' })
      const customer = await api('/api/auth/login', null, { phone: '13800138000', password: '123456', smsCode: sms.demoCode })
      customerLogin = customer
      await assert.rejects(agent.authenticate(`Bearer ${customer.token}`), e => [401, 403].includes(e.status))
      await assert.rejects(agent.owned(sessions.get('csr'), await agent.authenticate(`Bearer ${supervisor.token}`)), e => e.status === 404)
      assert((await agent.context('csr')).includes('客服专员'))
    })
    await t.test('客服不能处置、修改阈值或查审计，运维不能查客户', async () => {
      for (const name of ['staff_decide_approval', 'staff_set_transfer_threshold', 'staff_audit_logs', 'bank_transfer']) await assert.rejects(agent.prepare(input('csr', name)), e => e.status === 403)
      await assert.rejects(agent.prepare(input('ops', 'staff_search_customers', { keyword: '张' })), e => e.status === 403)
      await assert.rejects(agent.prepare(input('supervisor', 'staff_operations_overview')), e => e.status === 403)
      assert.equal((await exec('ops', 'staff_operations_overview')).audience, 'staff')
    })
    await t.test('查询客户资料取真实编号，写入前没有建单', async () => {
      const customers = (await exec('csr', 'staff_search_customers', { keyword: '13800138000' })).result.items
      assert(customers.length); customerId = customers[0].customerId
      const profile = (await exec('csr', 'staff_get_customer', { customerId, reason: '测试办理锁卡' })).result
      assert(profile.cards.length); cardId = profile.cards[0].id
      const i = input('csr', 'staff_create_ticket', { customerId, reason: '工作人员助手回归测试' }); const c = await agent.prepare(i)
      await assert.rejects(agent.execute(i), e => e.code === 'CONSENT_REQUIRED')
      assert.equal((await api('/staff-api/tickets', csr.token)).length, 0)
      await agent.approve(c); ticketId = (await agent.execute(i)).result.ticketId
      assert(ticketId); assert.equal((await api(`/staff-api/tickets/${ticketId}`, csr.token)).customerId, customerId)
    })
    await t.test('参数替换、重复执行和取消不会产生重复写入', async () => {
      const i = input('csr', 'staff_post_ticket_message', { ticketId, text: '已受理您的业务' }); const c = await agent.prepare(i); await agent.approve(c)
      await assert.rejects(agent.execute({ ...i, arguments: { ...i.arguments, text: '未经员工授权的正文' } }), e => e.code === 'CONSENT_REQUIRED')
      await agent.execute(i); await assert.rejects(agent.execute(i), e => e.code === 'CONSENT_REQUIRED')
      const cancelled = input('csr', 'staff_post_ticket_message', { ticketId, text: '不会发送的回复' }); agent.forget(await agent.prepare(cancelled))
      await assert.rejects(agent.execute(cancelled), e => e.code === 'CONSENT_REQUIRED')
      assert.equal((await api(`/staff-api/tickets/${ticketId}`, csr.token)).messages.length, 1)
    })
    await t.test('代客核验由员工卡片提供，拒绝模型伪造和跨客户工单', async () => {
      const args = { customerId, ticketId, cardId, action: 'lockCard', reason: '客户要求锁卡' }
      await assert.rejects(agent.prepare(input('csr', 'staff_customer_action', { ...args, verificationResult: 'passed' })))
      const others = (await exec('csr', 'staff_search_customers', { keyword: '13600136000' })).result.items
      await assert.rejects(agent.prepare(input('csr', 'staff_customer_action', { ...args, customerId: others[0].customerId })), e => e.status === 403)
      const i = input('csr', 'staff_customer_action', args); const c = await agent.prepare(i)
      assert.equal(c.requiresCustomerVerification, true)
      await assert.rejects(agent.approve(c), e => e.code === 'CUSTOMER_VERIFICATION_REQUIRED')
      await assert.rejects(agent.approve(c, { method: 'simulated', result: 'passed' }))
      await agent.approve(c, { method: 'phone', result: 'passed' }); await agent.execute(i)
      const profile = await api(`/staff-api/customers/${customerId}/profile?reason=test`, csr.token)
      assert.equal(profile.cards.find(c => c.id === cardId).status, 'locked')
    })
    await t.test('主管阈值展示当前值；确认后状态变更使旧授权失效', async () => {
      const setting = (await exec('supervisor', 'staff_get_transfer_threshold')).result
      const i = input('supervisor', 'staff_set_transfer_threshold', { transferReviewCents: setting.transferReviewCents + 100 }); const c = await agent.prepare(i)
      assert(c.fields.some(f => f.label === '当前阈值')); await agent.approve(c)
      await api('/staff-api/settings/transfer-threshold', supervisor.token, { transferReviewCents: setting.transferReviewCents + 200 }, 'PUT')
      await assert.rejects(agent.execute(i), e => e.code === 'STALE_CONFIRMATION')
      await exec('supervisor', 'staff_set_transfer_threshold', { transferReviewCents: setting.transferReviewCents })
      assert.equal((await api('/staff-api/settings/transfer-threshold', supervisor.token)).transferReviewCents, setting.transferReviewCents)
    })
    await t.test('审批通过不等于资金执行完成，且不能自审', async () => {
      const created = await api('/staff-api/approvals', csr.token, { customerId, bizType: 'other', payload: { note: '测试审批' } })
      const result = (await exec('supervisor', 'staff_decide_approval', { approvalId: created.approvalId, decision: 'approved' })).result
      assert.equal(result.status, 'approved'); assert.equal(result.executionStatus, 'pending')
      const own = await api('/staff-api/approvals', supervisor.token, { customerId, bizType: 'other' })
      await assert.rejects(agent.prepare(input('supervisor', 'staff_decide_approval', { approvalId: own.approvalId, decision: 'approved' })), e => e.status === 403)
    })
    await t.test('卡片限额变化使旧代客授权失效，签约仅支持停用', async () => {
      const args = { customerId, ticketId, cardId, action: 'updateCardSettings', reason: '测试调额', dailyLimit: 500000 }
      const i = input('csr', 'staff_customer_action', args); const c = await agent.prepare(i)
      assert(c.fields.some(f => f.label === '当前日限额')); await agent.approve(c, { method: 'sms', result: 'passed' })
      await api(`/staff-api/customers/${customerId}/actions/updateCardSettings`, csr.token, { ticketId, cardId, reason: '测试并发调额', dailyLimit: 200000, verificationMethod: 'phone', verificationResult: 'passed' })
      await assert.rejects(agent.execute(i), e => e.code === 'STALE_CONFIRMATION')
      const profile = await api(`/staff-api/customers/${customerId}/profile?reason=test`, csr.token)
      if (profile.autoDebits?.length) {
        const a = { customerId, ticketId, action: 'patchAutodebit', autoDebitId: profile.autoDebits[0].id, reason: '客户要求停用' }
        await assert.rejects(agent.prepare(input('csr', 'staff_customer_action', { ...a, enabled: true })))
        await exec('csr', 'staff_customer_action', a, { method: 'phone', result: 'passed' })
        assert.equal((await api(`/staff-api/customers/${customerId}/profile?reason=test`, csr.token)).autoDebits[0].enabled, false)
      }
    })
    await t.test('主管到账和拦截操作既有在途交易，资金只执行一次', async () => {
      const sms = await api('/api/auth/sms-code', null, { phone: '13600136000' })
      const recipient = await api('/api/auth/login', null, { phone: '13600136000', password: '123456', smsCode: sms.demoCode })
      const from = (await api('/api/accounts', customerLogin.token))[0], to = (await api('/api/accounts', recipient.token))[0]
      const threshold = await api('/staff-api/settings/transfer-threshold', supervisor.token)
      await api('/staff-api/settings/transfer-threshold', supervisor.token, { transferReviewCents: 100 }, 'PUT')
      const makeHeld = async memo => {
        const prepared = await prepareTransfer({ fromAccountId: from.id, payeeAccountNo: to.accountNo, payeeName: recipient.user.name, payeeBankCode: 'LCB', payeeBankRegion: 'CN', amountCents: 500, memo }, false, path => api(path, customerLogin.token), (path, body) => api(path, customerLogin.token, body))
        await api('/api/auth/payment-password/verify', customerLogin.token, { paymentPassword: '888888' })
        const transfer = await api('/api/transfers', customerLogin.token, { ...prepared.body, paymentPassword: '888888' })
        assert.equal(transfer.settlementStatus, 'pending'); assert.equal(transfer.pendingReason, 'inflight')
        const approval = (await api('/staff-api/approvals?status=pending', supervisor.token)).find(v => v.bizType === 'transfer' && v.payload.transactionId === transfer.transactionId)
        assert(approval); return approval
      }
      const held = await makeHeld('员工助手到账回归')
      const before = (await api(`/api/accounts/${to.id}`, recipient.token)).balance
      const i = input('supervisor', 'staff_decide_approval', { approvalId: held.approvalId, decision: 'settle' }); const c = await agent.prepare(i)
      assert(c.fields.some(f => f.label === '付款金额' && f.value === 'CNY 5.00')); await agent.approve(c)
      const settled = (await agent.execute(i)).result
      assert.equal(settled.status, 'settled'); assert.equal(settled.executionStatus, 'succeeded')
      assert.equal((await api(`/api/accounts/${to.id}`, recipient.token)).balance, before + 500)
      await assert.rejects(agent.execute(i)); assert.equal((await api(`/api/accounts/${to.id}`, recipient.token)).balance, before + 500)
      const intercepted = await makeHeld('员工助手拦截回归')
      await assert.rejects(agent.prepare(input('supervisor', 'staff_decide_approval', { approvalId: intercepted.approvalId, decision: 'intercept', reason: '任意理由' })))
      const rejected = (await exec('supervisor', 'staff_decide_approval', { approvalId: intercepted.approvalId, decision: 'intercept', reason: '客户来电要求叫停' })).result
      assert.equal(rejected.status, 'intercepted'); assert.equal((await api(`/api/accounts/${to.id}`, recipient.token)).balance, before + 500)
      await api('/staff-api/settings/transfer-threshold', supervisor.token, { transferReviewCents: threshold.transferReviewCents }, 'PUT')
    })
    await t.test('停止与超时撤销授权', async () => {
      const i = input('csr', 'staff_list_tickets'); const c = await agent.prepare(i); await agent.approve(c); sessions.get('csr').activity.cancelled = true
      await assert.rejects(agent.execute(i)); agent.forgetSession('csr'); sessions.get('csr').activity = { cancelled: false }
      await assert.rejects(agent.prepare({ ...input('csr', 'staff_list_tickets'), expiresAt: Date.now() - 100 }))
    })
    await t.test('业务审计归属真实员工且结果移除凭据和客户会话原文', async () => {
      const logs = (await exec('supervisor', 'staff_audit_logs')).result.items
      assert(logs.some(l => l.actor_id === csr.staff.id && l.action === 'ticket.create'))
      assert(logs.some(l => l.actor_id === supervisor.staff.id && l.action === 'settings.transferThreshold.update'))
      const safe = sanitizeStaffResult({ token: 'secret', cvv: '123', accountNo: '12345', agentTranscript: ['secret'], note: '验证码：987654 密码：777777 电话 13800138000' })
      assert.deepEqual(Object.keys(safe), ['note']); assert(!safe.note.includes('987654')); assert(!safe.note.includes('777777')); assert(!safe.note.includes('13800138000'))
    })
    await t.test('新增 IM 工具覆盖统计、合法转派、额外客户提醒和创建审批',async()=>{
      const summary=(await exec('csr','staff_get_workbench')).result
      assert(Number.isSafeInteger(summary.pending));assert(summary.asOf)
      const targets=(await exec('csr','staff_list_assignees')).result.items
      assert(targets.length&&targets.every(person=>person.role==='supervisor'))
      const task=(await exec('csr','staff_create_ticket',{customerId,reason:'IM 新增工具回归'})).result.ticketId
      assert.equal((await exec('csr','staff_assign_ticket',{ticketId:task,assigneeId:supervisor.staff.id})).result.assigneeId,supervisor.staff.id)
      await assert.rejects(exec('csr','staff_update_ticket_status',{ticketId:task,status:'processing'}),error=>error.status===403)
      assert.equal((await exec('supervisor','staff_assign_ticket',{ticketId:task,assigneeId:csr.staff.id})).result.assigneeId,csr.staff.id)
      await exec('csr','staff_update_ticket_status',{ticketId:task,status:'processing'})
      await exec('csr','staff_post_ticket_message',{ticketId:task,text:'TEST ONLY IM 明确客户提醒',visibleToCustomer:true})
      assert.equal((await api(`/staff-api/tickets/${task}`,csr.token)).messages.at(-1).visible_to_customer,1)
      const approval=(await exec('csr','staff_create_approval',{customerId,bizType:'other',reason:'TEST ONLY IM 申请'})).result
      assert.equal(approval.status,'pending');assert((await api(`/staff-api/approvals/${approval.approvalId}`,csr.token)).payload.customerId===customerId)
      assert.equal((await exec('csr','staff_get_im_preferences')).result.enabled,false)
      assert(Array.isArray((await exec('csr','staff_list_im_notifications')).result.items))
      const query=input('csr','staff_get_workbench'),challenge=await agent.prepare(query)
      assert.equal(await agent.approveRoutineQuery(challenge),true)
      assert((await agent.execute(query)).result.asOf)
    })
    await t.test('登出后旧授权不能执行', async () => {
      const i = input('csr', 'staff_list_tickets'); await agent.approve(await agent.prepare(i)); await api('/staff-api/logout', csr.token, {})
      await assert.rejects(agent.execute(i), e => e.status === 401)
    })
  } finally {
    agent.close(); await backend.close()
  }
})
