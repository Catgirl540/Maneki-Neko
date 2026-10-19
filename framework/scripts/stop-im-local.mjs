import { readFile } from 'node:fs/promises'
const access = JSON.parse(await readFile(new URL('../.dsh-home/im-connection-test/access.json', import.meta.url), 'utf8'))
const url = new URL(access.url)
if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || access.mode !== 'connection-test') throw Error('Refusing to stop a non-local IM service')
const token = new URLSearchParams(url.hash.slice(1)).get('local')
const response = await fetch(new URL('/agent-api/im/local/stop', url), { method: 'POST', headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(10000) })
if (!response.ok) throw Error('本地 IM 服务未响应，或管理访问已更改')
console.log('已请求停止本地 IM 连接验证服务。')
