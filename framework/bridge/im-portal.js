// Same-origin bank portal. Tokens stay in memory; no credentials in URLs or browser storage.
const $ = id => document.getElementById(id)
const staffMode = document.documentElement.dataset.audience === 'staff'
const apiPrefix = staffMode ? '/staff-agent-api' : '/agent-api'
let token = '', admin = false, sessionId = '', cursor = null, pollTimer, provisionTimer, pendingId = '', previewCode = ''
const messages = new Map()
const smsCooldowns = new Map()
let smsBusy = false, smsTimer
let reminderDraft
let continuation
let sessionGeneration = 0
const reminderTime = value => new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', dateStyle: 'medium', timeStyle: 'short', hour12: false }).format(new Date(value))
function renderSmsButton() {
  clearTimeout(smsTimer)
  const left = Math.max(0, Math.ceil(((smsCooldowns.get($('identity').value.trim()) ?? 0) - Date.now()) / 1000))
  $('sms-button').disabled = smsBusy || left > 0
  $('sms-button').textContent = smsBusy ? '发送中…' : left ? `${left} 秒后重发` : '获取验证码'
  if (left) smsTimer = setTimeout(renderSmsButton, 1000)
}
const fragment = new URLSearchParams(location.hash.slice(1))
const localTicket = fragment.get('local')
const connectionTest = new URLSearchParams(location.search).get('mode') === 'connection-test'
$('pair-code').value = fragment.get('code') ?? ''
sessionId = fragment.get('session') ?? ''
let linkedSession = sessionId
history.replaceState(null, '', location.pathname + location.search) // Pairing codes do not remain in browser history.
function showHandoff(title, description, request) {
  $('handoff-panel').hidden = false; $('handoff-title').textContent = title; $('handoff-description').textContent = description
  $('handoff-request').hidden = !request; $('handoff-request').textContent = request ?? ''
}
if (sessionId) showHandoff('查看微信待确认操作', '登录后将直接打开本次微信会话，显示仍有效的确认卡或需补充的信息。')
else if ($('pair-code').value) showHandoff('恢复微信银行连接', '这是一条登录恢复链接。登录后会显示本次请求，恢复连接后可继续；涉及资金的操作仍需独立确认。')
window.addEventListener('hashchange', () => {
  const next = new URLSearchParams(location.hash.slice(1)), code = next.get('code'), target = next.get('session')
  if (!code && !target) return
  clearTimeout(pollTimer); sessionGeneration++; sessionId = target ?? ''; linkedSession = sessionId
  $('pair-code').value = code ?? ''; previewCode = ''; $('claim-button').hidden = true
  history.replaceState(null, '', location.pathname + location.search)
  showHandoff(code ? '恢复微信银行连接' : '查看微信待确认操作', '已切换到最新微信链接。登录后会核对本人连接及本次请求。')
  if (token && !admin) void refreshBindings().then(previewPairing).catch(error => notice(error.message))
})
function notice(text = '') { $('notice').textContent = text; $('notice').hidden = !text }
function element(tag, text, parent) { const item = document.createElement(tag); if (text !== undefined) item.textContent = text; parent?.append(item); return item }
function button(text, handler, parent, style = '') { const item = element('button', text, parent); item.type = 'button'; item.className = style; item.addEventListener('click', () => task(item, handler)); return item }
async function task(item, operation) { item.disabled = true; notice(); try { await operation() } catch (error) { notice(error.message) } finally { item.disabled = false } }
async function request(path, body, method = body === undefined ? 'GET' : 'POST') {
  const response = await fetch(`${apiPrefix}${path}`, { method, credentials: 'omit', headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(30_000) })
  const data = await response.json()
  if (!response.ok) {
    if (response.status === 401 && !path.startsWith('/im/auth/') && (!path.startsWith('/consent/') || data.code === 'UNAUTHORIZED')) logout(true)
    throw Object.assign(Error(data.error ?? data.message ?? `请求失败（${response.status}）`), { status: response.status })
  }
  return data
}
function logout(preserveTarget = false) {
  token = ''; sessionId = preserveTarget === true ? linkedSession : ''; clearTimeout(pollTimer); clearTimeout(provisionTimer); pendingId = ''; previewCode = ''; messages.clear()
  continuation = undefined; $('handoff-continue').hidden = true
  $('login-panel').hidden = false; $('customer-panel').hidden = true; $('admin-panel').hidden = true
  $('password').value = ''; $('sms-code').value = ''; $('bot-secret').value = ''; $('pending').replaceChildren(); $('provisioning').replaceChildren()
  $('sms-hint').textContent = ''; $('sms-hint').hidden = true
  $('messages').replaceChildren(); $('bindings').replaceChildren(); $('bots').replaceChildren(); $('pair-preview').textContent = ''; $('claim-button').hidden = true
  reminderDraft = undefined; $('reminder-list').replaceChildren(); $('reminder-binding').replaceChildren(); $('reminder-title').value = ''; $('reminder-time').value = ''; $('reminder-status').textContent = ''; $('reminder-confirm').hidden = true
  if (connectionTest) { $('login-panel').hidden = true; notice('管理页面已锁定。请通过本地启动入口重新打开，不需要银行账号。') }
}
function mode(value) { admin = value; logout(); $('login-title').textContent = admin ? '运维人员登录' : '登录银行账户'; $('identity-label').textContent = admin ? '员工账号' : '手机号'; $('sms-fields').hidden = admin; notice() }
$('customer-tab').onclick = () => mode(false)
$('admin-tab').onclick = () => mode(true)
if (!connectionTest && new URLSearchParams(location.search).get('view') === 'admin') mode(true)
if (staffMode) {
  admin=false; $('admin-tab').hidden=true; $('customer-tab').hidden=true; $('sms-fields').hidden=true
  $('login-title').textContent='工作人员登录';$('identity-label').textContent='员工账号'
  document.querySelector('h1').textContent='工作人员 IM';document.querySelector('header small').textContent='招财猫银行 · 客服与主管'
  $('claim-button').textContent='绑定本人微信并开通任务提醒'
  $('pair-panel').querySelector('p').textContent='绑定后可接收客户任务提醒，退出网页仍持续提醒。业务查询需要有效员工登录，写操作仍须确认；代客操作另需客户核验。'
  $('reminder-panel').hidden=true
}
$('logout-button').onclick = () => logout()
$('admin-logout-button').onclick = () => logout()
$('identity').addEventListener('input', () => { $('sms-code').value = ''; $('sms-hint').textContent = ''; $('sms-hint').hidden = true; renderSmsButton() })
$('sms-button').onclick = async () => {
  const phone = $('identity').value.trim()
  if (smsBusy || (smsCooldowns.get(phone) ?? 0) > Date.now()) return
  if (!/^\d{11}$/.test(phone)) { notice('请输入 11 位手机号'); return }
  smsBusy = true; renderSmsButton(); notice()
  try {
    const data = await request('/im/auth/sms', { phone })
    smsCooldowns.set(phone, Date.now() + 60_000)
    if (!admin && $('identity').value.trim() === phone) {
      $('sms-hint').textContent = data.demoCode ? `演示环境验证码：${data.demoCode}（5 分钟内有效，已填入）` : '验证码已发送，请查看手机短信。'
      $('sms-hint').hidden = false
      if (data.demoCode) $('sms-code').value = data.demoCode
    }
  } catch (error) {
    if (error.status === 429) smsCooldowns.set(phone, Date.now() + 60_000)
    notice(error.message)
  } finally { smsBusy = false; renderSmsButton() }
}
$('login-form').onsubmit = event => {
  event.preventDefault()
  void task(event.submitter, async () => {
    const result = await request('/im/auth/login', { admin, phone: $('identity').value.trim(), name: $('identity').value.trim(), password: $('password').value, smsCode: $('sms-code').value.trim() })
    token = result.token; $('password').value = ''; $('sms-code').value = ''; $('login-panel').hidden = true
    if (admin) { $('admin-panel').hidden = false; await refreshBots() }
    else {
      $('customer-panel').hidden = false; $('customer-name').textContent = `${result.name ?? ''} · 账户连接`
      await refreshBindings()
      await previewPairing()
    }
  })
}
const expiredPairingHint = '此绑定链接已使用或已过期。请回到原微信私聊发送“绑定”，打开机器人新回复的链接后重新登录、核对并确认。无需重新扫码机器人。'
async function previewPairing() {
  previewCode = ''; $('claim-button').hidden = true
  const code = $('pair-code').value.trim()
  if (code) { continuation = undefined; $('handoff-continue').hidden = true }
  $('preview-button').disabled = !code
  if (!code) { $('pair-preview').textContent = '要绑定新的私聊，请在微信中发送“绑定”，从机器人新回复的链接打开本页。已有连接可在下方查看。'; return }
  try {
    const result = await request('/im/preview', { code })
    if ($('pair-code').value.trim() !== code) return
    previewCode = code; $('pair-preview').textContent = `来源：${result.label}。请确认这是您正在使用的 IM 私聊。有效至 ${new Date(result.expiresAt).toLocaleTimeString()}。`
    showHandoff('本次微信请求尚未开始办理', '先确认这是本人的私聊。恢复连接后，可点击“继续这次请求”；此绑定确认不会执行资金操作。', result.request)
    $('claim-button').hidden = false
  } catch (error) { $('pair-preview').textContent = error.status === 404 ? expiredPairingHint : error.message; $('handoff-state').textContent = '未能核对本次链接，请查看绑定区的具体提示。' }
}
$('preview-button').disabled = !$('pair-code').value.trim()
$('preview-button').onclick = () => task($('preview-button'), previewPairing)
$('pair-code').oninput = () => { previewCode = ''; $('claim-button').hidden = true; $('pair-preview').textContent = ''; $('preview-button').disabled = !$('pair-code').value.trim() }
$('claim-button').onclick = () => task($('claim-button'), async () => {
  if (!previewCode || previewCode !== $('pair-code').value.trim()) throw Error('请先核对绑定来源。')
  let result
  try { result = await request('/im/claim', { code: previewCode, ...(staffMode ? {confirmed:true} : {}) }) }
  catch (error) { if (error.status === 404) { previewCode = ''; $('claim-button').hidden = true; $('pair-preview').textContent = expiredPairingHint }; throw error }
  previewCode = ''; $('pair-code').value = ''; $('claim-button').hidden = true; $('pair-preview').textContent = '绑定成功，请回到 IM 发送需求。'
  $('preview-button').disabled = true
  sessionId = result.sessionId; await refreshBindings()
  continuation = result.continuation
  if (continuation) {
    showHandoff('连接已恢复，请继续本次请求', '点击继续后才开始办理。银行写操作仍须核对确认卡，支付密码仅在本页填写。', continuation.request)
    $('handoff-continue').hidden = false; $('handoff-state').textContent = '本次请求尚未执行。'
    $('handoff-panel').scrollIntoView({ block: 'start' })
  }
})
$('handoff-continue').onclick = () => task($('handoff-continue'), async () => {
  if (!continuation || continuation.expiresAt <= Date.now()) throw Error('这次请求已过期，请回微信重新发送。')
  const result = await request('/im/continue', { token: continuation.token, confirmed: true })
  continuation = undefined; $('handoff-continue').hidden = true; sessionId = result.sessionId
  $('handoff-state').textContent = '请求已进入当前会话，下面会显示查询结果或仍需确认的操作。'
  await refreshBindings()
})
async function refreshBindings() {
  const bindings = await request('/im/bindings')
  const pendingRequest = !$('pair-code').value.trim() && bindings.find(item => item.continuation && (!sessionId || item.sessionId === sessionId))
  if (pendingRequest) {
    continuation = pendingRequest.continuation
    showHandoff('连接已恢复，请继续本次请求', '本次请求尚未执行。点击继续后才开始办理，资金操作仍需单独确认。', continuation.request)
    $('handoff-continue').hidden = false
  } else { continuation = undefined; $('handoff-continue').hidden = true }
  $('bindings').replaceChildren()
  for (const binding of bindings) {
    const row = element('div', undefined, $('bindings')); row.className = 'card'
    element('p', `${binding.label} · ${binding.connected ? '已连接' : '请回到 IM 获取新绑定码'}`, row)
    if (binding.connected) button('查看会话与待确认操作', () => selectSession(binding), row, 'secondary')
    const revokePanel = element('div', undefined, row); revokePanel.hidden = true
    element('p', '解除后此私聊将无法查询或办理银行业务，重新绑定需要从微信获取新链接。是否继续？', revokePanel)
    button('确认解除此私聊', async () => { await request(`/im/bindings/${encodeURIComponent(binding.id)}`, undefined, 'DELETE'); if (binding.sessionId === sessionId) { clearTimeout(pollTimer); sessionId = ''; $('session-panel').hidden = true; $('pending').replaceChildren() }; notice('已解除连接。如需重新绑定，请回到原微信私聊发送“绑定”，使用新链接。'); await refreshBindings() }, revokePanel, 'danger')
    button('保留连接', () => { revokePanel.hidden = true }, revokePanel, 'secondary')
    button('解除连接', () => { revokePanel.hidden = false }, row, 'secondary')
  }
  const connected = bindings.filter(item => item.connected)
  const selected = bindings.find(item => item.sessionId === sessionId) ?? (!sessionId && !$('pair-code').value.trim() && connected.length === 1 ? connected[0] : undefined)
  if (selected?.connected) await selectSession(selected)
  else if (sessionId) { $('session-panel').hidden = true; showHandoff('原微信操作已失效或连接已变化', '没有继续执行这条旧指令。请回原微信重新发送需求，使用机器人最新回复的链接。'); notice('请回到原 IM 私聊获取绑定链接并重新连接。') }
  await refreshReminders()
  if (pendingRequest) $('handoff-panel').scrollIntoView({ block: 'start' })
}
async function refreshReminders() {
  if (staffMode) return
  if (!token || admin) return
  let data
  try { data = await request('/im/reminders') }
  catch (error) {
    $('reminder-status').textContent = [503, 404].includes(error.status) ? '此服务尚未启用微信提醒。' : error.message
    $('reminder-form').hidden = true; $('reminder-confirm').hidden = true; $('reminder-list').replaceChildren()
    return
  }
  const previous = $('reminder-binding').value
  $('reminder-binding').replaceChildren()
  for (const binding of data.bindings) { const option = element('option', binding.label, $('reminder-binding')); option.value = binding.id }
  if (data.bindings.some(b => b.id === previous)) $('reminder-binding').value = previous
  $('reminder-form').hidden = !data.bindings.length
  $('reminder-status').textContent = data.bindings.length ? '已启用，显示最近 100 条提醒。保存不代表已发送，已提交微信不代表已读。' : '请先在上方重新绑定本人微信私聊，再刷新提醒。'
  if (!$('reminder-time').value) $('reminder-time').value = new Date(Date.now() + 120000 + 8 * 3600000).toISOString().slice(0, 16)
  $('reminder-list').replaceChildren()
  const labels = { scheduled: '等待投递', sending: '正在投递，无法撤回', sent: '已提交微信（不代表已读）', cancelled: '已取消', suppressed: '绑定变化，停止投递', expired: '超时超过 24 小时，停止投递', failed: '机器人持续离线，未发送', unknown: '投递未确认，不会自动重发；请先核实微信消息' }
  for (const reminder of data.reminders) {
    const row = element('div', undefined, $('reminder-list')); row.className = 'card'
    element('p', reminder.title, row)
    element('p', `${reminderTime(reminder.dueAt)}（北京时间） · ${labels[reminder.status] ?? reminder.status}`, row)
    element('small', `编号：${reminder.id}`, row)
    if (reminder.errorCode === 'BOT_OFFLINE' && reminder.status === 'scheduled') element('p', '机器人离线，正在等待恢复；尚未发送。', row)
    if (reminder.status === 'scheduled') {
      const confirm = element('div', undefined, row); confirm.hidden = true
      element('p', '确认取消这条未发送的微信提醒？此操作不取消银行交易或商户订阅。', confirm)
      button('确认取消提醒', async () => { await request(`/im/reminders/${encodeURIComponent(reminder.id)}`, { confirmed: true, requestId: crypto.randomUUID() }, 'DELETE'); await refreshReminders() }, confirm, 'danger')
      button('保留提醒', () => { confirm.hidden = true }, confirm, 'secondary')
      button('取消提醒', () => { confirm.hidden = false }, row, 'secondary')
    }
  }
}
$('reminder-refresh').onclick = () => task($('reminder-refresh'), refreshReminders)
$('reminder-form').oninput = () => { reminderDraft = undefined; $('reminder-confirm').hidden = true }
$('reminder-form').onsubmit = event => {
  event.preventDefault()
  try {
    const title = $('reminder-title').value.trim(), bindingId = $('reminder-binding').value, local = $('reminder-time').value
    if (!title || /[\x00-\x1f\x7f]/.test(title) || !bindingId || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(local)) throw Error('请填写接收微信、单行提醒内容和北京时间。')
    reminderDraft = { title, bindingId, dueAt: local + ':00+08:00', requestId: crypto.randomUUID(), confirmed: true }
    $('reminder-preview').textContent = `提醒：${title}\n时间：${reminderTime(reminderDraft.dueAt)}（北京时间）\n接收：${$('reminder-binding').selectedOptions[0].textContent}\n仅发送本条提醒，不查询账户或执行交易；解绑后旧提醒停止。`
    $('reminder-confirm').hidden = false; notice()
  } catch (error) { notice(error.message) }
}
$('reminder-back').onclick = () => { reminderDraft = undefined; $('reminder-confirm').hidden = true }
$('reminder-submit').onclick = () => task($('reminder-submit'), async () => {
  if (!reminderDraft) throw Error('请先核对提醒信息。')
  const result = await request('/im/reminders', reminderDraft)
  reminderDraft = undefined; $('reminder-confirm').hidden = true; $('reminder-title').value = ''
  notice(`提醒已保存，等待到期投递。编号：${result.id}；保存不代表已发送。`)
  await refreshReminders()
})
async function selectSession(binding) {
  clearTimeout(pollTimer)
  sessionGeneration++
  sessionId = binding.sessionId; cursor = null; pendingId = ''; messages.clear(); $('messages').replaceChildren(); $('pending').replaceChildren()
  $('session-panel').hidden = false; $('connection-label').textContent = binding.label
  await poll()
  $(pendingId ? 'pending' : 'session-panel').scrollIntoView({ block: 'start' })
}
function renderMessages() { $('messages').replaceChildren(); for (const text of messages.values()) element('article', text, $('messages')) }
function pendingCard(id, title, expiresAt) {
  if (pendingId === id) return null
  pendingId = id; $('pending').replaceChildren()
  const card = element('div', undefined, $('pending')); card.className = 'card pairing'
  element('h2', title, card); element('p', `有效至 ${new Date(expiresAt).toLocaleTimeString()}，过期后请回到 IM 重新发起。`, card)
  card.scrollIntoView({ block: 'start' })
  return card
}
function consent(challenge) {
  const card = pendingCard(challenge.challengeId, challenge.kind ?? '请核对操作', challenge.expiresAt)
  if (!card) return
  for (const field of challenge.fields ?? []) { const line = element('div', undefined, card); line.className = 'field'; element('b', field.label, line); element('span', field.value, line) }
  element('p', challenge.consequence, card)
  let password, acknowledgement,verificationMethod,verificationPassed
  if (staffMode && challenge.requiresCustomerVerification) {
    element('label','客户核验方式',card);verificationMethod=element('select',undefined,card)
    for (const [value,text] of [['','请选择核验方式'],['phone','电话核验'],['sms','短信核验'],['face','人脸核验']]) {const option=element('option',text,verificationMethod);option.value=value}
    const label=element('label',undefined,card);label.className='check';verificationPassed=element('input',undefined,label);verificationPassed.type='checkbox';element('span','我已独立完成该客户身份核验，结果通过',label)
  }
  if (challenge.verification) { element('label', '支付密码', card); password = element('input', undefined, card); password.type = 'password'; password.autocomplete = 'off' }
  if (challenge.riskAcknowledgementText) { element('p', challenge.riskAcknowledgementText, card); element('label', '请本人完整抄录上述风险确认语句', card); acknowledgement = element('textarea', undefined, card) }
  button('确认操作', async () => {
    if (Date.now() >= challenge.expiresAt) throw Error('确认已过期，请重新发起。')
    if (acknowledgement && acknowledgement.value.trim() !== challenge.riskAcknowledgementText) throw Error('风险确认语句不一致。')
    if (verificationPassed && (!verificationPassed.checked || !verificationMethod.value)) throw Error('请由员工独立完成客户身份核验并选择方式。')
    await request(`/consent/${encodeURIComponent(challenge.challengeId)}`, { decision: 'approve', ...(staffMode ? {customerVerification:verificationPassed ? {method:verificationMethod.value,result:'passed'} : undefined} : {paymentPassword: password?.value ?? '', riskAcknowledgement: acknowledgement?.value ?? ''}) })
    if (password) password.value = ''; if (acknowledgement) acknowledgement.value = ''; pendingId = ''; $('pending').replaceChildren(); notice('已提交确认，办理结果以银行回执为准。')
  }, card)
  button('取消操作', async () => { await request(`/consent/${encodeURIComponent(challenge.challengeId)}`, { decision: 'reject' }); pendingId = ''; $('pending').replaceChildren() }, card, 'secondary')
}
function question(value) {
  const card = pendingCard(value.questionId, '请补充办理信息', value.expiresAt)
  if (!card) return
  const fields = []
  for (const item of value.questions) {
    element('p', item.question, card)
    const options = []
    for (const option of item.options ?? []) {
      const line = element('label', undefined, card); line.className = 'check'
      const input = element('input', undefined, line); input.type = item.multiSelect ? 'checkbox' : 'radio'; input.name = `question-${item.id}`
      element('span', `${option.label}${option.description ? ' · ' + option.description : ''}`, line); options.push({ input, label: option.label })
    }
    const custom = element('textarea', undefined, card); custom.placeholder = '也可以自己填写'
    fields.push({ id: item.id, options, custom })
  }
  button('提交回答', async () => {
    const answers = fields.map(field => ({ id: field.id, selected: field.options.filter(item => item.input.checked).map(item => item.label), custom: field.custom.value.trim() }))
    if (answers.some(item => !item.selected.length && !item.custom)) throw Error('请回答每一个问题。')
    await request(`/questions/${encodeURIComponent(value.questionId)}/answer`, { answers }); pendingId = ''; $('pending').replaceChildren()
  }, card)
}
async function poll() {
  const selected = sessionId
  const generation = sessionGeneration
  if (!selected || !token || admin) return
  try {
    const initial = cursor === null
    const data = await request(`/sessions/${encodeURIComponent(selected)}/events${initial ? '' : `?after=${encodeURIComponent(cursor)}`}`)
    if (!token || selected !== sessionId || generation !== sessionGeneration) return
    if (initial) {
      // Pending approvals/questions are authoritative live state, not replayable history.
      // Load previous replies separately; keep the snapshot cursor so racing new events are read next.
      try {
        const history = await request(`/sessions/${encodeURIComponent(selected)}/events?after=0`)
        if (!token || selected !== sessionId || generation !== sessionGeneration) return
        data.events = [...history.events.filter(event => ['assistant', 'assistant-update', 'assistant-reset'].includes(event.type)), ...data.events,
          ...history.events.filter(event => ['consent-resolved', 'question-resolved'].includes(event.type))]
      } catch (error) { if (!token) return; notice('历史回复暂时无法读取；当前确认信息以本页下方显示为准。') }
    }
    cursor = data.cursor
    for (const event of data.events) {
      if (event.type === 'assistant' || event.type === 'assistant-update') { messages.set(event.messageId ?? 'final', event.text); renderMessages() }
      if (event.type === 'assistant-reset') { messages.delete(event.messageId); renderMessages() }
      if (event.type === 'status') $('session-status').textContent = event.status === 'running' ? '正在处理' : '等待新的 IM 消息'
      if (event.type === 'consent') consent(event.challenge)
      if (event.type === 'question') question(event.question)
      if ((event.type === 'consent-resolved' && event.challengeId === pendingId) || (event.type === 'question-resolved' && event.questionId === pendingId)) { pendingId = ''; $('pending').replaceChildren() }
      if (event.type === 'error') notice(event.message)
    }
    $('session-status').textContent = pendingId ? '请在下方核对并确认本次操作' : data.events.some(event => event.type === 'status' && event.status === 'running') ? '正在处理本次微信请求…' : '当前没有仍有效的待确认操作。请查看下方回复；如未办理，请回微信重新发送。'
  } catch (error) { notice(error.message) }
  if (token && selected === sessionId && generation === sessionGeneration) pollTimer = setTimeout(poll, 2000)
}
$('stop-button').onclick = () => task($('stop-button'), async () => { await request(`/sessions/${encodeURIComponent(sessionId)}/stop`, {}); notice('已请求停止。已提交银行的业务请核对实际记录。') })
async function refreshBots() {
  const data = await request('/im/admin/status')
  $('bots').replaceChildren()
  for (const [channel, status] of Object.entries(data.channels)) {
    const card = element('section', undefined, $('bots')); element('h2', channel === 'weixin' ? '微信机器人' : '企微机器人', card)
    if (!status.bots?.length) element('p', '尚未连接机器人', card)
    for (const bot of status.bots ?? []) {
      element('p', `${bot.bot?.name ?? bot.botId} · ${bot.state}`, card)
      button('重新连接', async () => { await request(`/im/admin/${channel}/reconnect/${encodeURIComponent(bot.botId)}`, {}); await refreshBots() }, card, 'secondary')
      button('移除机器人', async () => { await request(`/im/admin/${channel}/bots/${encodeURIComponent(bot.botId)}`, undefined, 'DELETE'); await refreshBots() }, card, 'danger')
    }
  }
}
async function provision(channel) {
  clearTimeout(provisionTimer); $('provisioning').replaceChildren()
  const result = await request(`/im/admin/${channel}/provision`, {})
  const box = $('provisioning')
  element('p', channel === 'weixin' ? '请使用微信扫描二维码完成连接。' : '请使用企业微信扫描二维码创建智能机器人。', box)
  if (result.qrImage) { const image = element('img', undefined, box); image.src = result.qrImage; image.alt = '机器人连接二维码'; image.className = 'qr' }
  const status = element('output', result.status, box)
  const verify = element('div', undefined, box); verify.hidden = true
  const input = element('input', undefined, verify); input.placeholder = '扫码流程要求的验证码'; input.autocomplete = 'one-time-code'
  button('提交扫码验证码', async () => { await request(`/im/admin/${channel}/verify/${result.attemptId}`, { code: input.value }); input.value = ''; verify.hidden = true }, verify)
  button('取消连接', async () => { clearTimeout(provisionTimer); await request(`/im/admin/${channel}/cancel/${result.attemptId}`, {}); box.replaceChildren(); await refreshBots() }, box, 'secondary')
  const check = async () => {
    if (!token || !admin) return
    try {
      const state = await request(`/im/admin/${channel}/provision/${result.attemptId}`)
      status.textContent = state?.error?.message ?? state?.status ?? '等待扫码'; verify.hidden = state?.status !== 'needs_verification'
      if (['connected', 'failed', 'expired', 'cancelled'].includes(state?.status)) { await refreshBots(); return }
      provisionTimer = setTimeout(check, 2000)
    } catch (error) { notice(error.message) }
  }
  provisionTimer = setTimeout(check, 1000)
}
// Reuse an existing customer-web login only after the server validates its ownership.
// The portal never writes a token to storage and never restores staff/admin access this way.
if (!staffMode && !connectionTest && new URLSearchParams(location.search).get('view') !== 'admin') {
  let existing
  try { existing = JSON.parse(sessionStorage.getItem('luckycat.token') ?? 'null') } catch {}
  if (typeof existing === 'string' && existing) {
    token = existing
    void refreshBindings().then(async () => {
      if (!token) return
      $('login-panel').hidden = true; $('customer-panel').hidden = false
      await previewPairing()
    }).catch(error => { logout(true); notice(error.message) })
  }
}
$('weixin-provision').onclick = () => task($('weixin-provision'), () => provision('weixin'))
$('wecom-provision').onclick = () => task($('wecom-provision'), () => provision('wecom'))
$('refresh-button').onclick = () => task($('refresh-button'), refreshBots)
$('wecom-form').onsubmit = event => { event.preventDefault(); void task(event.submitter, async () => { try { await request('/im/admin/wecom/bind', { botId: $('bot-id').value.trim(), secret: $('bot-secret').value }); await refreshBots() } finally { $('bot-secret').value = '' } }) }
if (connectionTest) {
  document.querySelector('h1').textContent = 'IM 连接验证'
  document.querySelector('nav').hidden = true
  $('connection-test-notice').hidden = false
  $('login-panel').hidden = true
  $('weixin-provision').parentElement.querySelector('p').textContent = '扫码连接后，向机器人发送一条私聊文字，检查是否收到连接测试回复。'
  if (localTicket) {
    token = localTicket
    void request('/im/local/status').then(async result => {
      if (result.mode !== 'connection-test') throw Error('连接验证服务不匹配。')
      admin = true; $('admin-panel').hidden = false
      $('admin-logout-button').textContent = '锁定管理页面'
      await refreshBots()
    }).catch(error => { token = ''; notice(error.message) })
  } else notice('请通过本地启动入口打开管理页面，不需要银行账号。')
}
