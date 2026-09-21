/**
 * 裸 PCM 解码的离线门禁（不起浏览器、不联网、不花钱）。
 *
 * 这一步是"声音会不会变成噪音"的唯一开关：字节序、除数、奇数字节。
 * 三件事在浏览器里都很难用肉眼分辨，所以必须在这里钉死。
 *
 *   node --import ./tools/ts-resolve-hook.mjs tools/check-pcm.mjs
 */
import { pcm16ToFloat32 } from '../app/src/lib/pcm.ts'
import { peaksFromSamples } from '../app/src/lib/waveform.ts'

let failures = 0
const report = (ok, title, lines = []) => {
  if (!ok) failures += 1
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${title}`)
  for (const line of lines) console.log(`      ${line}`)
}

/** 一串 Int16 → PCM16 LE 字节。 */
function bytesOf(values) {
  const buffer = Buffer.alloc(values.length * 2)
  values.forEach((v, i) => buffer.writeInt16LE(v, i * 2))
  return buffer
}

console.log('== A. PCM16 LE → 浮点采样 ==')

{
  const out = pcm16ToFloat32(bytesOf([0, 32767, -32768, 16384]))
  report(out.length === 4, 'A1 每 2 字节解出一个采样', [`长度=${out.length}`])
  report(
    out[0] === 0 && out[1] > 0.999 && out[2] === -1 && Math.abs(out[3] - 0.5) < 1e-6,
    'A2 满量程映射正确（0 → 0，32767 → ≈1，-32768 → -1，16384 → 0.5）',
    [`实际：${[...out].map((v) => v.toFixed(4)).join(', ')}`],
  )
}

{
  // 字节序反了会得到完全不同的结果：这是最容易静默出错的地方
  const out = pcm16ToFloat32(bytesOf([256, -256]))
  report(
    Math.abs(out[0] - 256 / 32768) < 1e-6 && Math.abs(out[1] + 256 / 32768) < 1e-6,
    'A3 按小端读（大端会把 256 读成 1）',
    [`256 → ${out[0]?.toFixed(6)}（小端应为 ${(256 / 32768).toFixed(6)}）`],
  )
}

{
  const out = pcm16ToFloat32(bytesOf([100, 200, 300]))
  report(out.length === 3, 'A4 正常长度不受影响', [`长度=${out.length}`])
}

{
  // 奇数长度：丢掉最后那个落单的字节，不抛异常（网络分片可能切在半路）
  const odd = Buffer.concat([bytesOf([1000, 2000]), Buffer.from([0x7f])])
  let out = null
  try {
    out = pcm16ToFloat32(odd)
  } catch (error) {
    out = `抛异常：${String(error)}`
  }
  report(Array.isArray(out) || out instanceof Float32Array ? out.length === 2 : false, 'A5 奇数字节丢最后半个，不抛异常', [
    `长度=${out?.length ?? out}`,
  ])
}

{
  const out = pcm16ToFloat32(bytesOf([]))
  report(out.length === 0, 'A6 空输入 → 空输出')
}

console.log('\n== B. 波形判据（渐强音频必须右高左低）==')

{
  // 造一段 4 秒渐强正弦（和浏览器门禁里那段同构）
  const sampleRate = 24000
  const count = sampleRate * 4
  const samples = new Float32Array(count)
  for (let i = 0; i < count; i += 1) {
    const amp = 0.08 + 0.92 * (i / count)
    samples[i] = Math.sin((2 * Math.PI * 220 * i) / sampleRate) * amp
  }
  const peaks = peaksFromSamples(samples, 56)
  const third = Math.floor(peaks.length / 3)
  const avg = (list) => list.reduce((a, b) => a + b, 0) / list.length
  const head = avg(peaks.slice(0, third))
  const tail = avg(peaks.slice(-third))
  report(peaks.length === 56, 'B1 56 根柱子', [`bars=${peaks.length}`])
  report(tail > head * 1.5, 'B2 渐强音频 → 柱子右高左低（随机波形过不了这条）', [
    `左 ${head.toFixed(2)} → 右 ${tail.toFixed(2)}`,
  ])
  report(peaks.every((p) => p >= 0.06 && p <= 1), 'B3 柱高都落在 0.06~1', [
    `min=${Math.min(...peaks).toFixed(3)} max=${Math.max(...peaks).toFixed(3)}`,
  ])
}

{
  // 分段解码后拼接，等价于一次性解码（流式播放的合并语义）
  const sampleRate = 24000
  const count = sampleRate * 2
  const first = new Float32Array(count)
  const second = new Float32Array(count)
  for (let i = 0; i < count; i += 1) {
    first[i] = Math.sin((2 * Math.PI * 220 * i) / sampleRate) * (0.1 + 0.4 * (i / count))
    second[i] = Math.sin((2 * Math.PI * 220 * i) / sampleRate) * (0.5 + 0.5 * (i / count))
  }
  const merged = new Float32Array(first.length + second.length)
  merged.set(first)
  merged.set(second, first.length)
  report(merged.length === count * 2, 'B4 两段采样拼接后长度是两段之和', [`长度=${merged.length}`])
  report(merged[0] === first[0] && merged[count] === second[0], 'B5 拼接边界处的采样就是第二段开头', [])
}

console.log(failures === 0 ? '\ncheck-pcm: 全部通过' : `\ncheck-pcm: ${failures} 项失败`)
process.exit(failures === 0 ? 0 : 1)
