import type { MailingAddress } from '@/api/types'

/**
 * 邮寄地址校验。
 * 与银行卡号、转数快标识一样放在 lib：表单要即时提示，mock 也要在服务端再校验一次 ——
 * 两边共用同一份规则才不会出现「前端过了后端不过」。
 */

export const EMPTY_ADDRESS: MailingAddress = {
  recipient: '',
  phone: '',
  region: '',
  city: '',
  detail: '',
  postalCode: '',
}

/** 逐字段校验，返回错误文案（通过则 null） */
export function validateAddressField(
  field: keyof MailingAddress,
  address: MailingAddress,
): string | null {
  switch (field) {
    case 'recipient':
      return address.recipient.trim() ? null : '请填写收件人姓名'
    case 'phone': {
      const digits = address.phone.replace(/\D/g, '')
      if (!digits) return '请填写手机号'
      return /^1[3-9]\d{9}$/.test(digits) ? null : '请输入 11 位手机号'
    }
    case 'region':
      return address.region.trim() ? null : '请填写省 / 直辖市'
    case 'city':
      return address.city.trim() ? null : '请填写城市'
    case 'detail':
      if (!address.detail.trim()) return '请填写详细地址'
      return address.detail.trim().length >= 5 ? null : '详细地址至少 5 个字'
    case 'postalCode':
      if (!address.postalCode?.trim()) return null
      return /^\d{6}$/.test(address.postalCode.trim()) ? null : '邮政编码为 6 位数字'
    default:
      return null
  }
}

/** 整份地址校验，返回第一个错误（通过则 null） */
export function validateAddress(address: MailingAddress): string | null {
  const fields: (keyof MailingAddress)[] = [
    'recipient',
    'phone',
    'region',
    'city',
    'detail',
    'postalCode',
  ]
  for (const field of fields) {
    const error = validateAddressField(field, address)
    if (error) return error
  }
  return null
}

/** 一行展示的邮寄地址 */
export function formatAddress(address: MailingAddress): string {
  return [address.region, address.city, address.detail].filter(Boolean).join(' ')
}
