/**
 * 助手回复的 Markdown / 公式渲染。
 *
 * 为什么要它：模型天然会输出 Markdown（表格、粗体、列表），原样显示就是一堆
 * `**` 和 `|---|`，客户读到的是源码而不是答案。
 *
 * **安全上的三个刻意选择**（这里的输入是模型产出，不能当可信内容）：
 *   1. 不挂 `rehype-raw`：原始 HTML 会被**转义成文本**，不会被注入 DOM；
 *   2. 图片**不渲染**：Markdown 图片会把 URL 变成自动请求，那是"把对话内容编码进
 *      请求地址外带"的经典通道（也可当追踪像素）。这里退化成一行文字提示；
 *   3. 链接只认 http/https/mailto，其它协议（`javascript:`、`data:`）原样显示成文字。
 *
 * KaTeX 的 CSS 在 `main.tsx` 里引入（不写在本文件，这样 Node 侧的检查脚本
 * 可以直接 import 本组件来断言渲染结果，见 tools/check-markdown.mjs）。
 *
 * @module app/components/agent/Markdown
 */

import ReactMarkdown, { type Components } from 'react-markdown'
import remarkBreaks from 'remark-breaks'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'

/** 允许成链接的协议白名单。 */
const SAFE_PROTOCOLS = new Set(['http:', 'https:', 'mailto:'])

/** 行内与块级公式的渲染配置。 */
export const KATEX_OPTIONS = {
  // 公式写错时不要把整条回复炸掉，而是把那一段标红显示（对用户更友好，也更好排查）。
  throwOnError: false,
  errorColor: '#C0392B',
  // 不允许 `\href` / `\includegraphics` 这类能发起外部请求的命令。
  trust: false,
} as const

/** 插件顺序：先 GFM（表格/删除线/任务列表），再数学，再换行。 */
export const REMARK_PLUGINS = [remarkGfm, remarkMath, remarkBreaks]

/** 把 `$…$` / `$$…$$` 编译成 KaTeX 的 HTML。 */
export const REHYPE_PLUGINS = [[rehypeKatex, KATEX_OPTIONS] as const]

/**
 * 自定义元素：只做安全与样式收口，不改变 Markdown 语义。
 *
 * 每个都**必须**把 react-markdown 传进来的 `node` 摘掉再展开 `...rest`：
 * 那是它内部的 hast 节点对象，不是合法 DOM 属性，透传会渲成
 * `node="[object Object]"` 出现在页面上（实测踩到，还骗过一次表格断言）。
 */
const COMPONENTS: Components = {
  a({ node: _node, href, children, ...rest }) {
    let safe = typeof href === 'string' && href.trim() !== ''
    if (safe) {
      try {
        const protocol = new URL(href!, 'https://placeholder.invalid').protocol
        // 相对链接（站内路径）没有协议头，也放行。
        safe = SAFE_PROTOCOLS.has(protocol) || !/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(href!)
      } catch {
        safe = false
      }
    }
    // 不安全或空地址都退化成纯文本：react-markdown 已经把 `javascript:` 之类
    // 抹成空串了，这里再兜一道，免得渲染出一个点了会刷新页面的空链接。
    if (!safe) return <span {...rest}>{children}</span>
    return (
      <a {...rest} href={href} target="_blank" rel="noopener noreferrer" className="text-blue underline underline-offset-2">
        {children}
      </a>
    )
  },
  img({ node: _node, alt }) {
    // 不加载远程图片（见文件头的第 2 条）。保留文字，免得信息直接消失。
    return (
      <span className="text-ink-mute">
        {alt ? `[图片：${alt}]` : '[图片已省略]'}
      </span>
    )
  },
  table({ node: _node, children, ...rest }) {
    // 宽表格在聊天气泡里会撑破布局，套一层横向滚动。
    return (
      <div className="my-2 overflow-x-auto">
        <table {...rest}>{children}</table>
      </div>
    )
  },
}

export function Markdown({ text, className }: { text: string; className?: string }) {
  return (
    <div
      className={[
        'text-[14px] leading-relaxed break-words',
        // 段落 / 标题
        '[&_p]:my-2 [&_p:first-child]:mt-0 [&_p:last-child]:mb-0',
        '[&_h1]:mt-3 [&_h1]:mb-2 [&_h1]:text-[17px] [&_h1]:font-semibold',
        '[&_h2]:mt-3 [&_h2]:mb-2 [&_h2]:text-[16px] [&_h2]:font-semibold',
        '[&_h3]:mt-3 [&_h3]:mb-1.5 [&_h3]:text-[15px] [&_h3]:font-semibold',
        '[&_h4]:mt-2 [&_h4]:mb-1 [&_h4]:text-[14px] [&_h4]:font-semibold',
        // 强调
        '[&_strong]:font-semibold [&_em]:italic [&_del]:text-ink-mute [&_del]:line-through',
        // 列表
        '[&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-5',
        '[&_li]:my-0.5 [&_li>p]:my-0',
        // 引用与分隔线
        '[&_blockquote]:my-2 [&_blockquote]:border-l-2 [&_blockquote]:border-line-strong [&_blockquote]:pl-3 [&_blockquote]:text-ink-soft',
        '[&_hr]:my-3 [&_hr]:border-line',
        // 代码
        '[&_code]:rounded-[4px] [&_code]:bg-sunk [&_code]:px-1 [&_code]:py-0.5 [&_code]:text-[13px]',
        '[&_pre]:my-2 [&_pre]:overflow-x-auto [&_pre]:rounded-field [&_pre]:bg-sunk [&_pre]:p-3',
        '[&_pre_code]:bg-transparent [&_pre_code]:p-0',
        // 表格：发丝边，与卡片同一套语言
        '[&_table]:w-full [&_table]:border-collapse [&_table]:text-[13px]',
        '[&_th]:border [&_th]:border-line [&_th]:bg-sunk [&_th]:px-3 [&_th]:py-1.5 [&_th]:text-left [&_th]:font-medium',
        '[&_td]:border [&_td]:border-line [&_td]:px-3 [&_td]:py-1.5 [&_td]:align-top',
        // 公式块居中，行内公式跟文字走
        '[&_.katex-display]:my-2 [&_.katex-display]:overflow-x-auto [&_.katex-display]:overflow-y-hidden',
        className ?? '',
      ].join(' ')}
    >
      <ReactMarkdown
        remarkPlugins={REMARK_PLUGINS as never}
        rehypePlugins={REHYPE_PLUGINS as never}
        components={COMPONENTS}
      >
        {text}
      </ReactMarkdown>
    </div>
  )
}
