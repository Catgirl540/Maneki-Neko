---
{
  "name": "bank-insurance",
  "description": "梳理保障需求、阅读用户提供的保险条款并比较保障与免责；无依据不推荐具体产品，不投保或理赔。",
  "metadata": {
    "serviceId": "insurance",
    "label": "保险咨询",
    "routes": [
      "/wealth/insurance"
    ],
    "tools": [
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

保障需求、保险术语、保费及条款比较时使用；不是实际投保或理赔办理。

## 必要信息

明确保障对象、需求、预算与已有保障。具体产品比较需用户提供产品名称及可核对条款；截图不完整时请补充关键页，不索取病历、证件号等不必要敏感资料。

## 办理步骤

根据提供的条款逐项查看保障责任、保额、保费与缴费期限、等待期、免赔额、免责和续保条件。缺页或不可辨认处标为未知；当前知识库不含保险专门规则，检索未命中时不得补编银行产品条款。

## 结果说明

区分条款明确事实、用户提供信息和一般术语解释。给出需核实的差异，不断言一定理赔或某款一定适合。

## 能力限制

没有保险查询、投保或理赔工具，不能推荐未查证产品或承诺保费与保障；页面资料引导「理财与储蓄 → 保险」。转人工说明为异步工单，并加载 bank-support。
