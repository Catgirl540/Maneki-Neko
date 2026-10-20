import { mkdir, readFile, writeFile, symlink, lstat, realpath } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

export const frameworkRoot = fileURLToPath(new URL('../', import.meta.url))
export const workbenchVersion = '1.17.0'
export async function setupWorkbench(directory = join(frameworkRoot, '.generated', 'personal-workbench')) {
  const manifest = JSON.parse(await readFile(join(frameworkRoot, 'node_modules/@dely0/dsh-personal-workbench/package.json'), 'utf8'))
  if (manifest.version !== workbenchVersion) throw Error('工作台版本与项目锁定版本不一致，请在 framework 运行 npm ci')
  directory = resolve(directory)
  const home = join(directory, 'dsh-home'), privateHome = join(directory, 'private')
  const data = join(privateHome, '.dsh', 'workbench'), workspace = join(directory, 'workspace')
  const profile = join(home, 'profiles', 'workbench')
  for (const path of [profile, data, workspace]) await mkdir(path, { recursive: true, mode: 0o700 })
  const target = join(profile, 'node_modules'), modules = join(frameworkRoot, 'node_modules')
  try {
    await lstat(target)
    if (await realpath(target) !== await realpath(modules)) throw Error('工作台 profile 依赖链接指向其他目录，请保留并核查')
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
    await symlink(modules, target, process.platform === 'win32' ? 'junction' : 'dir')
  }
  await writeFile(join(profile, 'package.json'), JSON.stringify({ name: 'maneki-personal-workbench', private: true, dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', '@dely0/dsh-personal-workbench'] } } }, null, 2) + '\n')
  await writeFile(join(profile, 'cordis.yml'), '[]\n')
  let patch = await readFile(join(frameworkRoot, 'profiles/workbench/cordis.patch.yml'), 'utf8')
  for (const [key, value] of Object.entries({ WORKBENCH_PRIVATE_HOME: privateHome, WORKBENCH_DATA: data, WORKBENCH_WORKSPACE: workspace })) patch = patch.replaceAll(`@${key}@`, JSON.stringify(value.replaceAll('\\', '/')))
  await writeFile(join(profile, 'cordis.patch.yml'), patch)
  return { directory, home, privateHome, data, workspace, profile }
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const paths = await setupWorkbench()
  console.log(`工作台 ${workbenchVersion} 已安装，独立本地数据目录：${paths.data}`)
  console.log('启动：npm --prefix framework run workbench:start')
}
