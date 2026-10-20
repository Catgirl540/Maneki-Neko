---
{
  "name": "bank-insurance",
  "description": "查询保险产品与保单、协助投保；含健康告知拦截，不推荐具体产品、不承诺理赔。",
  "metadata": {
    "serviceId": "insurance",
    "label": "保险咨询",
    "routes": [
      "/wealth/insurance"
    ],
    "tools": [
      "bank_get_insurance",
      "bank_enroll_insurance",
      "bank_request_human_support",
      "knowledge_lookup",
      "ask_user_question"
    ],
    "sources": [
      "framework/bridge/bank-agent.mjs",
      "framework/packages/bank-demo/src/http-tools.ts",
      "app/src/pages/InsurancePage.tsx",
      "framework/knowledge/07-insurance.md"
    ]
  }
}
---

## 适用请求

保障需求、保险产品比较、已有保单查询及投保办理时使用。产品事实以 bank_get_insurance 返回为准；术语解释可通过知识库查询。

## 必要信息

投保需明确保险产品、被保人姓名和健康告知答案。查询保单不需额外信息。比较产品先了解保障对象、需求、预算与已有保障。

## 办理步骤

用 bank_get_insurance 查询产品列表与已有保单。投保流程：先展示产品要素并列（保额、保费、保障范围），再逐项问健康告知三个问题（住院/手术史、慢性病史、恶性肿瘤/结节史）。任一回答为「是」→ 拒绝投保并建议转人工。全部为「否」→ 进入确认卡（含免责摘要与等待期）→ 用户确认 + 支付密码 → bank_enroll_insurance。不代答健康告知，不跳过确认卡。

## 结果说明

保单生效时间、保额与保费按回执说明。免责摘要和等待期必须在确认卡中展示，不在对话中省略。不能承诺一定理赔、一定续保或某款产品一定适合用户。客观呈现要素让用户自行决定。

## 能力限制

不能推荐具体产品或承诺保费与保障；不能办理退保、理赔或续保。健康告知异常项不能在线投保，须转人工。理赔与续保不在本工具能力范围。转人工说明为异步工单，并加载 bank-support。
