/** Pinned dsh-im channel controllers/runtimes; no dependency patches or general-purpose Host tools. */
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { mkdir } from 'node:fs/promises'

export async function loadImVendor() {
  const require = createRequire(import.meta.url)
  const manifest = require.resolve('@xmanrui/dsh-im/package.json')
  if (require(manifest).version !== '5.1.0') throw Error('The bank IM adapter requires @xmanrui/dsh-im 5.1.0; verify the contract before upgrading')
  const root = dirname(manifest)
  const load = path => import(pathToFileURL(join(root, path)).href)
  const [wxApi, wxController, wxConfig, wxRuntime, wxState, wcController, wcConfig, wcRuntime, wcState, wcQr, policies] = await Promise.all([
    load('src/channels/weixin/weixin-api.mjs'), load('src/channels/weixin/weixin-controller.mjs'),
    load('src/channels/weixin/config-store.mjs'), load('src/channels/weixin/weixin-runtime.mjs'), load('src/channels/weixin/state-store.mjs'),
    load('src/channels/wecom/wecom-controller.mjs'), load('src/channels/wecom/config-store.mjs'),
    load('src/channels/wecom/wecom-runtime.mjs'), load('src/channels/wecom/state-store.mjs'), load('src/channels/wecom/qr-auth.mjs'),
    load('src/channels/shared/access-policy.mjs'),
  ])
  return { ...wxApi, ...wxController, ...wxConfig, ...wxRuntime, ...wxState, ...wcController, ...wcConfig, ...wcRuntime, ...wcState, ...wcQr, ...policies, qrImage: text => createRequire(manifest)('qrcode').toDataURL(text) }
}

export async function createImChannels({ directory, credentials, harness, vendor, logger = { info() {}, warn() {}, error() {} }, weixinApi, wecomQr, createWecomClient }) {
  const api = vendor ?? await loadImVendor()
  await mkdir(directory, { recursive: true, mode: 0o700 })
  // Native /workspace, /model, /session and execution commands are not bank APIs.
  const accessPolicy = { getSettings: () => api.createAccessPolicy({
    direct: api.createAccessPolicyScope({ mode: 'open', open: { defaultCanExecuteCommands: false, commandPermissionOverrides: [] }, allowlist: { users: [] } }),
    group: api.createAccessPolicyScope(),
  }) }
  const wx = weixinApi ?? api.createWeixinApi()
  let freshLogin = false, starting = false
  const wxConfig = await new api.WeixinConfigStore(join(directory, 'weixin.json')).load()
  const controllers = {
    weixin: new api.WeixinController({
      api: { ...wx, beginLogin: options => wx.beginLogin({ ...options, ...(freshLogin ? { localTokens: [] } : {}) }) }, credentials, logger,
      configStore: wxConfig,
      createRuntime: async ({ botId, config, token }) => new api.WeixinRuntime({ api: wx, config, token, logger, accessPolicy, harness: harness('weixin', botId), state: await new api.WeixinStateStore(join(directory, `${botId}-state.json`)).load() }),
    }),
    wecom: new api.WecomController({
      qrAuth: wecomQr ?? new api.WecomQrAuth(), credentials, logger,
      configStore: await new api.WecomConfigStore(join(directory, 'wecom.json')).load(),
      createRuntime: async ({ botId, config, secret }) => new api.WecomRuntime({ config, secret, logger, accessPolicy, harness: harness('wecom', botId), state: await new api.WecomStateStore(join(directory, `${botId}-state.json`)).load(), ...(createWecomClient ? { createClient: createWecomClient } : {}) }),
    }),
  }
  function controller(channel) {
    if (!Object.hasOwn(controllers, channel)) throw Object.assign(Error('不支持的 IM 渠道'), { status: 404 })
    return controllers[channel]
  }
  return {
    async initialize() { await Promise.all(Object.values(controllers).map(item => item.initialize())) },
    status: () => ({ version: '5.1.0', channels: Object.fromEntries(Object.entries(controllers).map(([channel, item]) => [channel, item.status()])) }),
    async provision(channel, { fresh = false } = {}) {
      const instance = controller(channel)
      if (starting || instance.status().provisioning) throw Object.assign(Error('已有扫码任务进行中，请稍后再试'), { status: 409 })
      starting = true; freshLogin = channel === 'weixin' && fresh
      try {
        const attempt = await instance.startProvisioning()
        return { ...attempt, ...(attempt.verificationUrl ? { qrImage: await api.qrImage(attempt.verificationUrl) } : {}) }
      } finally { starting = false; freshLogin = false }
    },
    privateWeixinRecipient(botId) {
      const config = wxConfig.get(botId)
      if (!config?.ownerUserId) throw Object.assign(Error('微信扫码身份尚未就绪'), { status: 409 })
      return `p2p:${config.ownerUserId}`
    },
    registration: (channel, id) => controller(channel).registrationStatus(id),
    verify: (channel, id, code) => {
      if (channel !== 'weixin') throw Object.assign(Error('此渠道不需要扫码验证码'), { status: 400 })
      return controller(channel).submitVerification(id, code)
    },
    cancelProvision: (channel, id) => controller(channel).cancelProvisioning(id),
    bindWecom: body => controllers.wecom.bindCredentials({ botId: body.botId, secret: body.secret }),
    reconnect: (channel, id) => controller(channel).reconnectBot(id),
    remove: (channel, id) => controller(channel).deleteBot(id),
    deliver: (route, text, options) => controller(route.channel).sendProactiveText(route.botId, { kind: 'user', route: route.channel === 'weixin' ? { toUserId: route.key.slice(4) } : { chatId: route.key.slice(7) } }, text, options),
    reminderReady: route => route.channel === 'weixin' && controllers.weixin.status().bots.some(item => item.botId === route.botId && item.connected),
    close: () => Promise.allSettled(Object.values(controllers).map(item => item.close())),
  }
}
