process.env.LUCKYCAT_IM_ENABLED = '1'
await import('./bootstrap-customer.mjs')
await import('../bridge/demo-server.mjs')
