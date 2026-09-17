import { useToast } from './toast-context'
import { CopyIcon } from './icons'
import { cn } from '@/lib/cn'
import { copyText } from '@/lib/clipboard'

/**
 * 复制一小段文本。
 *
 * 抽成公共组件是因为「收款信息」和「交易编号」都要用 —— 两份实现里
 * 总有一份会忘了处理 `navigator.clipboard` 不存在的情况（非 HTTPS / 旧浏览器），
 * 那时按钮点了没反应，用户只会以为坏了。
 */
export function CopyButton({
  value,
  label,
  className,
  size = 'sm',
}: {
  value: string
  /** 播报与提示里的名字，例如「收款账户」 */
  label: string
  className?: string
  size?: 'sm' | 'md'
}) {
  const toast = useToast()
  return (
    <button
      type="button"
      aria-label={`复制${label}`}
      title={`复制${label}`}
      onClick={() => copyText(value, label, toast)}
      className={cn(
        'grid shrink-0 place-items-center rounded-[6px] text-ink-mute transition-colors hover:bg-gold-tint hover:text-gold-deep',
        size === 'sm' ? 'size-6' : 'size-8',
        className,
      )}
    >
      <CopyIcon size={size === 'sm' ? 15 : 17} />
    </button>
  )
}
