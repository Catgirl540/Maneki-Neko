import { spawn } from 'node:child_process'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '../..')
const env = { ...process.env }
for (const key of Object.keys(env)) if (/TOKEN|API_KEY|APIKEY|ACCESS_KEY|SECRET|PASSWORD/.test(key) || key.startsWith('LUCKYCAT_') || ['BANK_DATABASE_URL', 'BANK_DATA_KEY'].includes(key)) delete env[key]
for (const [key, database] of Object.entries({ BANK_TEST_DATABASE_URL: 'maneki_bank_test', BANK_CONNECT_TEST_DATABASE_URL: 'maneki_connector_test', BANK_HTTP_TEST_DATABASE_URL: 'maneki_http_test', LUCKYCAT_SESSION_TEST_DATABASE_URL: 'maneki_ai_sessions_test' })) env[key] = `postgresql://postgres@127.0.0.1:55433/${database}`
env.LUCKYCAT_PG_MODULE_PATH = resolve(root, 'server/node_modules/pg')
const child = spawn(process.execPath, process.argv.slice(2), { cwd: root, env, stdio: 'inherit', windowsHide: true })
child.on('error', error => { throw error })
child.on('exit', code => { process.exitCode = code ?? 1 })
