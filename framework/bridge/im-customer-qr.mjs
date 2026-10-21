/** Authenticated customer QR sessions; no access to another customer's bot administration. */
const fail = (message, status = 400) => Object.assign(Error(message), { status })
const terminal = new Set(['failed', 'expired', 'cancelled'])
export function createCustomerQr({ bank, channels, clock = Date.now }) {
  const records = new Map(), history = new Map()
  let starting = false
  const owner = identity => {
    const id = identity?.user?.id
    if (!id || typeof id !== 'string') throw fail('请先登录银行账户', 401)
    return id
  }
  function get(identity, id) {
    const record = records.get(id)
    if (!record || record.owner !== owner(identity)) throw fail('扫码任务不存在或不属于当前账户', 404)
    if (record.expiresAt <= clock()) throw fail('二维码已过期，请重新生成', 410)
    return record
  }
  function state(record) {
    const result = channels.registration('weixin', record.id)
    if (!result) throw fail('扫码任务已结束，请重新生成', 410)
    return result
  }
  function view(record, current = state(record)) {
    return { attemptId: record.id, status: current.status, qrImage: record.image,
      expiresAt: record.expiresAt, verificationRequired: current.status === 'needs_verification',
      ...(current.error ? { error: { message: current.error.message } } : {}),
      ...(record.binding ? { binding: record.binding } : {}) }
  }
  return {
    async start(identity) {
      const customer = owner(identity)
      for (const [id, record] of records) if (record.expiresAt <= clock()) records.delete(id)
      for (const [id, times] of history) {
        const fresh = times.filter(time => time > clock() - 3600000)
        if (fresh.length) history.set(id, fresh); else history.delete(id)
      }
      for (const record of records.values()) if (record.owner === customer) {
        const current = state(record)
        if (!terminal.has(current.status)) return view(record, current)
      }
      if (starting) throw fail('已有扫码任务进行中，请稍后再试', 409)
      if (records.size >= 1000 || history.size >= 1000 || (history.get(customer)?.length ?? 0) >= 3) throw fail('二维码生成过于频繁，请稍后重试', 429)
      starting = true
      history.set(customer, [...(history.get(customer) ?? []), clock()])
      let result
      try {
        result = await channels.provision('weixin', { fresh: true })
        if (!result?.attemptId || !/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(result.qrImage ?? '') || result.qrImage.length > 500000) throw fail('微信未返回有效二维码，请重试', 502)
        const expiresAt = Math.min(Number(result.expiresAt), clock() + 300000)
        if (!Number.isFinite(expiresAt) || expiresAt <= clock()) throw fail('二维码已过期，请重新生成', 410)
        const record = { id: result.attemptId, owner: customer, image: result.qrImage, expiresAt }
        records.set(record.id, record)
        return view(record, result)
      } catch (error) {
        if (result?.attemptId) await channels.cancelProvision('weixin', result.attemptId).catch(() => {})
        throw error
      } finally { starting = false }
    },
    poll(identity, id) { return view(get(identity, id)) },
    async verify(identity, id, code) {
      const record = get(identity, id)
      if (state(record).status !== 'needs_verification') throw fail('当前扫码不需要验证码', 409)
      if (typeof code !== 'string' || !/^[A-Za-z0-9-]{1,64}$/.test(code.trim())) throw fail('请输入手机扫码流程要求的验证码')
      await channels.verify('weixin', id, code.trim())
      return view(record)
    },
    async cancel(identity, id) {
      const record = get(identity, id)
      if (state(record).status === 'connected') throw fail('微信已连接，请确认银行绑定或关闭此面板', 409)
      await channels.cancelProvision('weixin', id)
      return view(record)
    },
    async confirm(identity, id, confirmed) {
      const record = get(identity, id)
      if (confirmed !== true) throw fail('请先核对并确认绑定当前银行账户')
      if (record.binding) return record.binding
      const current = state(record)
      if (current.status !== 'connected' || !current.botId || current.alreadyConnected) throw fail('请完成本次二维码登录；已有连接请从本人微信获取绑定码', 409)
      if (!channels.status().channels.weixin.bots.some(bot => bot.botId === current.botId && bot.connected)) throw fail('微信连接尚未就绪，请稍后重试', 409)
      if (!record.confirming) {
        record.confirming = (async () => {
          const key = channels.privateWeixinRecipient(current.botId)
          record.binding = await bank.bindScannedWeixin(current.botId, key, identity)
          return record.binding
        })().finally(() => { record.confirming = undefined })
      }
      return record.confirming
    },
  }
}
