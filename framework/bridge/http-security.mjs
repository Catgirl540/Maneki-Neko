const loopback = address => ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(address)
export function applyHttpSecurity(req, res, configured = process.env.LUCKYCAT_ALLOWED_ORIGINS ?? '') {
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('Referrer-Policy', 'no-referrer')
  res.setHeader('X-Frame-Options', 'DENY')
  res.setHeader('Vary', 'Origin')
  const origin = req.headers.origin
  if (!origin) return true
  let parsed
  try { parsed = new URL(origin); if (parsed.origin !== origin || !['http:', 'https:'].includes(parsed.protocol)) return false } catch { return false }
  const scheme = req.socket?.encrypted || (loopback(req.socket?.remoteAddress) && req.headers['x-forwarded-proto'] === 'https') ? 'https' : 'http'
  const sameOrigin = origin === `${scheme}://${req.headers.host}`
  const allowed = configured.split(',').map(value => value.trim()).filter(Boolean)
  if (!sameOrigin && !allowed.includes(origin)) return false
  res.setHeader('Access-Control-Allow-Origin', origin)
  return true
}
