/**
 * 历史对话列表：新建、切换、重命名、删除。
 *
 * 它是**抽屉**而不是常驻侧栏：上一轮刚把客服页右边的两栏撤掉、只留聊天窗，
 * 再钉一个常驻侧栏等于把刚让出来的地方又占回去。默认不打开，需要时点一下。
 *
 * @module app/components/agent/SessionList
 */

import { PencilIcon, PlusIcon, TrashIcon } from '@/components/ui/icons'
import { cn } from '@/lib/cn'
import { messageCount, relativeTime, type StoredConversation } from '@/lib/agentSessions'

interface SessionListProps {
  conversations: StoredConversation[]
  activeId?: string
  /** 正在回答的对话 id。 */
  busyIds: string[]
  /** 上下文已经不在助手记忆里的对话 id。 */
  lostIds: string[]
  /** 现在（毫秒）。由外面传进来，免得列表里每行各自取一次时间。 */
  now: number
  onSelect: (id: string) => void
  onCreate: () => void
  onRename: (conversation: StoredConversation) => void
  onDelete: (conversation: StoredConversation) => void
}

/**
 * 历史对话列表。
 * @param props - 列表数据与四个操作。
 */
export function SessionList({
  conversations,
  activeId,
  busyIds,
  lostIds,
  now,
  onSelect,
  onCreate,
  onRename,
  onDelete,
}: SessionListProps) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center justify-between gap-2 border-b border-line px-3 py-3">
        <span className="text-[13px] font-medium text-ink">
          历史对话
          <span className="ml-1.5 text-[12px] font-normal text-ink-mute">{conversations.length}</span>
        </span>
        <button
          type="button"
          onClick={onCreate}
          className="inline-flex h-7 items-center gap-1 rounded-chip px-2 text-[12px] text-ink-soft transition-colors hover:bg-sunk hover:text-ink"
        >
          <PlusIcon size={13} />
          新对话
        </button>
      </div>

      <div className="min-h-0 flex-1 space-y-0.5 overflow-y-auto px-2 py-2">
        {conversations.map((conversation) => {
          const active = conversation.id === activeId
          const busy = busyIds.includes(conversation.id)
          const lost = lostIds.includes(conversation.id)
          const count = messageCount(conversation)
          return (
            <div
              key={conversation.id}
              className={cn(
                'group flex items-center rounded-chip transition-colors',
                active ? 'bg-gold-wash' : 'hover:bg-sunk',
              )}
            >
              <button
                type="button"
                onClick={() => { onSelect(conversation.id) }}
                aria-current={active ? 'true' : undefined}
                className="min-w-0 flex-1 px-3 py-2.5 text-left"
              >
                <span
                  className={cn(
                    'block truncate text-[13px] leading-5',
                    active ? 'font-medium text-ink' : 'text-ink-soft',
                  )}
                >
                  {conversation.title}
                </span>
                <span className="mt-0.5 flex items-center gap-1.5 text-[11px] text-ink-mute">
                  <span>{relativeTime(conversation.updatedAt, now)}</span>
                  {count > 0 && <span>· {count} 条</span>}
                  {busy && (
                    <span className="inline-flex items-center gap-1 text-blue">
                      <span className="size-1.5 animate-pulse rounded-chip bg-blue" />
                      回答中
                    </span>
                  )}
                  {!busy && lost && <span className="text-coral">上下文已失效</span>}
                </span>
              </button>

              {/* 常显但压暗：只在悬停时才出现的按钮，在触摸屏上等于没有。 */}
              <span className="flex shrink-0 items-center gap-0.5 pr-1.5 opacity-50 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
                <button
                  type="button"
                  aria-label={`重命名「${conversation.title}」`}
                  onClick={() => { onRename(conversation) }}
                  className="grid size-7 place-items-center rounded-chip text-ink-mute transition-colors hover:bg-surface hover:text-ink"
                >
                  <PencilIcon size={14} />
                </button>
                <button
                  type="button"
                  aria-label={`删除「${conversation.title}」`}
                  onClick={() => { onDelete(conversation) }}
                  className="grid size-7 place-items-center rounded-chip text-ink-mute transition-colors hover:bg-coral-wash hover:text-coral"
                >
                  <TrashIcon size={14} />
                </button>
              </span>
            </div>
          )
        })}
      </div>

      <p className="border-t border-line px-3 py-2.5 text-[11px] leading-4 text-ink-mute">
        对话记录只存在这台设备上。删除只是从这里的列表里拿掉，服务端与审计日志里的记录会保留。
      </p>
    </div>
  )
}
