import { CardIcon, ChatIcon, GlobalIcon, LockIcon, ReceiptIcon, ShieldIcon, TransferIcon, TrendUpIcon, WalletIcon } from '@/components/ui/icons'

/**
 * 助手能力的**表现层**映射：图标，以及这个能力对应哪些业务页。
 *
 * 清单本身（有哪些入口、叫什么、什么顺序）由后端 `GET /agent-api/services`
 * 下发，唯一来源是 `framework/agent-services.json`；前端不再维护条目和文案。
 *
 * 后端新增一个这里没登记的 id 时，用通用图标、不挂 docked 上下文，
 * 仍然可以正常选择——只是少了页面归属，不会因为前端没跟上就消失。
 */
const PRESENTATION: Record<string, { Icon: typeof ChatIcon; paths: readonly string[] }> = {
  transfer: { Icon: TransferIcon, paths: ['/transfer', '/receiving'] },
  wealth: { Icon: TrendUpIcon, paths: ['/wealth', '/wealth/products', '/wealth/holdings', '/wealth/records', '/wealth/cash-management', '/wealth/investments', '/wealth/plans'] },
  analysis: { Icon: ReceiptIcon, paths: ['/analysis', '/analysis/statistics', '/analysis/autodebits', '/transactions'] },
  cards: { Icon: CardIcon, paths: ['/cards'] },
  exchange: { Icon: GlobalIcon, paths: ['/exchange'] },
  insurance: { Icon: ShieldIcon, paths: ['/wealth/insurance'] },
  credit: { Icon: WalletIcon, paths: ['/credit', '/cashflow'] },
  security: { Icon: LockIcon, paths: ['/security'] },
}

export function serviceIcon(id: string) {
  return PRESENTATION[id]?.Icon ?? ChatIcon
}

/** 当前页面属于哪个能力；没登记过的页面返回 undefined（助手退回自动匹配）。 */
export function serviceForPath(pathname: string): string | undefined {
  for (const [id, item] of Object.entries(PRESENTATION)) {
    if (item.paths.some(path => pathname === path)) return id
  }
  return pathname.startsWith('/transactions/') ? 'analysis' : undefined
}
