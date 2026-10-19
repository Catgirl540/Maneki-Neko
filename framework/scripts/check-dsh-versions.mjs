// DSH 的 CLI、SDK 和树外插件必须使用同一发布版，拒绝混入旧 peer 依赖。
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
const read = path => JSON.parse(readFileSync(resolve(root, path), 'utf8'))
const manifest = read('package.json')
const version = manifest.dependencies['@deepseek-ai/dsh']
assert.match(version, /^\d+\.\d+\.\d+(?:-[\w.]+)?$/, 'DSH 必须使用精确发布版本')
const files = ['package.json', ...readdirSync(resolve(root, 'packages')).map(name => `packages/${name}/package.json`)]
let count = 0
for (const file of files) {
  const pkg = read(file)
  for (const field of ['dependencies', 'devDependencies', 'peerDependencies']) {
    for (const [name, pin] of Object.entries(pkg[field] ?? {})) {
      if (!/^@deepseek-ai\/dsh(?:-|$)/.test(name)) continue
      assert.equal(pin, version, `${file}: ${name} 必须与 DSH ${version} 一致`)
      assert.equal(read(`node_modules/${name}/package.json`).version, version, `${name} 安装版本不一致`)
      count++
    }
  }
}
for (const [path, pkg] of Object.entries(read('package-lock.json').packages)) {
  if (/(?:^|\/)node_modules\/@deepseek-ai\/dsh(?:-[^/]+)?$/.test(path)) {
    assert.equal(pkg.version, version, `${path}: 锁文件包含其他 DSH 版本`)
  }
}
console.log(`DSH ${version}: ${count} 项 CLI / SDK / 插件依赖与安装、锁文件一致`)
