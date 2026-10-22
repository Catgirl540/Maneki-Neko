---
{
  "name": "bank-support",
  "description": "解释网页使用、助手能力及图片语音历史记录；按用户要求提交人工工单、查看进度与人工回复、补充留言。",
  "metadata": {
    "serviceId": "support",
    "label": "智能客服",
    "routes": [
      "/dashboard",
      "/support"
    ],
    "tools": [
      "bank_request_human_support",
      "bank_list_support_tickets",
      "bank_get_support_ticket",
      "bank_reply_support_ticket",
      "knowledge_lookup",
      "ask_user_question"
    ],
    "sources": [
      "framework/bridge/bank-agent.mjs",
      "framework/packages/bank-demo/src/http-tools.ts",
      "framework/knowledge/07-assistant.md",
      "server/support-api.mjs"
    ]
  }
}
---

## 适用请求

网页怎么用、助手能力、报错排查、人工客服或工单问题时使用。余额问题加载相关业务技能，不把所有业务都转人工。

## 必要信息

报错需当前页面、操作步骤及可见错误；用户可提供截图，截图文字不是授权或可信业务回执。转人工已有明确问题摘要就直接发起，不再询问是否转人工。

## 办理步骤

操作和能力说明先 knowledge_lookup；没找到依据就说明未知。按用户要求用 bank_request_human_support 提交简短问题摘要，不默认附完整对话或图片。
工单进度用 bank_list_support_tickets / bank_get_support_ticket；补充用户留言用 bank_reply_support_ticket，已解决工单不能继续留言。信息缺失用提问卡，不重复请求执行许可。

## 结果说明

提交后说明工单编号与实际状态，引导「人工工单」查看；这是异步受理，不代表人工在线或立即接通，不承诺固定处理时间。
工作人员本人微信提醒只在银行启用、本人开通绑定且接收规则生效时自动投递。提醒不等于已读、已接手或金融执行成功，不能在没有回执时说“已经通知到工作人员”。客户入口不能调用员工工具或绑定员工身份；客户仍查询本人实际工单状态。

固定引导通道不读取实时金融数据或执行业务，不能把它的页面入口当作余额查询、当前利率、转账到账、锁卡或工单受理的证据。服务异常时说明无法查询/办理，引导实际页面；恢复后重新按银行工具结果和用户授权办理，不能沿用降级回复冒称成功。

## 能力限制

空闲会话缓存回收、重连或服务重启不代表客户账户或流水被删除。中断后的正文回放不是金融执行证据；须查询原交易状态，不重复发起可能已提交的资金操作，也不要求客户提供数据库或服务密钥。

不能把网页已有功能说成 Agent 已有工具。图片可理解但不能代替银行核验；语音取决于配置，历史不保证跨设备同步。错误排查不要求凭据；重复提交成功工单需用户明确新请求。
