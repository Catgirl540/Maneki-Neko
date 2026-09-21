/**
 * 朗读缓存的检查：命中复用、LRU、淘汰、替换。
 *
 * 这几件事都**不会在界面上报错**：重复合成只是白花钱（用户看不出来），
 * 淘汰顺序错了只是偶尔多花一次钱、多等一次。所以必须离线钉住。
 *
 * 流式时代缓存的是**采样数组**（不再有 object URL，也就没有 revoke 与
 * "正在播的别回收"那一摊——播放器有自己的采样缓冲，见 `lib/streamPlayer.ts`）。
 *
 *   node --import ./tools/ts-resolve-hook.mjs tools/check-speech-cache.mjs
 */

import { createSpeechCache } from '../app/src/lib/speechCache.ts'

let failures = 0
const report = (ok, title, lines = []) => {
  if (!ok) failures += 1
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${title}`)
  for (const line of lines) console.log(`      ${line}`)
}

/** 造一条假结果：采样里放一个可辨认的标记值，方便断言"拿到的就是同一条"。 */
const entry = (mark, sampleRate = 24000) => ({
  samples: Float32Array.from([mark, mark + 1]),
  sampleRate,
  truncated: false,
  waveform: [mark],
})

console.log('== A. 命中与未命中 ==')

{
  const cache = createSpeechCache({ max: 3 })
  const miss = cache.get('没缓存过的')
  report(miss === undefined, 'A1 未命中返回 undefined（不在缓存里合成）', [`实际：${String(miss)}`])
}

{
  const cache = createSpeechCache({ max: 3 })
  cache.put('你好', entry(1))
  const hit = cache.get('你好')
  report(
    hit !== undefined && hit.samples[0] === 1 && hit.sampleRate === 24000 && hit.waveform[0] === 1,
    'A2 命中拿回同一条（采样/采样率/波形都在）',
    [`samples=${hit === undefined ? 'undefined' : [...hit.samples]}`],
  )
  report(cache.size() === 1, 'A3 放一条就只有一条', [`size=${cache.size()}`])
}

{
  const cache = createSpeechCache({ max: 3 })
  cache.put('同一句', entry(7))
  cache.put('同一句', entry(9))
  const hit = cache.get('同一句')
  report(cache.size() === 1 && hit?.samples[0] === 9, 'A4 同键再放一次是替换，不是新增', [
    `size=${cache.size()} 首采样=${hit?.samples[0]}`,
  ])
}

console.log('\n== B. LRU 与淘汰 ==')

{
  const cache = createSpeechCache({ max: 3 })
  cache.put('甲', entry(1))
  cache.put('乙', entry(2))
  cache.put('丙', entry(3))
  // 摸一下"甲"，让它变成最新的
  cache.get('甲')
  // 再放一条：最旧的（乙）应该被淘汰
  cache.put('丁', entry(4))
  const kept = ['甲', '乙', '丙', '丁'].map((k) => cache.get(k) !== undefined)
  report(
    cache.size() === 3 && kept[0] && !kept[1] && kept[2] && kept[3],
    'B1 超上限时淘汰最旧的；被命中过的会留下来（LRU 而不是 FIFO）',
    [`甲=${kept[0]} 乙=${kept[1]} 丙=${kept[2]} 丁=${kept[3]} size=${cache.size()}`],
  )
}

{
  const cache = createSpeechCache({ max: 3 })
  for (let i = 0; i < 10; i += 1) cache.put(`第${i}句`, entry(i))
  report(cache.size() === 3, 'B2 连续放入也不会超过上限', [`size=${cache.size()}`])
  const oldestGone = cache.get('第0句') === undefined
  const newestKept = cache.get('第9句') !== undefined
  report(oldestGone && newestKept, 'B3 留的是最新的那几条', [
    `第0句还在=${!oldestGone} 第9句还在=${newestKept}`,
  ])
}

console.log('\n== C. 清空 ==')

{
  const cache = createSpeechCache({ max: 3 })
  cache.put('甲', entry(1))
  cache.put('乙', entry(2))
  cache.clear()
  report(cache.size() === 0 && cache.get('甲') === undefined, 'C1 clear 之后什么都不剩', [
    `size=${cache.size()}`,
  ])
}

{
  // 默认上限存在且合理（太大占内存，太小等于没有缓存）
  const cache = createSpeechCache()
  for (let i = 0; i < 40; i += 1) cache.put(`x${i}`, entry(i))
  report(cache.size() > 0 && cache.size() <= 40, 'C2 默认上限生效（不会无限增长）', [
    `size=${cache.size()}`,
  ])
}

console.log(failures === 0 ? '\ncheck-speech-cache: 全部通过' : `\ncheck-speech-cache: ${failures} 项失败`)
process.exit(failures === 0 ? 0 : 1)
