/**
 * 波形包络的检查：把采样压成柱子这件事，算得对不对。
 *
 * 为什么单独测：波形图**看起来**总是对的——随机画一堆高低不一的柱子也很像波形。
 * 所以这条检查盯的不是"画出来了"，而是**它真的来自音频**：
 * 前轻后重的音频，右边的柱子必须比左边高；整段静音，必须是一条细线而不是一片空白。
 * 判据错了的话，界面上完全看不出来（照样好看），只有这一条能发现。
 *
 * 纯逻辑，不需要浏览器：
 *
 *   node --import ./tools/ts-resolve-hook.mjs tools/check-waveform.mjs
 */

import { DEFAULT_BUCKETS, peaksFromSamples } from '../app/src/lib/waveform.ts'

let failures = 0
const report = (ok, title, lines = []) => {
  if (!ok) failures += 1
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${title}`)
  for (const line of lines) console.log(`      ${line}`)
}
const eq = (actual, expected, title) => report(
  JSON.stringify(actual) === JSON.stringify(expected),
  title,
  [`实际：${JSON.stringify(actual)}`, `期望：${JSON.stringify(expected)}`],
)

/** 造一段采样。`at(i)` 给出第 i 个采样值。 */
const make = (length, at) => Float32Array.from({ length }, (_, i) => at(i))

/* ── 1. 前轻后重：右边必须更高（这条是"波形来自音频"的核心判据）───────── */

{
  const ramp = make(5600, (i) => (i / 5600) * 0.9 + 0.05)
  const peaks = peaksFromSamples(ramp, 8)
  const firstHalf = peaks.slice(0, 4).reduce((a, b) => a + b, 0)
  const secondHalf = peaks.slice(4).reduce((a, b) => a + b, 0)
  report(secondHalf > firstHalf * 2, '渐强的音频：后半段柱子明显比前半段高', [
    `前 4 根合计 ${firstHalf.toFixed(2)}，后 4 根合计 ${secondHalf.toFixed(2)}`,
  ])
  // 归一化之后最大值必须是满幅 1，否则形状再好也看不出对比
  eq(Math.max(...peaks), 1, '归一化之后最高的一根是满幅（1）')
}

/* ── 2. 前响后静：后半段落到"最低柱"，而不是 0 ────────────────────────── */

{
  const loudThenSilent = make(4000, (i) => (i < 2000 ? 0.8 : 0))
  const peaks = peaksFromSamples(loudThenSilent, 8)
  report(
    peaks.slice(0, 3).every(v => v > 0.9) && peaks.slice(5).every(v => v > 0 && v <= 0.07),
    '先响后静：静音段是"一条细线"，不是 0（0 高的柱子看起来像界面缺了一块）',
    [`柱高：${peaks.map(v => v.toFixed(2)).join(' ')}`],
  )
}

/* ── 3. 整段静音：不能出现 NaN / 除零 ─────────────────────────────────── */

{
  const silent = make(1000, () => 0)
  const peaks = peaksFromSamples(silent, 8)
  const sane = peaks.every(v => Number.isFinite(v) && v > 0)
  report(sane, '整段静音时不会除零（每根柱子都是一个有限的正数）', [
    `柱高：${JSON.stringify(peaks)}`,
  ])
}

/* ── 4. 音量整体缩小：形状必须不变（只保留相对起伏，不然小声音是一条平线）── */

{
  const loud = make(2400, (i) => (i % 600 < 300 ? 1 : 0.1))
  const quiet = make(2400, (i) => (i % 600 < 300 ? 0.1 : 0.01))
  eq(
    peaksFromSamples(quiet, 4).map(v => Number(v.toFixed(2))),
    peaksFromSamples(loud, 4).map(v => Number(v.toFixed(2))),
    '整段音量缩小 10 倍之后，柱子形状一模一样（归一化只看相对强弱）',
  )
}

/* ── 5. 边界：空输入、段数为 0、段数超过采样数 ───────────────────────── */

eq(peaksFromSamples(new Float32Array(0), 8), [], '没有采样时返回空数组')
eq(peaksFromSamples(make(100, () => 1), 0), [], '段数为 0 时返回空数组')
eq(peaksFromSamples(make(5, () => 1), 50).length, 5, '段数超过采样数时收敛到采样数（不产生空段）')
eq(peaksFromSamples(make(1000, () => 1), 1), [1], '只分一段时就是满幅一根')

/* ── 6. 段数：默认值，以及"要几段给几段" ─────────────────────────────── */

eq(peaksFromSamples(make(10000, (_, i) => i % 7 / 7)).length, DEFAULT_BUCKETS, `默认段数是 ${DEFAULT_BUCKETS}`)
eq(peaksFromSamples(make(10000, () => 0.5), 12).length, 12, '指定 12 段就得到 12 根柱子')

/* ── 7. 取的是峰值不是均值 ─────────────────────────────────────────────
 *
 * 构造上要让两种算法给出**不同的形状**，否则这条断言是空的。
 * 实测踩到：最早写的是"每段里放一个尖峰"，归一化之后两种算法都得到
 * 一排等高的柱子，把"取峰值"改成"取均值"照样通过（假通过）。
 *
 * 这里让两段**均值相同、峰值不同**：
 *   第 1 段 `[1, 0, 0, 0]`  均值 0.25、峰值 1
 *   第 2 段 `[.25, .25, .25, .25]` 均值 0.25、峰值 0.25
 * 峰值法 → `[1, 0.25]`（一高一低）；均值法 → `[1, 1]`（两根一样高）。 */

{
  const samples = Float32Array.from([1, 0, 0, 0, 0.25, 0.25, 0.25, 0.25])
  const peaks = peaksFromSamples(samples, 2)
  report(
    peaks[0] > 0.9 && peaks[1] < 0.4,
    '取的是每段的峰值而不是均值（两段均值相同、峰值不同时必须能区分开）',
    [`柱高：${peaks.map(v => v.toFixed(2)).join(' ')}——峰值法约 1.00 / 0.25；均值法会给出一排等高的柱子`],
  )
}

console.log()
if (failures === 0) console.log('check-waveform: 全部通过')
else console.log(`check-waveform: ${failures} 项未通过`)
process.exit(failures === 0 ? 0 : 1)
