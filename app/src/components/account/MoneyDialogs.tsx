import { useState } from 'react'
import { Modal } from '@/components/ui/Modal'
import { useResetOnOpen } from '@/lib/usePresence'
import { ReceivingContent } from '@/pages/ReceivingPage'
import { TransferForm } from '@/pages/TransferPage'

type MoneyDialogProps = { open: boolean; onClose: () => void; onUpdate: () => void }

export function MoneyInDialog({ open, onClose, onUpdate }: MoneyDialogProps) {
  const [busy, setBusy] = useState(false)
  const [visit, setVisit] = useState(0)
  useResetOnOpen(open, () => { setBusy(false); setVisit(value => value + 1) })
  return <Modal open={open} onClose={onClose} closeDisabled={busy} title="转入" description="将收款信息提供给付款方，转入你的储蓄账户。" width="max-w-[540px]">
    <ReceivingContent key={visit} onClose={onClose} onUpdate={onUpdate} onBusyChange={setBusy} />
  </Modal>
}

export function MoneyOutDialog({ open, onClose, onUpdate }: MoneyDialogProps) {
  const [busy, setBusy] = useState(false)
  const [visit, setVisit] = useState(0)
  useResetOnOpen(open, () => { setBusy(false); setVisit(value => value + 1) })
  return <Modal open={open} onClose={onClose} closeDisabled={busy} title="转出" width="max-w-[1040px]">
    <TransferForm key={visit} onClose={onClose} onUpdate={onUpdate} onBusyChange={setBusy} />
  </Modal>
}
