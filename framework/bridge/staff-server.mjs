// Separate process and session namespace; customer runtime stays on 8788.
process.env.LUCKYCAT_AUDIENCE = 'staff'
process.env.LUCKYCAT_BANK_MODE = 'http'
process.env.LUCKYCAT_DEMO_PORT ??= '8789'
process.env.LUCKYCAT_DISABLE_VOICE = '1'
await import('./demo-server.mjs')
