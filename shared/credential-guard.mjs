// Intentionally narrow: unknown messages are handled by a decision model.
export function hasExplicitCredential(text) {
  if (typeof text !== 'string') return false
  const normalized = text.normalize('NFKC')
  const label = '(?:支付密码|交易密码|登录密码|登陆密码|银行卡密码|卡密码|密码|安全码|CVV|CVC|PIN|password|passcode)'
  if (new RegExp(`${label}\\s+(?:[a-z0-9!@#$%^&*_.-]{4,})(?=$|[\\s，。！？])`, 'iu').test(normalized)) return true
  const assignment = '(?:是|为|就是|等于|设为|设置为|改为|[:：=])'
  return new RegExp(`${label}\\s*${assignment}\\s*[^\\s，。！？,.!?]{1,}`, 'iu').test(normalized)
    || new RegExp(`${label}\\s*[：:=]\\s*[^\\s，。！？,.!?]{1,}`, 'iu').test(normalized)
}
