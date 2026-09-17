#!/usr/bin/env node
/**
 * 生成「招财猫银行」自己的行标：`app/public/banks/cn-LCB.svg`
 *
 * 为什么本行也要有一个文件
 * ------------------------
 * 本行是虚构机构，不占用真实行别代码与卡号号段（见 README §11），但它**有自己的品牌标**
 * ——就是侧栏和登录页上那只猫。收款银行名录里有本行这一格，别的格都有行标，
 * 只有它退回「品牌色块 + 首字」会很突兀。所以把 `CatMark` 的几何落成一个静态资产。
 *
 * 为什么由一个脚本生成、而不是手写一份 SVG
 * ----------------------------------------
 * 手写就等于把同一只猫的坐标抄两遍：以后改了 `CatMark`，界面是新标、银行列表里还是旧标，
 * 而且没人会注意到。所以坐标只在 `app/src/components/brand/cat-mark.ts` 存一份，
 * 这个脚本把它渲染成静态文件。
 *
 *   node --import ./tools/ts-resolve-hook.mjs tools/gen-luckycat-logo.mjs          # 写文件
 *   node --import ./tools/ts-resolve-hook.mjs tools/gen-luckycat-logo.mjs --check  # 只校验是否过期
 */
import { writeFileSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import { CAT_MARK, CAT_MARK_VIEW_BOX, CAT_MARK_GOLD } from '../app/src/components/brand/cat-mark.ts'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const OUT = join(ROOT, 'app/public/banks/cn-LCB.svg')

/**
 * 眼睛和鼻子用**透明挖空**而不是填白。
 * 组件里的默认挖空色是卡片底色（`--color-surface`），在银行列表那个白底方块上
 * 透明与填白看着一样；但透明在任何底色下都保持「负空间猫脸」的设计意图。
 */
export function buildSvg() {
  const { ears, head, whiskers, whiskerWidth, eyes, nose } = CAT_MARK
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${CAT_MARK_VIEW_BOX}">
  <title>招财猫银行</title>
  <g fill="${CAT_MARK_GOLD}">
${ears.map((d) => `    <path d="${d}"/>`).join('\n')}
    <circle cx="${head.cx}" cy="${head.cy}" r="${head.r}"/>
  </g>
  <g stroke="${CAT_MARK_GOLD}" stroke-width="${whiskerWidth}" stroke-linecap="round">
${whiskers.map((d) => `    <path d="${d}"/>`).join('\n')}
  </g>
  <g fill="#fff">
${eyes.map((e) => `    <ellipse cx="${e.cx}" cy="${e.cy}" rx="${e.rx}" ry="${e.ry}"/>`).join('\n')}
    <path d="${nose}"/>
  </g>
</svg>
`
}

const svg = buildSvg()

if (process.argv.includes('--check')) {
  let current = ''
  try {
    current = readFileSync(OUT, 'utf8')
  } catch {
    console.error(`FAIL  还没生成 ${OUT}，跑一次 node --import ./tools/ts-resolve-hook.mjs tools/gen-luckycat-logo.mjs`)
    process.exit(1)
  }
  if (current !== svg) {
    console.error('FAIL  cn-LCB.svg 与 cat-mark.ts 的几何对不上（标改过但资产没重生成）')
    console.error('      跑一次 node --import ./tools/ts-resolve-hook.mjs tools/gen-luckycat-logo.mjs 即可')
    process.exit(1)
  }
  console.log('PASS  cn-LCB.svg 与 cat-mark.ts 一致')
  process.exit(0)
}

writeFileSync(OUT, svg)
console.log(`已写入 ${OUT}（${svg.length}B）`)
