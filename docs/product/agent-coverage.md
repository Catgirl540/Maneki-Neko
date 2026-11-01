# Agent 全操作覆盖规划

目标：网页能办的业务，助手都能办；能查的都能查，能改的都在确认卡和验密之后执行。本文是差距清单和分批计划，不是已完成状态的说明。2026-11-01 盘点。

## 现状

- 网页 `BankApi`：107 个方法（含登录、注册、短信等非业务方法）。
- Agent 银行工具：95 个（2026-11-01 补入换汇报价/成交、保险查询/投保、卡激活、AA 付款、11 个只读查询、预算/储蓄目标/凑整/现金管理/工资计划规则、风险测评/备用金/借款/分期、风控规则/贵宾厅/删除收款人，以及导出链接与电子回单）（`framework/packages/bank-demo/src/http-tools.ts` + `extended-http-tools.ts`），覆盖查询、转账、FPS、定时、AA、卡、账单、预算查询、理财申赎、定投、生日、提醒、工单。
- 绝大多数网页操作**接口已经存在**，缺的是 Agent 工具（schema、确认卡、验密、allowedTools、测试）。真正需要新增后端接口的主要是“文件类”返回：CSV 导出和电子回单，现有接口返回的是前端下载所需数据，不适合直接塞给模型。

## 缺口清单（接口已有，缺工具）

### 只读（建议 P1，低风险）

已完成：`bank_get_membership`、`bank_list_invitations`、`bank_get_security`、`bank_get_savings`、`bank_get_cash_management`、`bank_get_salary_plan`、`bank_get_credit`、`bank_get_receiving_info`、`bank_list_split_payments`、`bank_list_support_messages`、`bank_get_risk_questions`（2026-11-01 在 8081 实测返回）。

| 操作 | 接口 | 建议工具 |
| --- | --- | --- |
| 会员等级与权益 | `getMembership` | `bank_get_membership` |
| 邀请与奖励 | `getInvitations` | `bank_list_invitations` |
| 安全总览与规则 | `getSecurityOverview` | `bank_get_security` |
| 储蓄目标总览 | `getSavingsOverview` | `bank_get_savings` |
| 现金管理 | `getCashManagement` | `bank_get_cash_management` |
| 工资计划 | `getSalaryPlan` | `bank_get_salary_plan` |
| 信贷总览 | `getCreditOverview` | `bank_get_credit` |
| 备用金状态 | `getOverdraft` | 并入 `bank_get_credit` |
| 收款信息 | `getReceivingInfo` | `bank_get_receiving_info` |
| 电子回单 | `getReceipt` | `bank_get_receipt`（需确认返回形式） |
| AA 待付款列表 | `listSplitPaymentRequests` | `bank_list_split_payments` |
| 客服留言 | `listSupportMessages` | `bank_list_support_messages` |
| 风险测评题目 | `listRiskQuestions` | `bank_get_risk_questions` |
| 生日计划预览 | `previewBirthdayPlan` | 并入 `bank_create_birthday_plan` 的确认卡 |

### 资金写操作（建议 P2，必须验支付密码）

已完成（续）：`bank_submit_risk_assessment`、`bank_activate_overdraft`、`bank_apply_loan`、`bank_convert_installment`（2026-11-01 实测：测评提交与非法答案拒绝、备用金启用、账单分期 6 期成功创建；借款在演示客户可用额度为 0 时正确拒绝）。

已完成：`bank_exchange_quote`、`bank_exchange`、`bank_get_insurance`、`bank_enroll_insurance`、`bank_activate_card`、`bank_pay_split_request`。换汇和保险已实测报价/成交/目录/确认卡；卡激活与 AA 付款已验证参数与拒绝路径。

| 操作 | 接口 | 建议工具 |
| --- | --- | --- |
| 激活待激活卡 | `activateCard` | `bank_activate_card` |
| AA 成员付款 | `paySplitRequest` | `bank_pay_split_request` |
| 借款申请 | ✅ `applyLoan` | ✅ `bank_apply_loan` |
| 备用金支用 | ✅ `activateOverdraft` | ✅ `bank_activate_overdraft` |
| 账单转分期 | ✅ `convertToInstallment` | ✅ `bank_convert_installment` |

### 规则与设置写操作（建议 P3，确认卡，多数不需要支付密码）

已完成（续）：`bank_update_security_rule`、`bank_redeem_lounge_pass`、`bank_delete_payee`（2026-11-01 实测：规则开关生效、贵宾厅核销后剩余 2→1、收款人删除后 5→4）。

已完成：`bank_create_budget`、`bank_update_budget`、`bank_delete_budget`、`bank_redeem_budget_pass`、`bank_create_savings_goal`、`bank_update_savings_goal`、`bank_delete_savings_goal`、`bank_update_savings_roundup`、`bank_update_cash_sweep`、`bank_update_salary_plan`（2026-11-01 在 8081 实测创建/修改/删除/保存）。

| 操作 | 接口 | 建议工具 |
| --- | --- | --- |
| 预算创建/修改/删除 | ✅ `createBudget` / `updateBudget` / `deleteBudget` | ✅ `bank_create_budget` / `bank_update_budget` / `bank_delete_budget` |
| 兑换额度券 | ✅ `redeemBudgetPass` | ✅ `bank_redeem_budget_pass` |
| 储蓄目标创建/修改/删除 | ✅ `create` / `update` / `deleteSavingsGoal` | ✅ `bank_create_savings_goal` 等 |
| 凑整设置 | ✅ `updateSavingsRoundup` | ✅ `bank_update_savings_roundup` |
| 现金管理规则 | ✅ `updateCashSweep` | ✅ `bank_update_cash_sweep` |
| 工资计划 | ✅ `updateSalary` | ✅ `bank_update_salary_plan` |
| 安全规则开关 | ✅ `setSecurityRule` | ✅ `bank_update_security_rule` |
| 贵宾厅核销 | ✅ `redeemLoungePass` | ✅ `bank_redeem_lounge_pass` |
| 删除收款人 | ✅ `deletePayee` | ✅ `bank_delete_payee` |
| 客服留言 | `sendSupportMessage` | ❌ 不交给 Agent：该接口只回固定话术，助手本身就是对话入口；转人工走 `bank_request_human_support` 建工单 |
| 风险测评提交 | ✅ `submitRiskAssessment` | ✅ `bank_submit_risk_assessment`（结果敏感，需单独确认） |
| 理财账户开立 | `openWealthAccount` | ❌ 不交给 Agent：需要短信验证码 + 人脸核身，助手只给 `[前往理财中心开户](/wealth)` 跳转卡片 |
| 虚拟卡 | `createVirtualCard` | 视演示范围决定，暂不纳入 |

### 文件类（建议 P4，需接口配合）

已完成：新增 `POST /api/exports`（已登录生成一次性导出→`GET /api/exports/:token` 下载 CSV，5 分钟、只能取一次，内存存储单实例有效）与三个助手工具 `bank_export_statement`、`bank_export_billing_report`、`bank_get_receipt`。实测：流水导出 200 + CSV 432 字节，二次下载 404；月报导出正常；回单在该部署 `url=null`，助手引导到交易详情打印。

| 操作 | 现状 | 需要补什么 |
| --- | --- | --- |
| ✅ 流水/账单 CSV 导出 | `exportTransactions` / `exportBillingReport` 返回下载数据 | 生成短期有效的下载链接或对象存储地址；模型只回链接，不回正文 |
| ✅ 电子回单 PDF | `getReceipt` 返回打印数据 | 同上；或明确助手只引导网页下载 |

### 明确不交给 Agent（建议保留网页）

- 登录、注册、短信验证码、登录态；
- 修改登录密码、支付密码、修改手机号（如要交给 Agent，需要短信/人脸凭证与独立风险确认，属于单独产品决策）；
- 演示用 `deposit`、卡 BIN 查询等内部方法。

### 自动扣款重新绑定

按上一轮约定，换卡后的订阅重绑保持**网页手动**，不给 Agent 写工具；Agent 只查询受影响合约并提示入口。若以后要放开，再加 `bank_bind_autodebit`。

## 统一实现规范

- 命名 `bank_<domain>_<action>`，`kind` 用中文短语；
- 每个写工具：先查真实状态 → 确认卡展示对象、金额/影响 → 用户确认（资金类再验支付密码）→ 执行 → 只回银行回执；
- 写操作继续带 `clientRequestId`，服务端幂等；确认卡对关键字段做 digest 复检；
- `allowedTools` 同步 `profiles/luckycat/cordis.patch.yml` 与 `doctor.patch.yml`；
- 每批补 `tools/check-agent-bank` 类断言/单测，并通过 `tools/local-test-env.mjs server` 与 `tools/check-agent-http.mjs`。

## 建议顺序

1. **P1 只读**：15 个查询工具，风险最低，先把“能查”补齐；
2. **P2 资金写**：换汇、卡激活、AA 付款优先，保险/信贷次之；
3. **P3 规则写**：预算、储蓄、现金管理、工资、安全规则、会员；
4. **P4 文件与敏感操作**：导出/回单，再单独决定密码与手机号。

## 需要确认

1. 修改登录密码/支付密码/手机号是否交给 Agent？
2. CSV 与回单是否以“短期下载链接”返回（需要补接口），还是助手只引导到网页下载？
3. 保险投保、借款申请、备用金支用这类授信/资金操作，是否都按支付密码 + 确认卡办理？
4. 是否把 `createVirtualCard` 这类演示能力纳入“所有操作”。
