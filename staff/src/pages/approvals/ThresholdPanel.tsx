import { useCallback, useEffect, useState } from 'react'
import { ApiError, api, type TransferThreshold } from '@/api'
import { useSession } from '@/store/session-context'
import { formatCents } from './labels'

/**
 * 延迟到账阈值（清单 §9.1，2026-10-12 起运行时可改）。
 * - 主管可改，客服只读：阈值是风控参数，不该随手拧
 * - 改完立刻对下一笔转账生效，不用重启后端
 * - 输入框填**元**，落库是**整数分** —— 换算只在这里做，别处不许混单位
 */

/** 元 → 整数分；两位小数以上直接拒，避免浮点尾巴 */
function yuanToCents(input: string): number | null {
  const trimmed = input.trim().replace(/^¥/, '').replace(/,/g, '')
  if (!/^\d+(\.\d{1,2})?$/.test(trimmed)) return null
  return Math.round(Number(trimmed) * 100)
}

export function ThresholdPanel() {
  const { user } = useSession()
  const isSupervisor = user?.role === 'supervisor'
  const [threshold, setThreshold] = useState<TransferThreshold | null>(null)
  const [draft, setDraft] = useState('')
  const [editing, setEditing] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  const load = useCallback(async () => {
    try {
      const next = await api.getTransferThreshold()
      setThreshold(next)
      setDraft((next.transferReviewCents / 100).toString())
      setError(null)
    } catch (e) {
      setError(e instanceof ApiError ? e.message : '阈值读取失败')
    }
  }, [])

  useEffect(() => {
    // oxlint-disable-next-line react/set-state-in-effect
    load()
  }, [load])

  async function save() {
    const cents = yuanToCents(draft)
    if (cents === null) {
      setError('请输入金额（元），最多两位小数，例如 500000')
      return
    }
    setBusy(true)
    setError(null)
    setSaved(false)
    try {
      const next = await api.updateTransferThreshold(cents)
      setThreshold(next)
      setDraft((next.transferReviewCents / 100).toString())
      setEditing(false)
      setSaved(true)
    } catch (e) {
      setError(e instanceof ApiError ? e.message : '保存失败，请稍后重试')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mt-4 rounded-[var(--radius-tile)] border border-[var(--color-line-strong)] bg-[var(--color-paper)] px-4 py-3">
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-xs text-[var(--color-ink-mute)]">延迟到账阈值</span>
        {threshold ? (
          <span className="text-sm font-medium text-[var(--color-ink)]">
            {formatCents(threshold.transferReviewCents)}
          </span>
        ) : (
          <span className="text-sm text-[var(--color-ink-mute)]">—</span>
        )}
        <span className="text-xs text-[var(--color-ink-mute)]">
          单笔 ≥ 该金额进在途窗口；窗口到点自动到账
        </span>

        {isSupervisor && !editing && (
          <button
            onClick={() => {
              setEditing(true)
              setSaved(false)
            }}
            className="ml-auto rounded-[var(--radius-tile)] border border-[var(--color-line-strong)] px-3 py-1 text-xs text-[var(--color-ink-soft)] hover:bg-[var(--color-sunk)]"
          >
            修改
          </button>
        )}
        {!isSupervisor && (
          <span className="ml-auto text-xs text-[var(--color-ink-mute)]">只有主管可以修改</span>
        )}
      </div>

      {editing && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            inputMode="decimal"
            placeholder="金额（元）"
            className="w-40 rounded-[var(--radius-field)] border border-[var(--color-line-strong)] px-3 py-1.5 text-sm"
          />
          <button
            onClick={save}
            disabled={busy}
            className="rounded-[var(--radius-tile)] bg-[var(--color-ink)] px-3 py-1.5 text-xs text-[var(--color-paper)] disabled:opacity-50"
          >
            {busy ? '保存中…' : '保存'}
          </button>
          <button
            onClick={() => {
              setEditing(false)
              setError(null)
              if (threshold) setDraft((threshold.transferReviewCents / 100).toString())
            }}
            className="rounded-[var(--radius-tile)] border border-[var(--color-line-strong)] px-3 py-1.5 text-xs text-[var(--color-ink-soft)]"
          >
            取消
          </button>
          {threshold && (
            <span className="text-xs text-[var(--color-ink-mute)]">
              上限 {formatCents(threshold.maxTransferReviewCents)}（须低于单笔转账上限）
            </span>
          )}
        </div>
      )}

      {saved && !editing && (
        <p className="mt-2 text-xs text-[var(--color-blue-deep)]">
          已保存，下一笔转账即按新阈值判断。
        </p>
      )}
      {error && <p className="mt-2 text-xs text-[var(--color-coral)]">{error}</p>}
    </div>
  )
}
