/**
 * 裸 PCM 的解码（纯函数，离线可测）。
 *
 * 流式 TTS 回来的每一帧是 **PCM16 LE**（见 `bridge/volc-stream.mjs` 的实测结论），
 * 播放器要的是 -1~1 的浮点采样。这一步单独拎出来是因为它是"唯一可能把声音
 * 弄成噪音"的地方：字节序搞反 → 全是噪声；除数用 32767 而不是 32768 → 满量程
 * 会削顶。两件事在浏览器里都很难用肉眼验，所以必须能离线断言。
 *
 * @module app/lib/pcm
 */

/** `Int16` 除以它得到 -1~1。用 32768（2^15）而不是 32767：`-32768` 才刚好是 -1。 */
const INT16_MAX = 32768

/**
 * PCM16 LE 字节 → 单声道浮点采样。
 *
 * 长度为奇数（不是合法的 PCM16）时**丢掉最后一个字节**，不抛异常：
 * 网络分片理论上可能切在半路，为这个把整条朗读打断不值得。
 * @param bytes - 裸 PCM16 LE。
 * @returns 浮点采样（-1 ~ 1）。
 */
export function pcm16ToFloat32(bytes: ArrayBuffer | Uint8Array): Float32Array {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
  const count = Math.floor(view.byteLength / 2)
  // `Uint8Array` 可能不是 2 字节对齐的，那就先把字节拷出来再按 Int16 读
  const aligned = view.byteOffset % 2 === 0 && view.byteLength === count * 2
    ? new Int16Array(view.buffer, view.byteOffset, count)
    : (() => {
        const copy = new Uint8Array(count * 2)
        copy.set(view.subarray(0, count * 2))
        return new Int16Array(copy.buffer)
      })()
  const out = new Float32Array(count)
  for (let i = 0; i < count; i += 1) out[i] = aligned[i]! / INT16_MAX
  return out
}
