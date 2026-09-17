import type { ReceivingInfo } from '@/api/types'
import { BANK_REGION_LABEL } from './bank'

/** 收款信息里的一行：对方要抄的就是这些 */
export interface ReceivingRow {
  key: string
  label: string
  value: string
  /** 这一行是给哪种转账方式用的 —— 转数快和银行账户转账填的不是同一个东西 */
  hint?: string
}

/**
 * 把收款信息摊成「一行一个可复制项」。
 *
 * 界面和分享文本都由这里出，不再各写一份：两边分头拼的话，
 * 界面上改了个标题、复制出去的还是旧文案，而且没人会发现。
 */
export function receivingRows(info: ReceivingInfo): ReceivingRow[] {
  return [
    { key: 'holder', label: '收款户名', value: info.holder },
    {
      key: 'accountNo',
      label: '收款账户',
      value: info.accountNo,
      hint: `${info.accountLabel} · 银行账户转账填这个`,
    },
    {
      key: 'bank',
      label: '收款银行',
      value: `${info.bankName}（${BANK_REGION_LABEL[info.bankRegion]}）`,
    },
    { key: 'fpsMobile', label: '转数快手机号', value: info.fpsMobile, hint: '转数快转账可填手机号' },
    { key: 'fpsId', label: 'FPS ID', value: info.fpsId, hint: '转数快转账也可填 FPS ID' },
  ]
}

/** 「复制全部」用的整段文本：对方直接粘进备注就能核对 */
export function receivingText(info: ReceivingInfo): string {
  return receivingRows(info)
    .map((row) => `${row.label}：${row.value}`)
    .join('\n')
}
