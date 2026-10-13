process.env.LUCKYCAT_AUDIENCE = 'staff'
process.env.LUCKYCAT_STAFF_MODE = 'ops'
process.env.LUCKYCAT_BANK_MODE = 'http'
process.env.LUCKYCAT_DEMO_PORT ??= '8790'
process.env.LUCKYCAT_DISABLE_VOICE = '1'
await import('./demo-server.mjs')
