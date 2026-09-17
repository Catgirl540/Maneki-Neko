import type { HTMLAttributes, ReactNode } from 'react'
import { cn } from '@/lib/cn'

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  padded?: boolean
  as?: 'div' | 'section' | 'article'
}

export function Card({
  padded = true,
  as: Tag = 'div',
  className,
  children,
  ...rest
}: CardProps) {
  return (
    <Tag className={cn('card', padded && 'p-7', className)} {...rest}>
      {children}
    </Tag>
  )
}

export function CardHeader({
  title,
  action,
  className,
}: {
  title: ReactNode
  action?: ReactNode
  className?: string
}) {
  return (
    <div className={cn('flex items-center justify-between gap-4', className)}>
      <h2 className="text-[17px] leading-6 font-semibold text-ink">{title}</h2>
      {action}
    </div>
  )
}