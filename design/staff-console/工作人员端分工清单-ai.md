# 工作人员端分工清单（AI 版）

> 受众：Claude（甲方 AI）与队友的编码 AI（乙方 AI）
> 人读版：`工作人员端分工清单-人.md`（同内容，语境说明不同）
> 功能规格：`工作人员端清单.md`（唯一功能事实来源，本文件不重复定义功能）
> 仓库：`D:\Github\maneki-neko\Maneki-Neko`（客户端前后端完成态，commit `24f8f6e`）
> 日期：2026-10-09 ｜ 硬截止：2026-10-14 demo 可演

---

## 0. 执行原则（对两个 AI 同时生效）

1. **`工作人员端清单.md` 是功能唯一事实来源**。本文件只定义分工、边界、契约纪律。两文件冲突时以功能清单为准，分工冲突时以本文件为准。该文件已随仓库分发（`design/staff-console/工作人员端清单.md`）。
2. **契约冻结**：`staff/src/api/contract.ts` 一经骨架阶段产出，即为两 AI 的共享法律。任何签名/字段/错误码变更 → 停止写码 → 通知人类 → 由甲方 AI 统一修改 → 广播 → 乙方 AI 才可继续。
3. **文件所有权不可侵犯**：§3 表中未分配给己方的路径，禁止写入。需要跨界修改时输出需求描述给人类，不直接动手。`app/**` 例外条款见 §3。
4. **禁止重复造轮子**：业务规则复用 `app/src/api/mock/` 与 `server/` 已有实现；UI 风格复用 `app/src/styles/tokens.css` 体系。HTTP 层只准使用 Phase 0 产出的公共 `request()` 封装，禁止各写 fetch。不新引入框架、状态库、UI 库。
5. **Git 纪律（硬约束）**：各自分支开发（`feat/staff-a-*` / `feat/staff-b-*`）；**每日合并前先 pull**；契约改动单独一个 commit，标题以 `[contract]` 前缀开头。
6. **每日合并**：各自工作结束后必须与对方最新代码合并并冒烟，不得累积超过 1 天的分叉。
7. **诚实报告**：未完成/跳过/降级的条目在交付说明中显式列出，不得静默省略。

---

## 1. 角色分配

| 标识 | 承担人 | 模块 | 备注 |
|---|---|---|---|
| **A** | 用户（甲方，Claude 协助） | 工单中心、审批中心、agent 对接面 | demo 脊柱；兼任契约管家 |
| **B** | 队友（乙方 AI 协助） | 客户查询、代客办理、审计日志 | 大量复用客户端既有接口 |

配比约 A:55% / B:45%。若队友同时负责 agent 接入，B 侧缩减为「代客办理 + 审计」，客户查询移交 A——此调整由人类确认后生效。

---

## 2. 阶段定义

### Phase 0 — 骨架（半天，**仅 A 执行**，B 只读不写）

A 必须产出且 B 可依赖的稳定物：

| # | 产物 | 路径 | 验收 |
|---|---|---|---|
| 1 | 员工端前端骨架 | `Maneki-Neko/staff/`（或与人类确认的等价目录） | 登录页可开、菜单渲染、路由可达 |
| 2 | 接口契约 | `staff/src/api/contract.ts` + `types.ts` | 覆盖功能清单 §2 的全部 P0/P1 接口签名 |
| 3 | 公共 HTTP 封装 | `staff/src/api/http/base.ts` 的 `request()` | 统一携带员工 token、统一解析 `{message, code}` 错误体、统一超时；mock/http 实现均经由它 |
| 4 | mock 层 | `staff/src/api/mock/` | 前端可在 `VITE_USE_MOCK=true` 下跑通全部 P0 页面 |
| 5 | 后端空壳 | `server/` 内新增 `staff_` 前缀路由 + `staff_users` 表 + 鉴权中间件 + `writeAudit()` | `GET /staff-api/health` 200 |
| 6 | 部署/代理方案 | `design/staff-console/DEPLOY.md` | 写明：本地双前端+后端的端口分配与 Vite 代理；nginx 独立员工端站点/子路径 + `/staff-api` 反代配置样例 |
| 7 | agent 对接面冻结稿 | 见 §4 | 文本发给人类，转交 agent 负责人 |

Phase 0 完成判定：B 无需向 A 提问即可开始模块开发。

### Phase 1 — 并行（约 2.5 天）

A 执行顺序：工单前端(mock) → 工单后端 → 审批前端+后端 → agent 接口联调。
B 执行顺序：客户查询前端(mock) → 客户查询后端 → 代客办理 → 审计日志。
每步完成即冒烟，不攒批。

### Phase 2 — 合练（1 天，A+B）

按 demo 脚本（`工作人员端清单.md` §7）全流程跑通；补漏；准备演示账号与话术。

---

## 3. 文件所有权（hard constraint）

| 路径 | 所有者 | 写权限 | 说明 |
|---|---|---|---|
| `staff/src/pages/tickets/**` | A | 独占 | 工单 UI |
| `staff/src/pages/approvals/**` | A | 独占 | 审批 UI |
| `staff/src/pages/customers/**` | B | 独占 | 客户查询 UI |
| `staff/src/pages/actions/**` | B | 独占 | 代客办理 UI |
| `staff/src/pages/audit/**` | B | 独占 | 审计 UI |
| `staff/src/api/contract.ts` `types.ts` | A（管家） | B 只读 | 变更流程见 §0.2 |
| `staff/src/api/mock/**` | 各写各的模块文件 | 公共文件（db 种子）归 A | |
| `staff/src/api/http/**` | 各写各的模块文件 | 同上 | |
| `staff/src/layout/**` `staff/src/login*` 路由表 | A | B 提需求 | Phase 0 产物 |
| `server/` tickets/approvals/转账挂起/agent-facing 路由 | A | 独占 | 转账挂起逻辑见功能清单 §9 |
| `server/` customers/actions/audit 路由 | B | 独占 | |
| `server/` 鉴权中间件、`writeAudit()`、建表 SQL | A 建、双方只读 | 改动需广播 | 公共地基 |
| `app/**`（客户端） | — | **原则上禁改**；转账审核文案例外 | 例外范围：`TransferPage.tsx` 结果分支 + 流水状态标签，改动前报备、改完知会客户端作者；预算 < 30 行。若客户端作者认领则 A 不碰 |

命名约定：新文件一律带模块前缀（`ticket-*` / `approval-*` / `customer-*` / `action-*` / `audit-*`），避免同名冲突。

---

## 4. Agent 对接面（冻结稿，A 维护）

给 agent 负责人的约定——员工端是普通 HTTP 服务，5 个端点即全部：

| 方法 | 路径 | 用途 | 返回 |
|---|---|---|---|
| POST | `/staff-api/tickets` | 转人工建单 | `{ticketId, status}` |
| POST | `/staff-api/approvals` | 敏感操作提审 | `{approvalId, status}` |
| GET | `/staff-api/approvals/:id` | 查裁决结果 | `{status, reason?}` |
| GET | `/staff-api/tickets/:id` | 查工单状态与消息 | `{status, messages[]}` |
| POST | `/staff-api/tickets/:id/messages` | 员工/agent 对话回写 | `{messageId}` |

约束：
- 鉴权：`X-Agent-Token: <shared-secret>`（demo 固定值），与员工 Bearer 令牌分离。
- 幂等：客户端可传 `Idempotency-Key`；同键重复 POST 返回原单，不重复建单。
- 错误体与客户端一致：`{ message: string(中文), code: string }`，HTTP status 判成败。
- 请求/响应字段定义以 `工作人员端清单.md` §5 为准，实现前与该节逐字段核对。

---

## 5. 不变量（两个 AI 的代码都必须满足）

1. 角色校验在后端逐接口执行；前端显隐仅为 UX，不构成安全边界。
2. 工单状态机：`open→processing→waiting⇄processing→resolved`；`→suspended→processing`。非法流转 → 400 + 中文文案。终态 `resolved` 不可变。
3. 审批状态机：`pending→approved|rejected`，一次性；重复裁决 → 409；驳回必须非空 `reason`。
4. 转账挂起（功能清单 §9）：金额 < 阈值 → 立即成功（无审核）；金额 ≥ 阈值 → 流水 `status='pending'` + 自动建 `biz_type='transfer'` 审批单（不经 agent）；`approved` → 流水翻 `success`，`rejected` → 翻 `failed`。阈值为 server 配置项（demo ¥5,000），禁止在前端写死。
5. 所有写操作经过 `writeAudit()` 落 `audit_logs`；漏记视为缺陷。
6. 客户敏感字段默认脱敏；完整视图访问必落审计（`customer_access_logs` 或等价 action）。
7. 代客办理走白名单动作，内部调用客户端既有业务规则，不复制校验逻辑；结果与客户端自办一致（同一 SQLite 数据源）。
8. 员工 token 与客户 token 不可互换；`staff_users` 预置账号仅演示用途。
9. 前端不得硬编码假数据进生产分支；mock 与 http 实现方法集合必须一致（参照客户端 `check-contract.mjs` 的五方一致纪律，B 负责写等价检查脚本）；HTTP 一律走 Phase 0 的 `request()` 封装。

---

## 6. 交付物与验收

| 交付物 | 负责 | 验收方式 |
|---|---|---|
| 五个模块可演示 | A+B | demo 脚本全流程无红 |
| `contract.ts` 与 mock/http 一致 | A | 机械比对（脚本或人工 diff 方法名集合） |
| agent 5 端点可用 | A | curl 冒烟：建单→查状态→提审→查裁决 |
| 冒烟脚本 ≥3 条 | B | 列表渲染 / 状态流转 / 审计落库各一条 |
| 降级清单 | A | 时间不足时按功能清单砍 P2→P1，**P0 三项不可砍** |

---

## 7. 冲突处理

| 冲突类型 | 处理 |
|---|---|
| 契约字段分歧 | 停 → 报人类 → A 统一改 → 广播 → 继续 |
| 公共文件同时需要修改 | A 负责合并进契约；B 提交需求文本 |
| 功能清单理解分歧 | 以 `工作人员端清单.md` 原文为准；仍有歧义报人类裁决 |
| 时间不足 | 按功能清单降级表执行，降级决定由人类确认 |

---

## 8. 当前状态速查（2026-10-09 队友反馈对齐后）

- [x] 功能清单已定稿：`工作人员端清单.md`（含 §9 转账挂起/审核放行）
- [x] 分工已定稿（本文件）
- [x] 队友 4 条反馈已吸收：转账挂起设计 / 清单入库 `design/staff-console/` / Phase 0 增 HTTP 封装+部署代理 / Git 规矩写死
- [ ] Phase 0 未开始
- [ ] agent 对接面尚未发给 agent 负责人（**最先做的人类动作**）
- [ ] 演示账号未预置（`staff_users`：王小明/客服、李主管/主管）
- [ ] 转账审核客户端文案补丁未打（归属见功能清单 §9.3，认领人待客户端作者回复）
