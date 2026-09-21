/**
 * 录音相关的浏览器小工具：挑格式、转 base64。
 *
 * 单独一个模块而不是塞进 `api/agent.ts`：那边在模块顶层读 `import.meta.env`，
 * 一 import 就要求有打包器的环境，于是这些纯函数就没法单独拿 node 测了
 * （实测踩到：`import.meta.env` 是 undefined，直接 TypeError）。
 *
 * @module app/lib/audio
 */

/**
 * 挑一个当前浏览器支持的录音格式。
 *
 * 顺序是有讲究的：Opus 在语音上体积最小、质量最好，所以 webm/ogg 排前面；
 * `audio/mp4` 是 Safari 唯一的选择。**必须传一个具体的 MIME**，
 * 不传的话各家的默认值不一样，而服务端要按 MIME 挑解码格式：拿不到就拒。
 *
 * 一个都不支持时返回 `''`，交给 `MediaRecorder` 用它自己的默认值——
 * 那种情况下转录那一步会被服务端明确拒绝，而不是静默产生乱码。
 * @returns MIME 类型，或空串。
 */
export function pickRecorderMime(): string {
  if (typeof MediaRecorder === 'undefined') return ''
  const candidates = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/ogg;codecs=opus',
    'audio/mp4',
  ]
  return candidates.find(type => MediaRecorder.isTypeSupported(type)) ?? ''
}

/**
 * 把音频转成 base64。
 *
 * 输出是**裸 base64**，不带 `data:audio/…;base64,` 前缀——接口文档写的就是裸 base64。
 *
 * （实测：上游其实**容忍**带前缀的写法，转录结果一模一样。这里仍然不带给，
 * 是因为那属于上游未写明的宽容，依赖它会有一天突然坏掉，而坏的方式是静默的。）
 *
 * 分块拼接：`String.fromCharCode(...bytes)` 一次铺开几十万个参数会爆栈，
 * 一段一分钟的录音足够触发（20 万字节就已经很危险）。
 * @param blob - 录音。
 * @returns 裸 base64 字符串。
 */
export async function blobToBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer())
  const CHUNK = 0x8000
  let binary = ''
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
  }
  return btoa(binary)
}
