// Cross-platform local setup, isolated from the customer profile and the user's ~/.dsh.
import { mkdir, readFile, writeFile, symlink, lstat } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { join, resolve } from 'node:path'
import { checkPolicy } from './check-staff-tool-policy.mjs'
import { OPS_NATIVE_TOOLS } from '../packages/ops-native/src/names.mjs'
const root = fileURLToPath(new URL('../', import.meta.url))
const home = join(root, '.dsh-home')
const profile = join(home, 'profiles', 'staff')
async function link(target, dest) {
  try { await lstat(dest); return } catch (e) { if (e.code !== 'ENOENT') throw e }
  await mkdir(resolve(dest, '..'), { recursive: true })
  await symlink(target, dest, process.platform === 'win32' ? 'junction' : 'dir')
}
await mkdir(profile, { recursive: true })
for (const pkg of ['hardening', 'consent', 'ask', 'staff-tools', 'ops-native']) await link(join(root, 'packages', pkg), join(root, 'node_modules', '@luckycat', `dsh-${pkg}`))
for (const pkg of ['hardening', 'consent', 'ask']) {
  const result = spawnSync(process.execPath, [join(root, 'node_modules', 'typescript', 'bin', 'tsc'), '-p', join(root, 'packages', pkg, 'tsconfig.json')], { stdio: 'inherit', cwd: root, windowsHide: true })
  if (result.status !== 0) throw Error(`构建 ${pkg} 失败`)
}
for (const name of ['cordis.yml', 'cordis.patch.yml', 'package.json']) await writeFile(join(profile, name), await readFile(join(root, 'profiles', 'staff', name)))
await link(join(root, 'node_modules'), join(profile, 'node_modules'))
checkPolicy(join(profile, 'cordis.patch.yml'))
const opsProfile = join(home, 'profiles', 'staff-ops')
await mkdir(opsProfile, { recursive: true })
const staffPatch = await readFile(join(root, 'profiles/staff/cordis.patch.yml'), 'utf8')
const opsAllowed = ['ask_user_question', 'staff_operations_overview', ...OPS_NATIVE_TOOLS]
const opsPatch = staffPatch.replace('mode: read-only', 'mode: workspace-write')
  .replace('workspaceRoot: !!js process.cwd()', 'workspaceRoot: !!js process.env.LUCKYCAT_OPS_WORKSPACE ?? process.cwd()')
  .replace(/    allowedTools:\r?\n[\s\S]*?(?=    secretEnv:)/, '    allowedTools:\n' + opsAllowed.map(n => '      - ' + n + '\n').join(''))
  .replace('secretEnv: [OPENROUTER_API_KEY, LOCAL_API_KEY, LUCKYCAT_INTERNAL_TOKEN]', 'secretEnv: [OPENROUTER_API_KEY, LOCAL_API_KEY, LUCKYCAT_INTERNAL_TOKEN, CLEF_FLASH_API_KEY, JEV_API_KEY]')
  + `\n- id: sandbox\n  name: !!js "process.platform === 'win32' ? '@deepseek-ai/dsh-sandbox-windows-acl' : '@deepseek-ai/dsh-sandbox-local'"\n`
await writeFile(join(opsProfile, 'cordis.yml'), '[]\n')
await writeFile(join(opsProfile, 'cordis.patch.yml'), opsPatch)
const opsManifest = JSON.parse(await readFile(join(root, 'profiles/staff/package.json'), 'utf8'))
opsManifest.name = 'dsh-profile-staff-ops'; opsManifest.dsh.profile.bundles.push('@luckycat/dsh-ops-native')
await writeFile(join(opsProfile, 'package.json'), JSON.stringify(opsManifest, null, 2))
await link(join(root, 'node_modules'), join(opsProfile, 'node_modules'))
checkPolicy(join(opsProfile, 'cordis.patch.yml'))
console.log('工作人员 Agent profile 和工具准备完成。')
