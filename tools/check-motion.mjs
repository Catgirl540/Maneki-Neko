/**
 * 动效的"不许悄悄坏掉"检查。
 *
 * 为什么需要它：动画坏了**不会报错**。CSS 里 `animation-name` 拼错一个字母，
 * 元素就是静静地不动——测试全绿、构建通过、console 干净，只有人觉得"怎么有点生硬"。
 * 这类问题靠肉眼基本抓不住，所以只能靠机器核对名字。
 *
 * 查三件事：
 *   ① 每个用到的动画名，都有对应的 `@keyframes`（拼错就报）
 *   ② 每个写下的 `@keyframes` 都真被用到（没用到的是死代码，留着会误导人）
 *   ③ 关键帧只动 transform / opacity —— 动 width / top / height 会让浏览器
 *      每帧重排，转场一卡一卡
 *
 * 外加两条运动规范的守卫（见每条断言自己的说明）：
 *   ④ `prefers-reduced-motion` 那一块必须还在，而且时长**和延迟**都要清掉
 *   ⑤ 过渡**布局属性**的地方必须逐条登记（数据可视化那几处是刻意的，
 *      但"顺手 transition 一下 width"不该是默认写法）
 *
 * 查不出来的：动效好不好看、快慢合不合适。那只能靠看。
 *
 *   node tools/check-motion.mjs
 */

import { readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '../app/src')
const STYLES = path.join(ROOT, 'styles/chat.css')

let failures = 0
const report = (ok, title, lines = []) => {
  if (!ok) failures += 1
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${title}`)
  for (const line of lines) console.log(`      ${line}`)
}

/* --------------------------------------------------------------- 收集源文件 */

/** 递归收集 src 下的 .css 与 .tsx/.ts。 */
function collect(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry)
    if (statSync(full).isDirectory()) collect(full, out)
    else if (/\.(css|tsx|ts)$/.test(entry)) out.push(full)
  }
  return out
}

const files = collect(ROOT)
const rel = (file) => path.relative(path.resolve(ROOT, '..'), file)

/**
 * 把注释整片替换成空格，**保持行号不变**。
 * 扫描时用的是这份；注释里出现 `transition-[width]` 这种字样不该被当成真代码
 * （实测踩到：SupportPage 的一句说明就把它自己报了出来）。
 */
function stripComments(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, block => block.replace(/[^\n]/g, ' '))
    .replace(/(^|\s)\/\/[^\n]*/g, comment => comment.replace(/[^\n]/g, ' '))
}

// 逐行读，断言报错时能指出是哪一行——"某个文件里有个错名字"没法查。
const raw = new Map(files.map(file => [file, readFileSync(file, 'utf8')]))
const lines = new Map([...raw].map(([file, text]) => [file, stripComments(text).split('\n')]))

/* ------------------------------------------- ① 定义了什么、用到了什么 */

const defined = new Map()
const keyframeRe = /@keyframes\s+([\w-]+)\s*\{/
for (const [file, source] of lines) {
  source.forEach((line, index) => {
    const match = line.match(keyframeRe)
    if (match !== null) defined.set(match[1], `${rel(file)}:${index + 1}`)
  })
}

/** 把 `animation:` 简写里的动画名挑出来（名字是那个既不是时间也不是关键字的词）。 */
function namesInAnimationValue(value) {
  const TIME = /^[\d.]+m?s$/
  const COUNT = /^\d+$/ // 迭代次数（如 `ring-pulse … 2`），不是动画名
  const KEYWORD = /^(normal|reverse|alternate|alternate-reverse|none|forwards|backwards|both|infinite|running|paused|linear|ease|ease-in|ease-out|ease-in-out|step-start|step-end|steps?\(.*\)|cubic-bezier\(.*\))$/
  return value
    .split(',')
    .map(part => part.trim().split(/\s+/).filter(token => token !== ''))
    .flat()
    .filter(token => !TIME.test(token) && !COUNT.test(token) && !KEYWORD.test(token) && !token.startsWith('var('))
}

const referenced = new Map()
for (const [file, source] of lines) {
  source.forEach((line, index) => {
    const where = `${rel(file)}:${index + 1}`
    const shorthand = line.match(/(?:^|[\s;])animation:\s*([^;]+)/)
    if (shorthand !== null) {
      for (const name of namesInAnimationValue(shorthand[1])) {
        if (!name.startsWith('--')) referenced.set(name, where)
      }
    }
    const longhand = line.match(/animation-name:\s*([^;]+)/)
    if (longhand !== null) {
      for (const name of namesInAnimationValue(longhand[1])) referenced.set(name, where)
    }
    // 行内样式也能挂动画名（`style={{ animationName: 'x' }}`），一并认。
    const inline = line.match(/animationName:\s*['"]([\w-]+)['"]/g) ?? []
    for (const hit of inline) referenced.set(hit.replace(/.*['"]([\w-]+)['"].*/, '$1'), where)
  })
}

report(defined.size >= 8, '确实读到了关键帧定义（这份检查没有空转）',
  [`${defined.size} 个：${[...defined.keys()].join(' ')}`])
report(referenced.size >= 8, '确实读到了动画的引用',
  [`${referenced.size} 处`])

/* ------------------------------------------------ ② 名字对得上、没有死代码 */

const unknown = [...referenced].filter(([name]) => !defined.has(name))
report(unknown.length === 0, '用到的动画名都有对应的 @keyframes（拼错不会报错，所以这里必须查）',
  unknown.map(([name, where]) => `${where} 用了 \`${name}\`，但没有任何 @keyframes 定义它`))

const unused = [...defined].filter(([name]) => !referenced.has(name))
report(unused.length === 0, '写下的 @keyframes 都真被用到（死代码会误导后来的人）',
  unused.map(([name, where]) => `${where} 定义了 \`${name}\`，但没人用`))

/* ------------------------------------- ③ 关键帧只动 transform / opacity */

/** 允许出现在关键帧里的属性。加进来之前先想清楚：它会重排还是重绘？ */
const COMPOSITOR_SAFE = new Set(['transform', 'opacity', 'filter'])

const badProps = []
for (const [, where] of defined) {
  const [file, lineText] = where.split(':')
  const source = lines.get(path.resolve(ROOT, '..', file)) ?? []
  // 从 @keyframes 那一行往后扫到块结束：靠"缩进回到同级"判断。
  const start = Number(lineText) - 1
  const indent = (source[start].match(/^\s*/) ?? [''])[0]
  for (let i = start + 1; i < source.length; i += 1) {
    const line = source[i]
    if (line.trim() === '') continue
    if (/^\s*\}/.test(line) && (line.match(/^\s*/) ?? [''])[0].length <= indent.length) break
    // 关键帧体里只有两种行：`from/to/50% {` 选择器行，和 `prop: value;` 声明行。
    if (/^\s*(from|to|[\d.]+%)\s*(\s*,\s*(from|to|[\d.]+%)\s*)*\{/.test(line)) continue
    const decl = line.match(/^\s*([a-z-]+)\s*:/)
    if (decl === null) continue
    if (!COMPOSITOR_SAFE.has(decl[1])) badProps.push(`${where} 的 \`${decl[1]}\``)
  }
}
report(badProps.length === 0,
  '关键帧只动 transform / opacity（动布局属性会每帧重排）',
  badProps.map(entry => `${entry} —— 不是合成层属性`))

/* -------------------------------- ④ 减少动态效果的兜底必须完整 */

const globalCss = readFileSync(STYLES, 'utf8')
const reducedBlock = globalCss.match(/@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{([\s\S]*?)\n\}/)
report(reducedBlock !== null, '有 prefers-reduced-motion 的兜底块')
if (reducedBlock !== null) {
  const body = reducedBlock[1]
  report(/animation-duration:\s*0\.01ms\s*!important/.test(body),
    '兜底块把 animation-duration 压到 0（且带 !important）')
  report(/transition-duration:\s*0\.01ms\s*!important/.test(body),
    '兜底块把 transition-duration 压到 0（且带 !important）')
  // 只清时长不清延迟的话，带 animationDelay 的元素会先空一块再突然出现——
  // 那恰恰是开了"减少动态效果"的人最不想看到的。各页面确实写了 60~180ms 的延迟。
  report(/animation-delay:\s*0ms\s*!important/.test(body),
    '兜底块把 animation-delay 也清了（只清时长的话元素会先空一块）')
  report(/transition-delay:\s*0ms\s*!important/.test(body),
    '兜底块把 transition-delay 也清了')
  // 必须在任何 @layer 之外：`@layer` 里的样式优先级低于无层样式，
  // 但反过来（这段被塞进某个 layer）就会输给 Tailwind 的 utility。
  //
  // 用大括号配平判断它到底在不在某个 @layer 里面，而且**要从 at-rule 的位置找**：
  // 拿 `indexOf('prefers-reduced-motion')` 会命中文件前面那句说明文字的注释，
  // 于是永远算出"不在任何层里"（实测踩到——文件头刚好有一句注释提到它）。
  const reducedAt = globalCss.search(/@media\s*\(prefers-reduced-motion:\s*reduce\)/)
  report(reducedAt >= 0 && !blockNestingAt(globalCss, reducedAt).some(head => head.startsWith('@layer')),
    '兜底块没有被裹进 @layer（裹进去就会输给 Tailwind 的 utility）')
}

/**
 * 找出某个位置被哪些 at-rule 块包着。
 * @param text - 整份 CSS。
 * @param at - 目标位置在 `text` 里的下标。
 * @returns 从外到内的块头列表。
 */
function blockNestingAt(text, at) {
  const stack = []
  let depth = 0
  for (let i = 0; i < at; i += 1) {
    const char = text[i]
    if (char === '{') {
      // 往回找这个 `{` 所属的块头：同一行里 `{` 之前的内容。
      const head = text.slice(text.lastIndexOf('\n', i - 1) + 1, i).trim()
      stack.push({ depth, head })
      depth += 1
    } else if (char === '}') {
      depth = Math.max(0, depth - 1)
      while (stack.length > 0 && stack[stack.length - 1].depth >= depth) stack.pop()
    }
  }
  return stack.map(entry => entry.head).filter(head => head !== '')
}

/* --------------------------- ⑤ 过渡布局属性必须逐条登记 */

/**
 * 允许过渡布局属性的地方，每条都要写清理由。
 *
 * 键是 **`文件|属性表`**，不是光一个文件名——按文件豁免的话，往那个文件里
 * 再随手加一处 `transition-[width]` 也会被一起放过，白名单就变成了摆设
 * （实测踩到）。属性表按字母序写。
 */
const LAYOUT_TRANSITIONS_ALLOWED = new Map([
  ['src/components/layout/Sidebar.tsx|padding,width', '侧栏收起/展开，面板宽度本来就是这件事本身'],
  ['src/components/agent/ChatWorkspace.tsx|width', '历史对话抽屉展开，同上'],
  ['src/pages/CreditPage.tsx|width', '信用额度使用比例，条宽就是数据'],
  ['src/pages/SavingsPage.tsx|width', '存钱目标完成比例，条宽就是数据'],
  ['src/pages/SecurityPage.tsx|width', '密码强度条，宽度就是数据'],
  ['src/components/wealth/RiskAssessmentModal.tsx|width', '风险测评进度条，宽度就是数据'],
  ['src/components/charts/TrendBars.tsx|background-color,height', '柱状图高度就是数据'],
  ['src/components/charts/CashFlowChart.tsx|top', '折线图落点位置就是数据'],
  ['src/styles/chat.css|height,opacity,transform',
    '会话列表当前项的滑块：高度与位置都从测量来；absolute 定位，不影响别的行'],
])

const LAYOUT_PROPS = new Set(['width', 'height', 'top', 'left', 'right', 'bottom', 'padding', 'margin'])

/** 从 `transition:` 简写里挑出**属性名**（略过时长、缓动、延迟）。 */
function propertiesInTransitionValue(value) {
  const TIME = /^[\d.]+m?s$/
  const KEYWORD = /^(none|all|linear|ease|ease-in|ease-out|ease-in-out|step-start|step-end|steps?\(.*\)|cubic-bezier\(.*\)|allow-discrete|normal)$/
  return value
    .split(',')
    .map(part => part.trim().split(/\s+/).filter(token => token !== ''))
    .flat()
    .filter(token => !TIME.test(token) && !KEYWORD.test(token) && !token.startsWith('var('))
}

/**
 * 一处过渡：Tailwind 的 `transition-[…]`，或 CSS 里的 `transition:` / `transition-property:`。
 *
 * **必须按整份文件扫，不能逐行扫**：CSS 里的简写经常折行写
 * （`transition:\n  transform …,\n  height …;`），逐行扫时 `transition:` 那一行
 * 后面什么都没有，整条声明会被静默跳过——白名单里于是出现"永远不命中"的条目
 * （实测踩到，正是给滑块加高度过渡的时候）。
 */
const TRANSITION_ANY = /transition-\[([^\]]+)\]|(?:^|[\s;{])transition:\s*([^;}]+)|transition-property:\s*([^;}]+)/g

const layoutHits = []
const usedAllowKeys = new Set()
for (const [file, source] of lines) {
  const relative = rel(file).replace(/^app\//, '')
  const text = source.join('\n')
  for (const match of text.matchAll(TRANSITION_ANY)) {
    const props = match[1] !== undefined
      ? match[1].split(',').map(part => part.trim())
      : propertiesInTransitionValue(match[2] ?? match[3] ?? '')
    const layout = props.filter(prop => LAYOUT_PROPS.has(prop))
    if (layout.length === 0) continue
    const at = text.slice(0, match.index).split('\n').length
    const key = `${relative}|${[...props].sort().join(',')}`
    if (LAYOUT_TRANSITIONS_ALLOWED.has(key)) {
      usedAllowKeys.add(key)
      continue
    }
    layoutHits.push(`${relative}:${at} 过渡了 ${layout.join('/')} —— 布局属性每帧重排；`
      + `真需要就在 LAYOUT_TRANSITIONS_ALLOWED 里加一条 \`${key}\` 并写明理由`)
  }
}
report(layoutHits.length === 0, '过渡布局属性的地方都逐条登记过（防止"顺手 transition 一下 width"）',
  layoutHits)

// 登记表本身也要有人管：文件删了、属性改了之后，白名单里会留下永不命中的条目，
// 看起来"管着这一处"，其实早就没管了。
const staleAllow = [...LAYOUT_TRANSITIONS_ALLOWED.keys()].filter(key => !usedAllowKeys.has(key))
report(staleAllow.length === 0, '登记表里没有已经失效的条目',
  staleAllow.map(key => `${key} —— 现在没有任何地方命中它`))

/* -------------------------------------------------------------------- 汇总 */

console.log()
console.log(failures === 0 ? 'check-motion: 全部通过' : `check-motion: ${failures} 项未通过`)
process.exit(failures === 0 ? 0 : 1)
