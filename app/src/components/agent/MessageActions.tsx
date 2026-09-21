/**
 * 一条消息下面的那几个小动作：复制、朗读、重新生成、编辑。
 *
 * ## 为什么"重新生成"只挂在最后一条回复上
 *
 * 重新生成中间那条回复，就必须把它**后面**的几轮问答全丢掉——用户点的是
 * "重说这一句"，代价却是删掉后面十分钟的对话。所以这一条能力只给最后一条，
 * 界面上就不会出现"点了之后东西没了"的意外。
 *
 * ## 为什么"编辑"要先弹一个框
 *
 * 编辑本身就是一次输入，弹框是它天然的样子。但框里必须**写清楚代价**：
 * 这一条之后的内容会被删掉。更要紧的是写清楚下面这件事——
 *
 *   > 服务端的会话记录退不回去。
 *
 * 这是这套实现最容易被误解的地方：本地这份记录倒回去了，看起来像"回到当初"，
 * 但助手那边仍然记得被丢掉的那几句。所以重发**不是回到过去**，而是
 * "在同一个上下文里再问一遍"。这句话必须让用户看见，否则他会以为
 * "改了之后助手就当没听过原来的话"——那是个错误的安全感。
 *
 * @module app/components/agent/MessageActions
 */

import { CopyButton } from '@/components/ui/CopyButton'
import { Button } from '@/components/ui/Button'
import { PencilIcon, PlayIcon, RefreshIcon, StopIcon } from '@/components/ui/icons'
import { Modal } from '@/components/ui/Modal'
import { cn } from '@/lib/cn'

/** 和 `CopyButton` 长一样的图标按钮：一行里几个动作要看起来是同一套。 */
function ActionButton({
  label,
  icon,
  onClick,
  disabled,
  title,
}: {
  /** 无障碍名与 tooltip 的主干，例如「重新生成这条回复」。 */
  label: string
  icon: React.ReactNode
  onClick: () => void
  disabled?: boolean
  title?: string | undefined
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={title ?? label}
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'grid size-6 shrink-0 place-items-center rounded-[6px] text-ink-mute transition-colors',
        'hover:bg-gold-tint hover:text-gold-deep',
        'disabled:cursor-not-allowed disabled:text-ink-mute/40 disabled:hover:bg-transparent',
      )}
    >
      {icon}
    </button>
  )
}

export interface MessageActionsProps {
  /** 这条消息的正文（复制直接用原文，助手那侧是含 Markdown 的原样文字）。 */
  text: string
  /** 这条是用户说的话还是助手的回复。 */
  isUser: boolean
  /** 服务端报了语音能力才显示朗读按钮（否则是一个注定失败的按钮）。 */
  canSpeak: boolean
  /** 正在念的就是这一条。 */
  speaking: boolean
  /** 这是最后一条助手回复——只有它能"重新生成"。 */
  regeneratable: boolean
  /**
   * 现在不能倒回重发：这一轮还在回答中，或者有一张待确认的卡片没处理。
   * 前者的后果是"正在写的回复被抹掉、而事件流还在往里写"，
   * 后者的后果是"一笔还没执行的敏感操作被绕过"。
   */
  frozen: boolean
  frozenReason?: string | undefined
  onRegenerate: () => void
  onSpeak: () => void
  onStopSpeak: () => void
  onEdit: () => void
}

/** 一条消息下面那排小按钮。 */
export function MessageActions({
  text,
  isUser,
  canSpeak,
  speaking,
  regeneratable,
  frozen,
  frozenReason,
  onRegenerate,
  onSpeak,
  onStopSpeak,
  onEdit,
}: MessageActionsProps) {
  return (
    <div
      className={cn(
        'mt-1.5 flex items-center gap-0.5',
        // 用户说的话靠右，跟气泡同一边。
        isUser && 'justify-end',
      )}
    >
      <CopyButton value={text} label={isUser ? '这条消息' : '这条回复'} />
      {!isUser && canSpeak && (
        speaking
          ? <ActionButton label="停止朗读" icon={<StopIcon size={15} />} onClick={onStopSpeak} />
          : <ActionButton label="朗读这条回复" icon={<PlayIcon size={15} />} onClick={onSpeak} />
      )}
      {!isUser && regeneratable && (
        <ActionButton
          label="重新生成这条回复"
          icon={<RefreshIcon size={15} />}
          onClick={onRegenerate}
          disabled={frozen}
          title={frozen ? frozenReason : '重新生成这条回复'}
        />
      )}
      {isUser && (
        <ActionButton
          label="编辑这条消息"
          icon={<PencilIcon size={15} />}
          onClick={onEdit}
          disabled={frozen}
          title={frozen ? frozenReason : '改了之后重新问一遍'}
        />
      )}
    </div>
  )
}

/**
 * 「编辑这条消息」的弹框。
 *
 * 框里那句话是**必须的**，不是免责声明式的装饰：用户在这里做的是一个
 * 不可逆的动作（后面几轮问答会从本地记录里消失），而且很容易以为
 * "改了这一条，助手就当没听过原来那句"——服务端的会话记录退不回去。
 * 与其让他事后发现，不如在按下去之前就说清楚。
 */
export function EditMessageModal({
  open,
  value,
  /** 改完之后会被删掉几条内容（0 表示这条本来就是最后一条）。 */
  droppedCount,
  onChange,
  onClose,
  onSubmit,
}: {
  open: boolean
  value: string
  droppedCount: number
  onChange: (next: string) => void
  onClose: () => void
  onSubmit: () => void
}) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="修改这条消息"
      width="max-w-[520px]"
      footer={
        <>
          <Button block disabled={value.trim() === ''} onClick={onSubmit}>保存并重发</Button>
          <Button variant="ghost" block onClick={onClose}>取消</Button>
        </>
      }
    >
      <textarea
        value={value}
        onChange={(e) => { onChange(e.target.value) }}
        onKeyDown={(e) => {
          // 多行的框里回车要能换行，所以只有 Ctrl/Cmd + 回车才提交。
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
            e.preventDefault()
            if (value.trim() !== '') onSubmit()
          }
        }}
        rows={3}
        autoFocus
        aria-label="修改后的消息"
        className="w-full resize-none rounded-chip border border-line bg-surface px-4 py-3 text-[14px] leading-relaxed text-ink outline-none transition-colors focus:border-gold"
      />
      <p className="mt-3 text-[12px] leading-relaxed text-ink-soft">
        {droppedCount > 0
          ? `这条之后的 ${droppedCount} 条内容会从这台设备的记录里删掉，并按新的说法重新问一遍。`
          : '会按新的说法重新问一遍。'}
      </p>
      <p className="mt-1.5 text-[12px] leading-relaxed text-ink-mute">
        注意：助手那边的会话记录退不回去。它还记得原来的那句，所以这是「在同一个上下文里再问一遍」，
        而不是回到当初那个状态。
      </p>
    </Modal>
  )
}
