process.env.LUCKYCAT_AUDIENCE = 'staff'
process.env.LUCKYCAT_STAFF_MODE = 'ops'
process.env.LUCKYCAT_BANK_MODE = 'http'
process.env.LUCKYCAT_DEMO_PORT ??= '8790'
// Voice uses this role's authenticated channel and the shared server credentials.
await import('./demo-server.mjs')
