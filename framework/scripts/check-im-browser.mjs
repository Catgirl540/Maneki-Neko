import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
const root = fileURLToPath(new URL('../', import.meta.url))
const result = spawnSync(process.execPath, ['--test', 'bridge/im.test.mjs'], { cwd: root, env: { ...process.env, LUCKYCAT_IM_BROWSER: '1' }, stdio: 'inherit', windowsHide: true })
process.exitCode = result.status ?? 1
