/**
 * 朗读播放器：波形 + 进度条 + 时间。
 *
 * ## 为什么波形和进度条都要
 *
 * 它们回答的是不同的问题：
 *
 *   · **波形**告诉你"这段语音长什么样"——哪里是重音、哪里是停顿、还有多长。
 *     已经播过的那部分用金色，没播的是灰色，所以它**同时也是一个进度指示**。
 *   · **进度条**给你精确位置。波形柱子在窄屏上只有几十像素，靠它判断
 *     "还剩多久"是不够准的。
 *
 * 两者都基于同一个 `ratio`（`useVoice` 里从 `<audio>` 的 `currentTime / duration` 来），
 * 所以不会出现"波形走了一半、进度条还在三分之一"这种对不上的情况。
 *
 * ## 柱高是真实数据，不是画着好看的
 *
 * `waveform` 里的每个值都是**那段音频的峰值包络**（解码后按段取最大值、再归一化，
 * 见 `lib/waveform.ts`）。解码还没回来时它是空的，这时只画进度条——
 * 宁可少画，也不画一条编出来的波形。
 *
 * @module app/components/agent/SpeechPlayer
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { cn } from '@/lib/cn'
import { callerFrame, voiceLog } from '@/lib/voiceLog'

/** 秒 → `0:07`。超过一小时按 `时:分:秒`，虽然朗读到不了那么长。 */
function clock(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00'
  const total = Math.floor(seconds)
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

export interface SpeechPlayerProps {
  /** 已经播了多少秒。 */
  position: number
  /** 总时长（秒）；未知时为 0。 */
  duration: number
  /** 播放比例（0–1）。 */
  ratio: number
  /** 峰值包络；空数组表示还没解出来（这时只画进度条）。 */
  waveform: number[]
  /**
   * 用户点了/拖了进度条，跳到 `ratio`（0–1）。
   * 不传就退化成只读的进度显示（没有可点的东西，也不会进 Tab 顺序）。
   */
  onSeek?: ((ratio: number) => void) | undefined
  className?: string
}

/**
 * 只画状态，**不自带停止按钮**：这条消息的动作行里已经有一个「停止朗读」，
 * 再放一个会让同一页出现两个同名控件——读屏软件分不清哪个是哪个，
 * 检查脚本也会数出两个"停止"（实测被 `tools/check-voice.mjs` 抓出来）。
 */
export function SpeechPlayer({ position, duration, ratio, waveform, onSeek, className }: SpeechPlayerProps) {
  const hasWave = waveform.length > 0
  // 播过的柱子按比例切。用 `<=` 让比例极小时也至少亮一根，不至于看起来没动。
  const played = Math.round(ratio * waveform.length)
  /*
   * 时长已知吗？
   *
   * 音频的 `duration` 要等元数据加载完才有值，在那之前是 0（或 NaN，被上层归一成 0）。
   * 这不是"零秒的音频"，而是"还不知道多长"——两者必须区别对待：
   *   · 报给读屏的 `aria-valuemax` 不能拿 1 顶替。那等于对读屏用户宣称
   *     "这段一共 1 秒"，而真实长度可能是 5 秒（实测：长回复开头的 200ms 里，
   *     `aria-valuemax` 是 1，随后才跳成 5）。
   *   · 时钟不能显示 `0:00 / 0:00`，那看起来像"没有内容"。
   * 所以未知时按**不确定进度条**处理：不报 valuenow/valuemax（ARIA 里这正是
   * "不确定"的表达），时钟的总时长显示 `--:--`。
   */
  const known = Number.isFinite(duration) && duration > 0

  /** 正在拖（拖动时去掉过渡动画，让金色跟着手指走）。 */
  const [dragging, setDragging] = useState(false)
  const trackRef = useRef<HTMLDivElement | null>(null)

  /**
   * 把一次指针位置换算成 0–1 的比例。
   *
   * 用 `getBoundingClientRect()` 现场量，不缓存宽度：窗口缩放、侧栏抽屉开合
   * 都会让这条变宽变窄，缓存下来的值会让"点哪儿跳哪儿"慢慢偏掉。
   */
  const ratioOf = useCallback((clientX: number): number | undefined => {
    const box = trackRef.current?.getBoundingClientRect()
    if (box === undefined || box.width <= 0) return undefined
    return Math.min(1, Math.max(0, (clientX - box.left) / box.width))
  }, [])

  /** 按住就跳：不用等抬手，点下去那一下就该动。 */
  function onPointerDown(event: React.PointerEvent<HTMLDivElement>): void {
    if (onSeek === undefined || !known) return
    const ratio = ratioOf(event.clientX)
    if (ratio === undefined) return
    setDragging(true)
    // 捕获指针：手指/鼠标滑出这条之外也能继续拖，不会中途掉线
    event.currentTarget.setPointerCapture(event.pointerId)
    onSeek(ratio)
  }

  function onPointerMove(event: React.PointerEvent<HTMLDivElement>): void {
    if (!dragging || onSeek === undefined) return
    const ratio = ratioOf(event.clientX)
    if (ratio !== undefined) onSeek(ratio)
  }

  function onPointerUp(event: React.PointerEvent<HTMLDivElement>): void {
    if (!dragging) return
    setDragging(false)
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
  }

  /** 键盘：←/→ 各 5 秒，Home/End 到两端。 */
  function onKeyDown(event: React.KeyboardEvent<HTMLDivElement>): void {
    if (onSeek === undefined || !known) return
    const step = 5 / Math.max(1, duration)
    let next: number | undefined
    if (event.key === 'ArrowRight' || event.key === 'ArrowUp') next = ratio + step
    else if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') next = ratio - step
    else if (event.key === 'Home') next = 0
    else if (event.key === 'End') next = 1
    if (next === undefined) return
    event.preventDefault()
    onSeek(Math.min(1, Math.max(0, next)))
  }

  /*
   * 挂载/卸载各留一条。
   *
   * 这是为了覆盖最后一种"播放器闪一下就没"的可能：**没有任何语音事件**，
   * 纯粹是外面那个渲染条件（`speakingId === item.id && playback !== undefined`）
   * 变了。那种情况下前面那些 `audio:*` / `stopSpeaking` 日志一条都不会出现，
   * 光看日志会以为"什么都没发生"——有了这两条就能立刻分辨
   * "是播放被停了"还是"组件被换掉了"。
   */
  useEffect(() => {
    voiceLog('播放器：挂载', { 调用者: callerFrame(2) })
    return () => { voiceLog('播放器：卸载') }
  }, [])

  return (
    <div className={cn('flex items-center gap-2.5 rounded-chip bg-sunk px-2.5 py-2', className)}>
      <div className="min-w-0 flex-1">
        {hasWave ? (
          /* 波形。`preserveAspectRatio="none"` 让它横向铺满、纵向不拉伸，
             否则窄屏上柱子会被压扁成一片。 */
          <svg
            /* `data-speech-wave` 是给检查脚本的稳定锚点：类名和样式会改，它不会 */
            data-speech-wave=""
            className="block h-6 w-full"
            viewBox={`0 0 ${waveform.length * 3} 24`}
            preserveAspectRatio="none"
            aria-hidden="true"
          >
            {waveform.map((value, index) => {
              const height = Math.max(2, value * 22)
              return (
                <rect
                  key={index}
                  x={index * 3}
                  y={(24 - height) / 2}
                  width={2}
                  height={height}
                  rx={1}
                  fill={index < played ? 'var(--color-gold-deep)' : 'var(--color-line-strong)'}
                />
              )
            })}
          </svg>
        ) : (
          /* 还没有波形（解码中，或这个浏览器解不了）：留一个等高的占位，
             高度和波形那块一致，避免解码回来时整条消息跳一下 */
          <div className="h-6" />
        )}

        {/*
          进度条 = **可拖动的跳转条**。

          ## 为什么从 `progressbar` 改成了 `slider`

          `progressbar` 是**只读**语义：读屏软件会把它念成"进度，百分之四十"，
          用户不会想到它能点。加了跳转之后它就是一个输入控件，正确的角色是
          `slider`，`aria-valuenow` 同时表达"现在播到哪儿"。

          ## 为什么外面套一层 h-4 的壳

          可见的条只有 3px 高——那玩意儿**根本点不中**（手指更不可能）。
          外面这层给足命中区域，里面那 3px 只负责好看。
          `touch-none` 是必须的：不加的话手机上拖动会变成滚页面。

          ## 键盘

          只能点、不能键盘操作的控件对键盘用户等于不存在。
          ←/→ 走 5 秒，Home/End 到两端——和播放器的通行约定一致。
        */}
        <div
          role="slider"
          aria-label="朗读进度，可点击或拖动跳转"
          aria-valuemin={0}
          aria-valuemax={known ? Math.round(duration) : undefined}
          aria-valuenow={known ? Math.round(position) : undefined}
          aria-valuetext={known ? `${clock(position)} / ${clock(duration)}` : '正在载入'}
          aria-disabled={!known}
          tabIndex={onSeek === undefined || !known ? -1 : 0}
          data-speech-progress=""
          ref={trackRef}
          title={onSeek === undefined ? undefined : '点击或拖动可以跳到想听的地方'}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onKeyDown={onKeyDown}
          className={cn(
            'group -mx-1 mt-0.5 flex h-4 touch-none items-center px-1',
            onSeek === undefined ? 'cursor-default' : 'cursor-pointer',
            'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold',
            'rounded-chip',
          )}
        >
          <div className="h-[3px] w-full overflow-hidden rounded-chip bg-line">
            {/* 用 `scaleX` 而不是 `width`：宽度是布局属性，每帧动它会触发重排
                （`tools/check-motion.mjs` 专门拦这个）。`origin-left` 让缩放从左边开始。
                拖动时**去掉 transition**：留着的话手指已经到 80% 了、金色还在 40% 爬。 */}
            <div
              className={cn(
                'h-full origin-left rounded-chip bg-gold-deep',
                !dragging && 'transition-transform duration-200 ease-linear',
              )}
              style={{ transform: `scaleX(${Math.min(1, Math.max(0, ratio))})` }}
            />
          </div>
        </div>
      </div>

      <span className="num shrink-0 text-[11px] text-ink-mute">
        {clock(position)} / {known ? clock(duration) : '--:--'}
      </span>
    </div>
  )
}
