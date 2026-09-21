/**
 * 朗读时的波形：把一段音频压成**等分的峰值包络**，给界面画柱子。
 *
 * ## 为什么必须是真波形
 *
 * 画一条随机的、或者按文字长度算出来的波形，看起来一样好看——
 * 但它是**编的**：用户会以为那代表了这段语音的响度起伏（哪里重、哪里轻），
 * 而它什么也不代表。这个项目的规矩是"界面上的每个像素都得对应真实数据"，
 * 所以这里老老实实把音频解出来取包络。
 *
 * 代价是有一次解码（`decodeAudioData`）。一段十几秒的语音大约几十 KB，
 * 解码只要几毫秒，而且在播放**同时**做，用户感觉不到。
 *
 * ## 两个函数分开写是有意的
 *
 * `peaksFromSamples` 是**纯函数**（输入一串采样、输出一组高度），
 * 不碰浏览器 API，所以能离线测（`tools/check-waveform.mjs`）。
 * `envelopeFromUrl` 负责取数据与解码，只有它需要浏览器。
 * 混在一起写的话，分桶与归一化这两个最容易写错的地方就没法单独验了。
 *
 * @module app/lib/waveform
 */

/** 默认画多少根柱子。太少看不出形状，太多在小屏上糊成一片。 */
export const DEFAULT_BUCKETS = 56

/**
 * 最低柱高（占满幅的比例）。
 *
 * 不给 0 是因为：静音段画成 0 高的柱子看起来像**界面缺了一块**，
 * 而不是"这里没有声音"。留一条细线，形状才连续。
 */
const MIN_BAR = 0.06

/**
 * 把采样压成等分峰值。
 *
 * 取每段的**最大绝对值**（峰值）而不是平均值：包络图看的是"这一段的响度上限"，
 * 平均值会把短促的重音抹平。
 *
 * 最后按全局最大值归一化——不然一段整体音量偏小的语音会看起来是一条平线，
 * 形状全丢了。归一化之后只保留**相对**起伏，这正是波形图要表达的东西。
 *
 * @param samples - 单声道采样（-1 ~ 1）。
 * @param buckets - 分成多少段（也就是画多少根柱子）。
 * @returns 每段的高度（0.06 ~ 1）。没有采样时返回空数组。
 */
export function peaksFromSamples(samples: Float32Array, buckets = DEFAULT_BUCKETS): number[] {
  if (samples.length === 0 || buckets <= 0) return []
  // 段数不能超过采样数，否则后面会出现一堆空段（峰值恒为 0）
  const count = Math.min(Math.floor(buckets), samples.length)
  const size = samples.length / count

  const peaks: number[] = []
  for (let i = 0; i < count; i += 1) {
    const start = Math.floor(i * size)
    const end = Math.max(start + 1, Math.floor((i + 1) * size))
    let peak = 0
    for (let j = start; j < end && j < samples.length; j += 1) {
      const value = Math.abs(samples[j] ?? 0)
      if (value > peak) peak = value
    }
    peaks.push(peak)
  }

  let max = 0
  for (const peak of peaks) if (peak > max) max = peak
  // 全是静音（max = 0）时不要除以 0：直接给一排最低柱
  if (max <= 0) return peaks.map(() => MIN_BAR)
  return peaks.map(peak => Math.max(MIN_BAR, peak / max))
}

/**
 * 取一段音频的波形包络。
 *
 * @param url - 音频地址（`synthesizeSpeech` 给的 object URL 可以直接用）。
 * @param buckets - 分成多少段。
 * @returns 每段高度；**解码失败时抛出**，由调用方决定降级（界面上退回普通进度条）。
 */
export async function envelopeFromUrl(url: string, buckets = DEFAULT_BUCKETS): Promise<number[]> {
  const response = await fetch(url)
  const bytes = await response.arrayBuffer()
  // 单独建一个 context 用完就关：它只用来解码，不需要参与播放，
  // 留着会一直占着一个音频上下文（浏览器对同时存在的上下文数量是有限制的）。
  const Ctor = window.AudioContext
  const context = new Ctor()
  try {
    const buffer = await context.decodeAudioData(bytes)
    return peaksFromSamples(buffer.getChannelData(0), buckets)
  } finally {
    void context.close()
  }
}
