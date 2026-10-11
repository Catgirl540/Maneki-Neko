import { request } from 'node:http'

/** 私有 socket 不经过浏览器、银行接口或外部网络。 */
export function cancelAgent(socketPath, token, sessionId) {
  return new Promise((resolve, reject) => {
    const req = request({ socketPath, path: `/cancel/${encodeURIComponent(sessionId)}`, method: 'POST', headers: { 'x-luckycat-internal': token } }, res => {
      res.resume()
      res.on('end', () => resolve(res.statusCode === 200))
    })
    req.setTimeout(2000, () => req.destroy(new Error('停止请求超时')))
    req.on('error', reject)
    req.end()
  })
}
