import { defineTool } from '@deepseek-ai/dsh-tools'
import { STAFF_TOOLS } from './definitions.mjs'
export const name = 'luckycat-staff-tools'
export const inject = ['tools', 'consent']
export function apply(ctx) {
  const url = process.env.LUCKYCAT_BANK_TOOL_URL
  const token = process.env.LUCKYCAT_INTERNAL_TOKEN
  if (!url || !token || process.env.LUCKYCAT_AUDIENCE !== 'staff') throw Error('员工工具缺少独立可信通道')
  for (const tool of STAFF_TOOLS.filter(t => process.env.LUCKYCAT_STAFF_MODE === 'ops' ? t.roles.includes('ops') : t.roles.some(role=>['csr','supervisor'].includes(role)))) {
    ctx.consent.declare({ toolName: tool.name, kind: tool.kind, bindArguments: true,
      describe: () => [{ label: '操作信息', value: '由员工业务后端核对并展示。' }],
      consequence: tool.write ? '员工确认后提交；执行结果以后台回执为准。' : '查询资料将显示在助手对话中。' })
    ctx.tools.register(defineTool({ name: tool.name, description: tool.description, parameters: tool.parameters,
      output: { schema: { type: 'json' }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
      async execute(args, exec) {
        const sessionId = String(exec.agent?.session.id ?? '')
        if (!sessionId) throw Error('员工工具没有绑定会话')
        const response = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', 'x-luckycat-internal': token },
          body: JSON.stringify({ sessionId, callId: String(exec.callId), toolName: tool.name, arguments: args }), signal: AbortSignal.timeout(20_000) })
        const data = await response.json()
        if (!response.ok) throw Error(data.error ?? data.message ?? '员工业务执行失败')
        return data
      } }))
  }
}
