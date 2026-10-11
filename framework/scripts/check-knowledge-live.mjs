/** 真实模型知识问答抽查；仅驱动 knowledge_lookup，不使用客户账户或银行写操作。 */
import assert from 'node:assert/strict'
import { DeepSeekHarness } from '@deepseek-ai/dsh-sdk-client'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
const root = fileURLToPath(new URL('../', import.meta.url))
process.env.DSH_HOME = resolve(root, '.dsh-home')
const checks = [
  { name: '转账费用', question: '境内和跨境银行转账收费规则是什么？50元是最高费用吗？请只说明通用规则，不办理转账。', patterns: [/免|免费|不收/, /千分之一|0\.1[%％]/, /最低|起收/, /不是.*上限|不是.*最高|不封顶|未设置|没有.*上限|没有.*封顶/], source: 'kb-transfers#fees' },
  { name: '丢卡处理', question: '银行卡丢了，我应该在哪个网页入口锁卡？助手现在能直接替我锁卡吗？请说明步骤和能力，不代办。', patterns: [/账户/, /银行卡/, /锁卡/, /助手[\s\S]*(?:可以|可|支持|能)[\s\S]*锁卡|(?:可以|可|支持|能)[\s\S]*助手[\s\S]*锁卡/], source: 'kb-cards#lost' },
  { name: '理财开户', question: '储蓄开户时已经填过姓名身份证，理财开户还要重新填吗？需要哪些验证，助手能代开吗？请说明流程，不办理。', patterns: [/不用|不需要|无需/, /短信/, /人脸/, /测评|评估/, /协议/, /不能|不支持|无法/], source: 'kb-wealth#opening' },
  { name: '助手能力边界', question: '按照知识库，网页客户端助手能直接关闭自动扣款、做FPS转账和导出账单吗？请分别说明哪些能办理、哪些不能及网页路径，本次不代办。', patterns: [/不能|不支持|无法|暂不/, /自动扣款/, /FPS/i, /账单/], source: ['kb-analysis#autodebits', 'kb-assistant#capabilities'] },
]
// 单独运行 Harness 时没有银行桥接可信通道，显式关闭银行工具也确保抽查不会办理业务。
const temporary = await mkdtemp(resolve(tmpdir(), 'luckycat-knowledge-live-'))
const patch = resolve(temporary, 'knowledge-only.yml')
await writeFile(patch, '- id: luckycat-bank-demo\n  disabled: true\n')
try {
for (const check of checks) {
  const harness = new DeepSeekHarness({ dshBin: resolve(root, 'node_modules/.bin/dsh'), profile: 'luckycat', provider: process.env.LUCKYCAT_PROVIDER ?? 'openrouter', model: process.env.LUCKYCAT_MODEL ?? 'qwen/qwen3.8-flash', initializeTimeoutMs: 30000, patches: [patch] })
  try {
    const result = await harness.run(check.question)
    const text = result.finalResponse
    assert(text.trim(), `${check.name}: 回复为空`)
    assert(Array.from(text).length <= 450, `${check.name}: 回复过长，未遵守简洁要求\n${text}`)
    if (check.name === '助手能力边界') {
      assert(!/(?:三件|三项|这些|以上)[^。\n]{0,16}(?:都|均)[^。\n]{0,10}(?:不能|不支持|无法)/.test(text), '不能将部分不支持概括为全部不能办理')
      assert(/(?:自动扣款|代扣)[^。\n]*(?:能|可以|支持)|(?:能|可以|支持)[^。\n]*(?:自动扣款|代扣)/.test(text), '必须说明已有自动扣款可以办理')
      assert(/(?:FPS)[^。\n]*(?:能|可以|支持)|(?:能|可以|支持)[^。\n]*(?:FPS)/i.test(text), '必须说明 FPS 可以办理')
      assert(!/(?:不能|不支持|无法)(?:直接|办理|进行|做|代办|支持|和|或|、|\s)*FPS|FPS(?:转账)?(?:当前|目前|现在|暂时|暂|还|尚|仍|也|助手|直接|[，：:\s])*(?:不能|不支持|无法)/i.test(text), '不得把 FPS 说成未支持')
    }
    if (check.name === '丢卡处理') assert(!/(?:点击|选择|进行)[^。\n]{0,20}锁卡[^。\n]*(?:验证支付密码后|需要验证支付密码)/.test(text), '锁卡不得补写支付密码验证步骤')
    for (const pattern of check.patterns) assert(pattern.test(text), `${check.name}: 缺少 ${pattern}\n${text}`)
    assert(!/kb-[a-z]|corpus\.json|\/srv\/|关键词覆盖|matchedBy/.test(text), `${check.name}: 泄露内部检索元数据`)
    const logs = JSON.stringify(result.events)
    assert(logs.includes('knowledge_lookup'), `${check.name}: 未调用知识检索`)
    assert([check.source].flat().some(source => logs.includes(source)), `${check.name}: 未检索预期章节 ${check.source}`)
    console.log(JSON.stringify({ check: check.name, passed: true, session: result.sessionId, answer: text }))
  } finally { await harness.close() }
}

} finally { await rm(temporary, { recursive: true, force: true }) }
