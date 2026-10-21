import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { SparkleIcon, AlertIcon } from '@/components/ui/icons'
import { WEALTH_DEPOSIT_WARNING } from '@/lib/wealth'
import './wealth-workspace.css'

export function WealthHeader({ title, children }: { title: string; children?: ReactNode }) {
  return <>
    <header className="wealth-page-heading">
      <div><Link className="wealth-breadcrumb" to="/wealth">理财与储蓄</Link><h1>{title}</h1></div>
      <div className="flex items-center gap-3">{children}<Link to="/assistant" className="service-link gap-2"><SparkleIcon size={16} />咨询助手</Link></div>
    </header>
    <p className="wealth-warning"><AlertIcon size={14} />{WEALTH_DEPOSIT_WARNING}</p>
  </>
}
