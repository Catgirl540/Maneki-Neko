import { useState } from 'react'
import { api } from '../../api'
import { ApiError } from '../../api/contract'
import { Button } from '../ui/Button'
import { Field } from '../ui/Field'
import { Modal } from '../ui/Modal'
import { useToast } from '../ui/toast-context'

/** 用户补充说明的长度上限，与服务端 `shared/error-report.mjs` 保持一致。 */
const NOTE_MAX = 200

/**
 * 报错反馈弹窗。
 *
 * 错误原文由出错的那一轮自动带入，用户只填一句「当时在做什么」。
 * 原文只读展示、不可编辑——让用户改错误信息会让排查失去依据。
 */
export function ErrorReportModal({
  open,
  message,
  page,
  onClose,
}: {
  open: boolean
  message: string
  page: string
  onClose: () => void
}) {
  const toast = useToast()
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit() {
    setBusy(true)
    setError(null)
    try {
      await api.reportError({
        message,
        note,
        page,
        appVersion: import.meta.env.VITE_APP_VERSION ?? 'web',
        platform: 'web',
      })
      toast.show('已发送给运维', 'success')
      setNote('')
      onClose()
    } catch (failure) {
      const text = failure instanceof ApiError ? failure.message : '发送失败，请稍后重试'
      setError(text)
      toast.show(text, 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="反馈给运维"
      description="会把这条错误原文和页面信息发给运维排查，不会包含账户余额等业务数据。"
      closeDisabled={busy}
    >
      <div className="rounded-field border border-line bg-sunk p-3">
        <p className="text-[12px] text-ink-mute">错误信息</p>
        <p className="mt-1 max-h-[120px] overflow-auto whitespace-pre-wrap break-words text-[13px] text-ink">{message}</p>
      </div>
      <div className="mt-3">
        <Field
          label="补充说明（可选）"
          value={note}
          maxLength={NOTE_MAX}
          placeholder="当时在做什么？例如：点了转账确认后报错"
          error={error ?? undefined}
          onChange={(event) => {
            setNote(event.target.value)
            setError(null)
          }}
        />
      </div>
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="ghost" disabled={busy} onClick={onClose}>取消</Button>
        <Button loading={busy} onClick={() => void submit()}>发送</Button>
      </div>
    </Modal>
  )
}