/**
 * 历史对话列表：新建、切换、重命名、删除。
 *
 * 它是**抽屉**而不是常驻侧栏：上一轮刚把客服页右边的两栏撤掉、只留聊天窗，
 * 再钉一个常驻侧栏等于把刚让出来的地方又占回去。默认不打开，需要时点一下。
 *
 * ## 当前项那块底是「滑」过去的
 *
 * 不是给每一行加 `bg-gold-wash`——那样切会话时是"这边没了、那边出现"，
 * 眼睛得重新找一次自己在哪。改成列表里躺着一块单独的滑块，
 * 切到哪一行就平移到哪一行（见 `global.css` 的 `.session-pill`）。
 *
 * 滑块要跟着走，就得知道每行在哪，也就是**必须测量**。位置没法在渲染期算出来，
 * 所以这里用 `useLayoutEffect` 量完直接写进 DOM 的 `style`，而不是走 state：
 * state 会多一轮渲染，滑块会先出现在旧位置再跳过去（看得见的闪一下）。
 *
 * @module app/components/agent/SessionList
 */

import { useLayoutEffect, useRef } from 'react'
import { PencilIcon, TrashIcon } from '@/components/ui/icons'
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
  onRename,
  onDelete,
}: SessionListProps) {
  /** 滚动的列表本体，同时也是滑块的定位基准（它带 `relative`）。 */
  const scroller = useRef<HTMLDivElement | null>(null)
  const pill = useRef<HTMLDivElement | null>(null)
  /** 每一行的 DOM，用来量位置。 */
  const rows = useRef(new Map<string, HTMLDivElement>())
  /** 量过一次之前不许过渡，否则滑块会从 0 滑到第一次的位置。 */
  const measured = useRef(false)

  useLayoutEffect(() => {
    const thumb = pill.current
    const track = scroller.current
    if (thumb === null || track === null) return
    const row = activeId === undefined ? undefined : rows.current.get(activeId)
    if (row === undefined) {
      thumb.style.opacity = '0'
      return
    }
    // 行高写成固定值、位置用 translateY：两者都从测量来。
    // 高度也写进去（而不是指望"每行一样高"）：行里可能多出一个「回答中」标记，
    // 不一样高的时候滑块会露一条缝。
    thumb.style.height = `${row.offsetHeight}px`
    thumb.style.transform = `translateY(${row.offsetTop}px)`
    if (!measured.current) {
      measured.current = true
      // 过渡由这个属性打开（见 global.css）：第一次落位不能有动画。
      track.dataset['measured'] = 'true'
    }
  })

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* 这里**不再放**「新对话」按钮：顶栏那一个一直可见，两个同名按钮并排在一屏里
          既冗余，也让"点的是哪一个"变得含糊（读屏软件读出来是两个一样的东西）。 */}
      <div className="flex items-center justify-between gap-2 border-b border-line px-3 py-3">
        <span className="text-[13px] font-medium text-ink">
          历史对话
          <span className="ml-1.5 text-[12px] font-normal text-ink-mute">{conversations.length}</span>
        </span>
      </div>

      <div ref={scroller} className="session-list relative min-h-0 flex-1 overflow-y-auto px-2 py-2">
        {/* 当前项那块底。第一子元素且绝对定位，行是后出现的定位元素，
            所以行（和行里的字）画在它上面；它自己不吃点击。 */}
        <div
          ref={pill}
          aria-hidden="true"
          className="session-pill pointer-events-none absolute inset-x-2 top-0 rounded-chip bg-gold-wash"
        />

        <div className="space-y-0.5">
          {conversations.map((conversation) => {
            const active = conversation.id === activeId
            const busy = busyIds.includes(conversation.id)
            const lost = lostIds.includes(conversation.id)
            const count = messageCount(conversation)
            return (
              <div
                key={conversation.id}
                ref={(node) => {
                  if (node === null) rows.current.delete(conversation.id)
                  else rows.current.set(conversation.id, node)
                }}
                className={cn(
                  'group relative flex items-center rounded-chip transition-colors',
                  // 当前项不自己上底色——那是滑块的事。
                  active ? undefined : 'hover:bg-sunk',
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
                  {/* 这一行**不许换行**。
                      换成两行的话行高会变，滑块就得跟着变高（本来就是为此写了高度过渡），
                      更要紧的是「上下文已失效」会被折成「上下文已失 / 效」——
                      实测在窄一点的抽屉里就是这样断的。
                      所以：状态标记 `shrink-0` 放在**前面**（它最要紧，永远不许被挤掉），
                      时间和条数放一个 `truncate` 里，窄了就从它开始省略。 */}
                  <span className="mt-0.5 flex items-center gap-1.5 text-[11px] text-ink-mute">
                    {busy && (
                      <span className="inline-flex shrink-0 items-center gap-1 text-blue">
                        <span className="size-1.5 animate-pulse rounded-chip bg-blue" />
                        回答中
                      </span>
                    )}
                    {!busy && lost && <span className="shrink-0 text-coral">上下文已失效</span>}
                    <span className="truncate">
                      {relativeTime(conversation.updatedAt, now, { compact: true })}
                      {count > 0 && ` · ${count} 条`}
                    </span>
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
      </div>

      <p className="border-t border-line px-3 py-2.5 text-[11px] leading-4 text-ink-mute">
        对话记录只存在这台设备上。删除只是从这里的列表里拿掉，服务端与审计日志里的记录会保留。
      </p>
    </div>
  )
}
