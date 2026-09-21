/**
 * 「能念出来」这件事的检查。
 *
 * 为什么值得单独测：助手回复直接丢给语音合成会念出 `**`、`|---|`、`](https://…)`——
 * 对听的人来说是纯噪音，而且一句话里夹一堆符号会让整段都听不懂。
 * 但**去掉什么、留下什么**是有一堆取舍的（代码块丢掉、链接留文字、表格拼成人话），
 * 靠肉眼看一遍截图看不出来。
 *
 *   node --import ./tools/ts-resolve-hook.mjs tools/check-speech.mjs
 */

import { speechText, SPEECH_MAX_CHARS } from '../app/src/lib/speech.ts'
import { blobToBase64 } from '../app/src/lib/audio.ts'

let failures = 0
const report = (ok, title, lines = []) => {
  if (!ok) failures += 1
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${title}`)
  for (const line of lines) console.log(`      ${line}`)
}
const eq = (actual, expected, title) => report(
  actual === expected,
  title,
  [`实际：${JSON.stringify(actual)}`, `期望：${JSON.stringify(expected)}`],
)

/* ---------------------------------------------------------------- 基本样式 */

eq(speechText('余额是 **12,864.50 CNY**，请注意。'), '余额是 12,864.50 CNY，请注意。',
  '粗体去掉星号，文字留着')
eq(speechText('这是 *斜体* 和 _下划线斜体_。'), '这是 斜体 和 下划线斜体。', '斜体去掉标记')
eq(speechText('已经 ~~转好了~~ 取消了。'), '已经 转好了 取消了。', '删除线去掉标记')
eq(speechText('回执号是 `LCB-DEMO-0001`。'), '回执号是 LCB-DEMO-0001。', '行内代码去掉反引号、内容留着')
eq(speechText('# 标题\n正文。'), '标题，正文。', '标题去掉 #；换行处补逗号（语音靠标点停顿）')
eq(speechText('> 引用一句。'), '引用一句。', '引用去掉 >')
eq(speechText('- 转账\n- 查余额\n- 锁卡'), '转账，查余额，锁卡', '无序列表去掉项目符号，项之间补逗号')
eq(speechText('1. 第一步\n2. 第二步'), '第一步，第二步', '有序列表去掉序号，项之间补逗号')
eq(speechText('上面\n\n---\n\n下面'), '上面，下面', '分隔线整条丢掉，不留空档')

eq(speechText('已经转好了。\n回执号在这里。'), '已经转好了。回执号在这里。',
  '换行处本来就以句号结尾时不再补逗号（否则会念出两个停顿）')
eq(speechText('这是一句\n被硬折行的长句'), '这是一句，被硬折行的长句',
  '硬折行补的是逗号而不是句号（凭空断句会把一句话读成两句）')

/* --------------------------------------------------------------- 该丢的东西 */

eq(speechText('看这段：\n```js\nconst a = **1**;\n```\n就这样。'), '看这段：就这样。',
  '代码块整段丢掉（不念代码）')
eq(speechText('![截图](https://example.com/a.png) 说明。'), '说明。', '图片整段丢掉（不念地址）')
eq(speechText('见[官网](https://example.com/very/long/path)。'), '见官网。',
  '链接只留文字——把 URL 逐字符念出来对谁都没用')

/* ---------------------------------------------------------------- 表格 */

// 这是最要紧的一条：确认卡片那种两列表格，念出来应该是人话。
eq(
  speechText('| 收款人 | 梁乐怡 |\n| --- | --- |\n| 转账金额 | 800.00 CNY |'),
  '收款人，梁乐怡。转账金额，800.00 CNY。',
  '表格分隔行丢掉，数据行拼成「表头，值。」',
)
eq(
  speechText('| 项目 | 金额 |\n|:---|---:|\n| 手续费 | 0.00 |'),
  '项目，金额。手续费，0.00。',
  '带对齐冒号的分隔行也要认出来',
)

/* ---------------------------------------------------------------- 公式 */

eq(speechText('利率是 $0.30\\%$ 左右。'), '利率是 0.30\\% 左右。', '行内公式去掉 $ 定界符，内容留着')

/* ------------------------------------------------------------------ 截断 */

const long = '第一句话。第二句话。第三句话。第四句话。第五句话。'
const cut = speechText(long, 12)
report(
  cut.endsWith('……') && cut.length <= 14 && long.startsWith(cut.slice(0, -2)),
  '超长时在句子边界截断并加省略号',
  [JSON.stringify(cut)],
)
const noStop = speechText('一二三四五六七八九十甲乙丙丁', 6)
eq(noStop, '一二三四五六……', '一句话里找不到句末标点时硬截断（总比不念强）')
eq(speechText(long), long, '没超上限时一个字都不动')

/* -------------------------------------------------------- 别把该留的也弄丢 */

const mixed = speechText([
  '## 转账结果',
  '',
  '已经转好了，回执号 **LCB-DEMO-0002**。',
  '',
  '| 收款人 | 梁乐怡 |',
  '| --- | --- |',
  '| 金额 | 800.00 CNY |',
  '',
  '- 手续费 0.00',
  '- 到账时间：实时',
  '',
  '> 如有疑问请联系客服。',
].join('\n'))
report(
  mixed.includes('LCB-DEMO-0002') && mixed.includes('800.00 CNY')
    && mixed.includes('梁乐怡') && mixed.includes('如有疑问请联系客服')
    && !/[*#|>`$]/.test(mixed),
  '整段混排之后：信息一个不少，符号一个不留',
  [JSON.stringify(mixed)],
)

eq(speechText(''), '', '空回复给空串（调用方据此不合成）')
eq(speechText('   \n\n  '), '', '只有空白的回复也给空串')
report(
  speechText('#\n\n- \n\n> ').length === 0,
  '只剩标记、没有文字的回复清完是空的（不会合成出一段静音）',
  [JSON.stringify(speechText('#\n\n- \n\n> '))],
)

/* ------------------------------------------------------- 音频转 base64 */

// 接口文档要的是**裸** base64。实测上游其实容忍 `data:` 前缀（结果一样），
// 但那是没写进文档的宽容行为——依赖它的话，哪天上游收紧就是静默出错。
// 所以这里卡死"我们发出去的必须是裸的"。
const bytes = new Uint8Array([0x49, 0x44, 0x33, 0x04, 0x00]) // "ID3\x04\x00"
const b64 = await blobToBase64(new Blob([bytes]))
eq(b64, 'SUQzBAA=', '音频转 base64 是裸的（按文档写的那样，不依赖上游的宽容）')
report(!b64.includes(',') && !b64.startsWith('data:'), 'base64 里既没有逗号也没有 data: 前缀')

// 分块拼接：一段一分钟的录音有几十万字节，一次性铺开会爆栈。
const big = new Uint8Array(200_000).fill(65)
const bigB64 = await blobToBase64(new Blob([big]))
report(
  bigB64.length === Math.ceil(200_000 / 3) * 4 && !bigB64.includes('\n'),
  '20 万字节的音频也能转（分块拼接没有爆栈）',
  [`base64 长度 ${bigB64.length}`],
)

/* -------------------------------------------------------------------- 汇总 */

report(SPEECH_MAX_CHARS >= 200, '默认上限是个合理值', [`${SPEECH_MAX_CHARS} 字`])

console.log()
console.log(failures === 0 ? 'check-speech: 全部通过' : `check-speech: ${failures} 项未通过`)
process.exit(failures === 0 ? 0 : 1)
