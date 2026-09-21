/**
 * 「模型问用户」的卡片：把 `ask_user_question` 的问题渲染成可选项 + 自由输入。
 *
 * 这张卡对应运行时里**已经挂住**的那次工具调用：用户不回答，工具就一直不返回，
 * 模型的这一轮也走不下去。所以它是"必须处理"的东西，不是一条可以划过去的通知。
 *
 * 三种答法，可以混着用：
 *   1. **单选**（`multiSelect` 缺省）：选项渲染成 radio，选一个；
 *   2. **多选**（`multiSelect: true`）：渲染成 checkbox，选几个；
 *   3. **自己写**：每道题都带一个自由输入框（「其他」）。
 *
 * 没有选项的题就是一道纯自由输入题——这也是为什么输入框是**常驻**的，
 * 而不是"选了『其他』才出现"：模型可能给了一堆它想得到的选项，
 * 但用户的答案本来就不该被模型的想象力限制住。
 *
 * 组件本身**不发请求**：只把答案交回给父组件，保持"谁拥有状态谁负责副作用"。
 *
 * @module app/components/agent/QuestionCard
 */

import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/Button'
import { AlertIcon, CheckIcon, SparkleIcon } from '@/components/ui/icons'
import { cn } from '@/lib/cn'
import type { PendingAsk } from '@/lib/useAgentChat'
import type { QuestionAnswerItem } from '@/api/agent'

/** 把剩余时间说成「还剩 1 分 20 秒」。 */
function remainingText(expiresAt: number, now: number): string {
  const seconds = Math.ceil(Math.max(0, expiresAt - now) / 1000)
  if (seconds <= 0) return '已超时，需要重新发起'
  if (seconds < 60) return `还剩 ${seconds} 秒`
  return `还剩 ${Math.floor(seconds / 60)} 分 ${seconds % 60} 秒`
}

/** 一道题当前的作答状态。 */
interface Draft {
  /** 选中的选项标签。 */
  selected: string[]
  /** 自由输入框里的字。 */
  custom: string
}

/** 这道题算不算答了：选了选项，或者自己写了非空白的字。 */
function isAnswered(draft: Draft | undefined): boolean {
  if (draft === undefined) return false
  return draft.selected.length > 0 || draft.custom.trim() !== ''
}

export function QuestionCard({
  ask,
  onSubmit,
}: {
  ask: PendingAsk
  /** 用户提交的答案。 */
  onSubmit: (answers: QuestionAnswerItem[]) => void
}) {
  const { question, submitting, error } = ask
  const [drafts, setDrafts] = useState<Record<string, Draft>>({})
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    const timer = setInterval(() => { setNow(Date.now()) }, 1000)
    return () => { clearInterval(timer) }
  }, [])

  const expired = now > question.expiresAt
  const secondsLeft = Math.ceil((question.expiresAt - now) / 1000)
  const urgent = !expired && secondsLeft <= 30
  const allAnswered = question.questions.every(item => isAnswered(drafts[item.id]))
  const canSubmit = !submitting && !expired && allAnswered

  /** 改一道题的草稿。 */
  function patchDraft(id: string, change: (draft: Draft) => Draft): void {
    setDrafts(prev => ({ ...prev, [id]: change(prev[id] ?? { selected: [], custom: '' }) }))
  }

  /** 点一个选项。单选替换、多选增删。 */
  function toggleOption(id: string, label: string, multiSelect: boolean): void {
    patchDraft(id, (draft) => {
      if (!multiSelect) return { ...draft, selected: [label] }
      const selected = draft.selected.includes(label)
        ? draft.selected.filter(item => item !== label)
        : [...draft.selected, label]
      return { ...draft, selected }
    })
  }

  function submit(): void {
    if (!canSubmit) return
    onSubmit(question.questions.map((item) => {
      const draft = drafts[item.id] ?? { selected: [], custom: '' }
      const custom = draft.custom.trim()
      return {
        id: item.id,
        selected: draft.selected,
        ...custom === '' ? {} : { custom },
      }
    }))
  }

  return (
    <div
      className={cn(
        'pop-in rounded-card border border-gold bg-gold-wash/60 p-4',
        // 数据锚点：门禁按它找这张卡，不按文案。文案随时会改。
        ''
      )}
      data-question-card
    >
      <div className="flex items-start gap-2.5">
        <span className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-chip bg-gold text-ink">
          <SparkleIcon size={14} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-medium text-ink">
            {question.questions.length > 1
              ? `需要你确认 ${question.questions.length} 件事`
              : '助手想问你一件事'}
          </p>
          <p className={cn('mt-0.5 text-[12px]', urgent ? 'text-coral' : 'text-ink-mute')}>
            {remainingText(question.expiresAt, now)}
            {expired && '　这时再回答，助手已经收不到了'}
          </p>
        </div>
      </div>

      <div className="mt-3 flex flex-col gap-4">
        {question.questions.map(item => {
          const draft = drafts[item.id] ?? { selected: [], custom: '' }
          const multi = item.multiSelect ?? false
          const groupName = `ask_${question.questionId}_${item.id}`
          return (
            <fieldset key={item.id} className="min-w-0" data-question-id={item.id}>
              {item.header !== undefined && (
                <legend className="float-left mb-1 text-[12px] font-medium text-gold-deep">
                  {item.header}
                </legend>
              )}
              <p className="clear-both text-[14px] leading-relaxed text-ink">{item.question}</p>

              {(item.options ?? []).length > 0 && (
                <div className="mt-2 flex flex-col gap-1.5" data-question-options>
                  {(item.options ?? []).map(option => {
                    const checked = draft.selected.includes(option.label)
                    return (
                      <label
                        key={option.label}
                        className={cn(
                          'flex cursor-pointer items-start gap-2.5 rounded-chip border px-3 py-2 transition-colors',
                          checked
                            ? 'border-gold bg-surface'
                            : 'border-line bg-surface/60 hover:border-gold/60',
                        )}
                      >
                        {/* 原生 radio/checkbox 而不是自己画的方块：
                            键盘、读屏、焦点环全都免费，也不用自己维护 aria。
                            `accent-*` 让浏览器原生控件跟着主题色走。 */}
                        <input
                          type={multi ? 'checkbox' : 'radio'}
                          name={groupName}
                          value={option.label}
                          checked={checked}
                          onChange={() => { toggleOption(item.id, option.label, multi) }}
                          disabled={submitting || expired}
                          className="mt-0.5 size-4 shrink-0 accent-[var(--color-gold)]"
                        />
                        <span className="min-w-0">
                          <span className="block text-[13px] text-ink">{option.label}</span>
                          {option.description !== undefined && (
                            <span className="mt-0.5 block text-[12px] text-ink-mute">
                              {option.description}
                            </span>
                          )}
                        </span>
                      </label>
                    )
                  })}
                </div>
              )}

              {/* 自由输入**常驻**：模型给的选项是它的想象力上限，不该是用户的。 */}
              <input
                value={draft.custom}
                onChange={(e) => { patchDraft(item.id, d => ({ ...d, custom: e.target.value })) }}
                onKeyDown={(e) => {
                  // 回车直接提交——多道题时只有全都答了才真的提交（canSubmit 会挡）。
                  if (e.key === 'Enter') { e.preventDefault(); submit() }
                }}
                disabled={submitting || expired}
                placeholder={(item.options ?? []).length > 0 ? '或者自己写一个答案' : '输入你的答案'}
                aria-label={`${item.question}（自己写答案）`}
                data-question-custom
                className="mt-2 h-10 w-full rounded-chip border border-line bg-surface px-3 text-[13px] text-ink outline-none transition-colors placeholder:text-ink-mute focus:border-gold disabled:bg-sunk"
              />
            </fieldset>
          )
        })}
      </div>

      {error !== undefined && (
        <p role="alert" className="mt-3 flex items-start gap-1.5 text-[12px] text-coral">
          <AlertIcon size={13} className="mt-0.5 shrink-0" />
          {error}
        </p>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <Button
          type="button"
          onClick={submit}
          disabled={!canSubmit}
          className="h-9 px-4 text-[13px]"
        >
          <CheckIcon size={14} className="mr-1.5" />
          {submitting ? '正在提交…' : '提交'}
        </Button>
        <span className="text-[12px] text-ink-mute">
          {expired
            ? '这张卡已经过期了。'
            : allAnswered ? '答完点提交，助手会接着办。' : '每道题都要答（选一个，或者自己写）。'}
        </span>
      </div>
    </div>
  )
}
