import { Modal } from './Modal'
import { Button } from './Button'

/** 自动复制被禁用时，完整文本仍可由键盘或长按复制。 */
export function ManualCopyModal({ text, label, onClose }: { text: string | null; label: string; onClose: () => void }) {
  return (
    <Modal open={text !== null} onClose={onClose} title={`手动复制${label}`}
      description="浏览器未允许自动复制，请选中文本后复制。"
      footer={<Button block onClick={onClose}>完成</Button>}>
      <textarea aria-label={label} readOnly value={text ?? ''} rows={5}
        onFocus={(e) => e.currentTarget.select()}
        className="w-full resize-y rounded-field border border-line bg-surface p-3 text-[14px] text-ink" />
    </Modal>
  )
}
