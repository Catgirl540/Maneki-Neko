import type { Bank, BankRegion } from '@/api/types'

/**
 * 收款银行的展示文案。
 * 与 BankPicker 分开放：组件文件只导出组件，常量走 lib（否则 react-refresh 失效）。
 */
export const BANK_REGION_LABEL: Record<BankRegion, string> = {
  CN: '内地',
  HK: '香港',
}

/** 「中国银行（香港）· 香港银行代码 012」 */
export function describeBank(bank: Bank): string {
  return `${bank.name} · ${BANK_REGION_LABEL[bank.region]}银行代码 ${bank.code}`
}
