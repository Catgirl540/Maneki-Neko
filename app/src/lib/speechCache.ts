/**
 * 朗读音频的缓存（流式时代）。
 *
 * ## 为什么必须有
 *
 * 合成是**按字数收费**的一次网络往返。同一句话念第二遍没有任何理由再花一次钱、
 * 再等一次——"重新生成"那类按钮更是很容易被连点。所以这里按**文本**缓存：
 *
 *   · **命中就直接复用**（采样 + 波形都在，重播瞬时出声）
 *   · **命中即最新**：`get` 会把它挪到 LRU 末尾
 *   · **淘汰旧条目**：最多留 `max` 条，按插入顺序丢最旧的
 *
 * ## 和旧版的区别（为什么变简单了）
 *
 * 旧版缓存的是 **object URL**，所以有一大摊"谁来 revoke、正在播的别回收"的
 * 逻辑。现在改缓存**采样数组**：播放器有自己的采样缓冲（`lib/streamPlayer.ts`
 * 在 `append` 时拷贝进自己的数组），所以淘汰缓存条目**不会**打断正在播的声音——
 * 那些专门防"地址被吊销"的机制整个就不需要了。
 *
 * 另一个变化：**不在缓存里合成**。流式合成的意义是"首帧到了就播"，如果 `get`
 * 未命中时在缓存里等整段合成完才返回，流式就白做了。所以这里只有 `get`（只读，
 * 未命中返回 undefined）与 `put`（合成完由调用方塞进来），合成与播放由 `useVoice`
 * 编排（`framework/design/P8-VOICE.md` 有整条链路的图）。
 *
 * 注入式依赖保留：`max` 可配，逻辑（命中、LRU、淘汰）离线可测——
 * 见 `tools/check-speech-cache.mjs`。
 *
 * @module app/lib/speechCache
 */

import { preview, voiceLog } from './voiceLog'

/** 一次流式合成的结果（缓存对外给的形状）。 */
export interface CachedSpeech {
  /** 全部采样（单声道 -1~1）。播放器会用这份采样直接出声。 */
  samples: Float32Array
  /** 采样率。 */
  sampleRate: number
  /** 文本太长被服务端截断了。 */
  truncated: boolean
  /** 波形包络（整段合成完毕后一次性算好，重播时不用再算）。 */
  waveform: number[]
}

export interface SpeechCacheDeps {
  /** 最多留几条。默认 16。 */
  max?: number
}

export interface SpeechCache {
  /** 取一段语音；未命中返回 undefined（不在里面合成）。命中会把它挪到 LRU 末尾。 */
  get: (text: string) => CachedSpeech | undefined
  /** 放入（或替换）一条。 */
  put: (text: string, entry: CachedSpeech) => void
  /** 当前缓存了几条（测试与诊断用）。 */
  size: () => number
  /** 清空。 */
  clear: () => void
}

/**
 * 造一个朗读缓存。
 * @param deps - 可配置项。
 * @returns 缓存实例。
 */
export function createSpeechCache(deps: SpeechCacheDeps = {}): SpeechCache {
  const max = deps.max ?? 16
  /** Map 的插入顺序就是 LRU 顺序：命中时删了再塞回去，最旧的在最前面。 */
  const entries = new Map<string, CachedSpeech>()

  return {
    get(text) {
      const hit = entries.get(text)
      if (hit !== undefined) {
        voiceLog('cache：命中', { 文本: preview(text), 缓存条数: entries.size })
        entries.delete(text)
        entries.set(text, hit)
        return hit
      }
      return undefined
    },

    put(text, entry) {
      voiceLog('cache：放入', { 文本: preview(text), 缓存条数: entries.size + (entries.has(text) ? 0 : 1) })
      entries.delete(text)
      entries.set(text, entry)
      while (entries.size > max) {
        const oldest = entries.keys().next()
        if (oldest.done === true) return
        entries.delete(oldest.value)
      }
    },

    size: () => entries.size,

    clear() {
      voiceLog('cache：清空（原有', entries.size, '条）')
      entries.clear()
    },
  }
}
