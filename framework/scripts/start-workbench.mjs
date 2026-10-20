import { spawn } from 'node:child_process'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { frameworkRoot, setupWorkbench } from './setup-workbench.mjs'

export function workbenchEnvironment(home) {
  const env = { ...process.env }
  for (const key of Object.keys(env)) if (/^(BANK_|LUCKYCAT_)|TOKEN|API_KEY|APIKEY|SECRET|PASSWORD|^DSH_PERMISSION_MODE$/.test(key)) delete env[key]
  env.DSH_HOME = home
  return env
}
export async function startWorkbench({ directory, port = 8792, stdio = 'inherit' } = {}) {
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw Error('工作台端口必须为 1–65535')
  const paths = await setupWorkbench(directory)
  const child = spawn(process.execPath, [join(frameworkRoot, 'node_modules/@deepseek-ai/dsh/lib/bin.js'), '--profile', 'workbench', '--host', '127.0.0.1', '--port', String(port), '--no-open'], { cwd: paths.workspace, env: workbenchEnvironment(paths.home), stdio, windowsHide: true })
  return { child, paths, url: `http://127.0.0.1:${port}` }
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const { child, url } = await startWorkbench()
  console.log(`独立个人工作台：${url}（仅本机；银行网页与微信投递尚未接入）`)
  child.on('error', error => { console.error(error.message); process.exitCode = 1 })
  child.on('exit', code => { process.exitCode = code ?? 1 })
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { child.kill(signal) })
}
