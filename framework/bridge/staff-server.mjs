// Separate process and session namespace; customer runtime stays on 8788.
process.env.LUCKYCAT_AUDIENCE = 'staff'
process.env.LUCKYCAT_BANK_MODE = 'http'
process.env.LUCKYCAT_DEMO_PORT ??= '8789'
// Share the customer voice endpoints; operators can still disable them explicitly.
await import('./demo-server.mjs')
