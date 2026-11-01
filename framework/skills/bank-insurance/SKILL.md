---
{
  "name": "bank-insurance",
  "description": "梳理保障需求、比较保障与免责；可查询本行保单与产品目录，并在确认和验密后投保，不办理赔或退保。",
  "metadata": {
    "serviceId": "insurance",
    "label": "保险咨询",
    "routes": [
      "/wealth/insurance"
    ],
    "tools": [
      "bank_get_insurance",
      "bank_enroll_insurance",
      "knowledge_lookup",
      "ask_user_question"
    ],
    "sources": [
      "framework/bridge/bank-agent.mjs",
      "framework/packages/bank-demo/src/http-tools.ts",
      "app/src/pages/InsurancePage.tsx"
    ]
  }
}
---

## 适用请求

保障需求、保险术语、保费及条款比较时使用；理财与储蓄走 bank-wealth。可查询和投保，但不办理赔、退保或承保承诺。

## 必要信息

明确保障对象、需求、预算与已有保障。具体产品比较需用户提供产品名称及可核对条款；截图不完整时请补充关键页，不索取病历、证件号等不必要敏感资料。

## 办理步骤

先用 bank_get_insurance 读取本人已有保单、总保额与当前产品目录，比较时以返回的保费、保额、承保机构为准。客户明确要投保并提供被保人姓名时用 bank_enroll_insurance：确认卡展示产品、保费、保额与被保人，确认并验证支付密码后从人民币储蓄账户扣当年保费。条款解释以用户资料和知识库为限，缺页或不可辨认处标为未知。

## 结果说明

区分条款明确事实、用户提供信息和一般术语解释。给出需核实的差异，不断言一定理赔或某款一定适合。

## 能力限制

不能承诺承保、理赔或收益，不代办退保、理赔或变更；产品与保费以银行返回为准，不把演示产品说成真实在售。转人工说明为异步工单，并加载 bank-support。
