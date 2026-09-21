/**
 * 把助手回复的 Markdown 变成"**能念出来**的话"。
 *
 * 助手回复是按 Markdown 写的，直接丢给语音合成会念出 `**`、`|---|`、`](https://…)`
 * 这些东西——对听的人来说是纯噪音，而且一句话里夹一堆符号会让整段都听不懂。
 * （这和界面上的渲染是两件事：Markdown 组件负责**看**，这里负责**听**。）
 *
 * 处理的取舍：
 *   · 代码块、图片 —— **整段丢掉**。念代码没有意义，念图片地址更是。
 *   · 链接 —— 只留文字，**丢掉地址**。把一条 URL 逐字符念出来对谁都没用。
 *   · 表格 —— 每一行拼成「表头，值。」。确认卡片那种两列表格，
 *     念出来正好是"收款人，梁乐怡。转账金额，800.00 元。"
 *   · 公式 —— 去掉 `$` 定界符，内容留着（念 LaTeX 不理想，但比丢掉信息好）。
 *
 * 这个模块是**纯函数**，不碰浏览器 API，所以能直接拿 node 跑测试。
 *
 * @module app/lib/speech
 */

/** 默认最多念多少字（和服务端的上限保持一致）。 */
export const SPEECH_MAX_CHARS = 600

/** 表格的分隔行，例如 `| --- | :---: |`。 */
const TABLE_SEPARATOR = /^\s*\|?[\s:|-]+\|[\s:|-]*$/

/**
 * 把一段 Markdown 变成适合朗读的纯文本。
 * @param markdown - 助手回复原文。
 * @param maxChars - 最多保留多少字；超出会在句子边界断开。
 * @returns 朗读用文本；没有可念的内容时返回空串。
 */
export function speechText(markdown: string, maxChars: number = SPEECH_MAX_CHARS): string {
  let text = markdown

  // 代码块整段丢掉（含围栏本身）。先做这一步：里面的 `#`、`*` 之类的
  // 不该被后面的规则碰到。
  text = text.replace(/```[\s\S]*?```/g, ' ')
  text = text.replace(/~~~[\s\S]*?~~~/g, ' ')

  // 图片整段丢掉，链接只留文字。
  text = text.replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
  text = text.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')

  // 表格：分隔行丢掉，数据行拼成「单元格，单元格。」
  text = text
    .split('\n')
    .map((line) => {
      if (!line.trim().startsWith('|')) return line
      if (TABLE_SEPARATOR.test(line)) return ''
      const cells = line.split('|').map(cell => cell.trim()).filter(cell => cell !== '')
      return cells.length === 0 ? '' : `${cells.join('，')}。`
    })
    .join('\n')

  // 行首的标记：标题、引用、列表项、有序列表
  text = text.replace(/^\s{0,3}#{1,6}\s+/gm, '')
  text = text.replace(/^\s{0,3}>\s?/gm, '')
  text = text.replace(/^\s{0,3}[-*+]\s+/gm, '')
  text = text.replace(/^\s{0,3}\d+[.)]\s+/gm, '')

  // 分隔线
  text = text.replace(/^\s{0,3}([-*_])\s*(\1\s*){2,}$/gm, '')

  // 行内样式：粗体 / 斜体 / 删除线 / 行内代码 / 公式定界符
  text = text.replace(/(\*\*|__)(.*?)\1/g, '$2')
  text = text.replace(/(\*|_)(.*?)\1/g, '$2')
  text = text.replace(/~~(.*?)~~/g, '$1')
  text = text.replace(/`([^`]*)`/g, '$1')
  text = text.replace(/\$+([^$]*)\$+/g, '$1')

  // HTML 标签（回复里偶尔夹 <br> 之类）与剩余的反斜杠转义
  text = text.replace(/<[^>]+>/g, ' ')
  text = text.replace(/\\([\\`*_{}[\]()#+\-.!])/g, '$1')

  // 逐行接起来。中文不能拿空格当标点——语音合成靠标点决定在哪停。
  // 直接把换行抹掉的话，列表项会连成「手续费 0.00到账时间：实时」这样一口气的长句；
  // 而一律补句号又会在 Markdown 硬折行的地方凭空断句。所以：换行两侧都不是标点时
  // 补一个**逗号**——它只表示停顿，不断言一句话结束。
  const lines = text.split('\n').map(line => line.trim()).filter(line => line !== '')
  let joined = ''
  for (const line of lines) {
    if (joined === '') {
      joined = line
      continue
    }
    const previous = joined[joined.length - 1] ?? ''
    joined += '。！？；：，、!?;:,.'.includes(previous) ? line : `，${line}`
  }

  text = joined.replace(/[ \t]+/g, ' ').trim()

  return truncateAtSentence(text, maxChars)
}

/**
 * 截断到上限，尽量断在句子边界上。
 * @param text - 已清洗的文本。
 * @param maxChars - 上限。
 * @returns 截断后的文本。
 */
function truncateAtSentence(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text
  const head = text.slice(0, maxChars)
  // 从后往前找最近的句末标点，避免把一句话念一半。
  // 找不到就用硬截断——总比不念强。
  const lastStop = Math.max(
    head.lastIndexOf('。'),
    head.lastIndexOf('！'),
    head.lastIndexOf('？'),
    head.lastIndexOf('；'),
    head.lastIndexOf('.'),
  )
  const cut = lastStop > maxChars * 0.5 ? head.slice(0, lastStop + 1) : head
  return `${cut}……`
}
