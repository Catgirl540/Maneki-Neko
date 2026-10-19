// Cross-platform customer setup. Keep all generated profiles inside this repository.
import { mkdir, readFile, writeFile, symlink, lstat, readdir } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { checkPolicy } from './check-bank-tool-policy.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
const profile = join(root, '.dsh-home', 'profiles', 'luckycat')
const json = async path => JSON.parse(await readFile(path, 'utf8'))
const check = spawnSync(process.execPath, [join(root, 'scripts/check-dsh-versions.mjs')], { cwd: root, stdio: 'inherit', windowsHide: true })
if (check.status !== 0) throw Error('DSH 依赖不一致，请先在 framework 执行 npm ci')
const packages = new Map()
for (const name of await readdir(join(root, 'packages'))) {
  const directory = join(root, 'packages', name)
  const manifest = await json(join(directory, 'package.json'))
  packages.set(manifest.name, { directory, manifest })
  const target = join(root, 'node_modules', ...manifest.name.split('/'))
  try { await lstat(target) } catch (error) {
    if (error.code !== 'ENOENT') throw error
    await mkdir(resolve(target, '..'), { recursive: true })
    await symlink(directory, target, process.platform === 'win32' ? 'junction' : 'dir')
  }
}
const built = new Set(), building = new Set()
async function build(name) {
  if (built.has(name)) return
  if (building.has(name)) throw Error(`插件依赖成环：${name}`)
  const pkg = packages.get(name)
  if (!pkg) return
  building.add(name)
  for (const dependency of Object.keys({ ...pkg.manifest.dependencies, ...pkg.manifest.peerDependencies, ...pkg.manifest.devDependencies })) if (packages.has(dependency)) await build(dependency)
  try {
    await lstat(join(pkg.directory, 'tsconfig.json'))
    const result = spawnSync(process.execPath, [join(root, 'node_modules/typescript/bin/tsc'), '-p', join(pkg.directory, 'tsconfig.json')], { cwd: root, stdio: 'inherit', windowsHide: true })
    if (result.status !== 0) throw Error(`构建插件失败：${name}`)
  } catch (error) { if (error.code !== 'ENOENT') throw error }
  building.delete(name); built.add(name)
}
for (const name of packages.keys()) await build(name)
for (const script of ['build-knowledge.mjs', 'check-skills.mjs']) {
  const result = spawnSync(process.execPath, [join(root, 'scripts', script)], { cwd: root, stdio: 'inherit', windowsHide: true })
  if (result.status !== 0) throw Error(`准备客户 Agent 失败：${script}`)
}
await mkdir(profile, { recursive: true })
const replacements = {
  '@LUCKYCAT_SKILLS@': join(root, 'skills'),
  '@LUCKYCAT_CORPUS@': join(root, '.generated', 'knowledge', 'corpus.json'),
  '@LUCKYCAT_DEMO_DATA@': join(root, 'packages', 'bank-demo', 'demo-data.json'),
  '@LUCKYCAT_PROBE_PLUGIN@': join(root, 'packages', 'probe', 'lib', 'index.js'),
}
for (const name of ['cordis.yml', 'cordis.patch.yml', 'doctor.patch.yml', 'probe-denied.patch.yml', 'consent-fast-timeout.patch.yml']) {
  let source = await readFile(join(root, 'profiles/luckycat', name), 'utf8')
  for (const [placeholder, path] of Object.entries(replacements)) source = source.replaceAll(placeholder, path.replaceAll('\\', '/'))
  await writeFile(join(profile, name), source)
}
let manifest
try { manifest = await json(join(profile, 'package.json')) } catch (error) { if (error.code !== 'ENOENT') throw error; manifest = await json(join(root, 'profiles/luckycat/package.json')) }
const bundles = ['@deepseek-ai/dsh-sdk-minimal', ...['hello', 'embedding', 'rag', 'hardening', 'consent', 'bank-demo', 'tool-fs', 'ask', 'skills'].map(name => `@luckycat/dsh-${name}`)]
manifest.dsh.profile.bundles = [...new Set([...bundles, ...manifest.dsh.profile.bundles])]
await writeFile(join(profile, 'package.json'), JSON.stringify(manifest, null, 2) + '\n')
try { await lstat(join(profile, 'node_modules')) } catch (error) {
  if (error.code !== 'ENOENT') throw error
  await symlink(join(root, 'node_modules'), join(profile, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir')
}
checkPolicy(join(profile, 'cordis.patch.yml'))
console.log('客户 Agent 插件构建、技能与隔离 profile 已就绪。')
