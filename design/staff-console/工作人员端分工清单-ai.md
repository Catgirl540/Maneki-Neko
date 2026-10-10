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

### M0 — 书面对齐（**10-10 前**，人类动作）

- [ ] 客户端转账挂起方案书面确认（谁改 `app/**`、阈值取值）——功能清单 §9
- [ ] agent 对接面冻结稿（§4）发给 agent 负责人并取得回执

**M0 兜底**：逾期未答复不阻塞开工——客户端改动按功能清单 §9.3 默认方案由 A 执行（`pendingReason` 字段两端同属 A，见 §5 不变量 4）；agent 对接面按 §4 冻结稿实现，回执后补。书面答复只影响「谁动手」，不影响「怎么实现」。

### Phase 0 — 骨架（半天，**A 主导**；B 不空等，领并行任务）

A 必须产出且 B 可依赖的稳定物：

| # | 产物 | 路径 | 验收 |
|---|---|---|---|
| 1 | 员工端前端骨架 | `Maneki-Neko/staff/`（或与人类确认的等价目录） | 登录页可开、菜单渲染、路由可达；角色枚举 `csr`/`supervisor`（禁用 `agent`） |
| 2 | 接口契约 | `staff/src/api/contract.ts` + `types.ts` | 覆盖功能清单 §2 的全部 P0/P1 接口签名；文件顶部带版本号，每次 `[contract]` commit 版本号 +1 |
| 3 | 公共 HTTP 封装 | `staff/src/api/http/base.ts` 的 `request()` | 统一携带员工 token、统一解析 `{message, code}` 错误体、统一超时；mock/http 实现均经由它 |
| 4 | mock 层**最小版** | `staff/src/api/mock/` | 每接口一份写死样例数据，页面不白屏即可——**禁止**在 Phase 0 做完整业务模拟 |
| 5 | 后端空壳 | `server/` 内新增 `staff_` 前缀路由 + `staff_users` 等表 + 鉴权中间件 + `writeAudit()` | `GET /staff-api/health` 200；`tickets` 表含 `priority` 字段 |
| 6 | 部署/代理方案 | `design/staff-console/DEPLOY.md` | 写明：本地双前端+后端的端口分配与 Vite 代理；nginx 独立员工端站点/子路径 + `/staff-api` 反代配置样例 |
| 7 | demo 重置脚本 | `tools/reset-demo.mjs` | 一键回到演示种子数据（员工账号/待接工单/待审单/聊天样例） |
| 8 | agent 对接面冻结稿 | 见 §4（含第 6 条审批闭环） | 文本发给人类，转交 agent 负责人，需回执 |

Phase 0 完成判定：B 无需向 A 提问即可开始模块开发。

**B 在 Phase 0 半天的并行任务**（不空等）：① 精读 `app/src/api/mock/` 客户/流水/卡业务规则；② 冒烟脚本骨架三条（列表渲染/状态流转/审计落库）；③ 演示种子数据（2 员工、1 待接工单、1 待审单、客户聊天样例）。

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
| `app/**`（客户端） | — | **原则上禁改**；延迟到账 UI + mock 业务例外 | 例外范围：`TransferPage.tsx` 结果分支（含撤销）、`TransactionDetailPage.tsx`、`lib/tx.ts`、`api/{types,contract,http}.ts`、`api/mock/**`。改动前报备、改完知会客户端作者。**已超原 <30 行预算（mock 业务约 150 行），待签字**。若客户端作者认领则 A 不碰 |

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
- 鉴权：`X-Agent-Token` 取自环境变量（demo 固定值），与员工 Bearer 令牌分离，token 不进代码。
- 幂等：客户端可传 `Idempotency-Key`；同键重复 POST 返回原单，不重复建单。
- 错误体与客户端一致：`{ message: string(中文), code: string }`，HTTP status 判成败。
- 请求/响应字段定义以 `工作人员端清单.md` §5 为准，实现前与该节逐字段核对。
- **资金闭环（第 6 条，2026-10-09 钉死；2026-10-10 随延迟到账改写）**：`POST /tickets/:id/messages` 为 **P0**（demo 第 4 步依赖）。处置后的钱动作**归服务端收口**（窗口到点自动到账，或主管拦截/立即到账 → 解冻或结算扣款），**不归 agent**。agent 职责止于：提审 → 轮询 `GET /approvals/:id` → 通报结果。**禁止 agent 处置后再调转账接口**（防双重执行）；员工端同样永不发起新转账。若 agent 负责人已实现「approved 后执行」路径，双方二选一切换，需书面确认。

---

## 5. 不变量（两个 AI 的代码都必须满足）

1. 角色校验在后端逐接口执行；前端显隐仅为 UX，不构成安全边界。
2. 工单状态机：`open→processing→waiting⇄processing→resolved`；`→suspended→processing`。非法流转 → 400 + 中文文案。终态 `resolved` 不可变。
3. 处置状态机：transfer 类 `pending→settled|intercepted|recalled`，非 transfer 类 `pending→approved|rejected`；一次性；重复处置 → 409；拦截必须 `reasonCode` ∈ 枚举；驳回必须非空 `reason`。
4. 转账挂起（功能清单 §9）：金额 < 阈值（500000 分）→ 立即成功（无审核、无感）；金额 ≥ 阈值 → **挂单不扣款**，存转账指令 + 自动建 `biz_type='transfer'` 审批单（不经 agent；一笔指令仅一张有效审批单）。`approved` = **调用共用「执行转账」业务入口**（付款方扣款、收款方入账、档案流水、同步 `bank_*` 表，同一事务）——**禁止直接 `UPDATE bank_transactions`**（`saveLedger` 会按档案删重建，直接改表必被覆盖）。审批结果与执行结果分开：`approvals.status` 管裁决，`execution_status`(`pending/succeeded/failed`) 管资金执行，余额不足 → 「审批已通过、执行失败」并存 + 自动工单消息。`rejected` → 指令失败。**「审核中」渲染**：流水条目加 `pendingReason?: 'review' | 'clearing'`，服务端从指令**稳定字段**直出（不查审批 JSON），路由是 `GET /api/accounts/:id/transactions`。
5. 所有写操作经过 `writeAudit()` 落 `audit_logs`；漏记视为缺陷。
6. 客户敏感字段默认脱敏；完整视图访问必落审计（`customer_access_logs` 或等价 action）。
7. 代客办理走白名单动作，内部调用客户端既有业务规则，不复制校验逻辑；结果与客户端自办一致（同一 SQLite 数据源）。
8. 员工 token 与客户 token 不可互换；`staff_users` 预置账号仅演示用途。
9. 前端不得硬编码假数据进生产分支；mock 与 http 实现方法集合必须一致（参照客户端 `check-contract.mjs` 的五方一致纪律，B 负责写等价检查脚本）；HTTP 一律走 Phase 0 的 `request()` 封装。
10. 敏感资料访问日志与资料返回在**同一后端接口**内原子完成（校验理由→写日志→返回），前端禁止另发补记请求；`sender`/`actor` 一律服务端从登录态生成，不信请求体。
11. agent token 与员工 token 权限面不同：agent 仅建单、查自己建的单、回写允许的消息；接单/转派/员工消息仅员工 token。主管不得裁决自己发起的审批（`applicant_id` ≠ 当前主管）。
12. 审计红线：登录/敏感查看/接单转派/审批/代客操作/失败尝试必须落账（展示页可砍，记录不可砍）；日志不写完整账号、聊天原文、密钥。

---

## 6. 交付物与验收

| 交付物 | 负责 | 验收方式 |
|---|---|---|
| 五个模块可演示 | A+B | demo 脚本全流程无红 |
| `contract.ts` 与 mock/http 一致 | A | 机械比对（脚本或人工 diff 方法名集合） |
| agent 5 端点可用 | A | curl 冒烟：建单→查状态→提审→查裁决 |
| 冒烟脚本 ≥3 条 | B | 列表渲染 / 状态流转 / 审计落库各一条 |
| 降级清单 | A | 时间不足时按功能清单砍 P2→P1，**P0 三项不可砍** |
| **演示/合练前环境检查** | A+B | 客户端 `VITE_USE_MOCK=false` 连真后端（mock 转账立即到账，挂起链只在真后端）；`tools/reset-demo.mjs` 可归零 |

---

## 7. 冲突处理

| 冲突类型 | 处理 |
|---|---|
| 契约字段分歧 | 停 → 报人类 → A 统一改 → 广播 → 继续 |
| 公共文件同时需要修改 | A 负责合并进契约；B 提交需求文本 |
| 功能清单理解分歧 | 以 `工作人员端清单.md` 原文为准；仍有歧义报人类裁决 |
| 时间不足 | 按功能清单降级表执行，降级决定由人类确认 |

---

## 8. 当前状态速查（2026-10-10，延迟到账 + 拦截窗口已落地）

- [x] 功能清单已定稿：`工作人员端清单.md`（**§9 已于 2026-10-10 重写**为「延迟到账 + 拦截窗口」，取代旧的「挂起 → 主管审核放行」）
- [x] 分工已定稿（本文件）
- [x] 队友 4 条反馈已吸收：转账挂起设计 / 清单入库 `design/staff-console/` / Phase 0 增 HTTP 封装+部署代理 / Git 规矩写死
- [x] xpy 建议 6 条已裁决：M0 里程碑、角色改 `csr`、messages 升 P0、mock 最小版+`reset-demo.mjs`、B 并行任务、资金闭环归服务端收口（agent 禁重复执行）
- [x] 参考反馈 3 条已吸收：`pendingReason` 字段钉死渲染路径（防三不管）/ 验收加「演示前 `VITE_USE_MOCK=false`」/ M0 逾期兜底不许死等
- [x] 第三方对照后端评审已吸收：禁直接改流水表（走共用业务入口）/ `execution_status` 分离 / 转账处置防伪造（transferId+唯一约束）/ 访问日志同接口落账 / demo 第 1 步真提交转账 / 路由名与金额单位修正
- [x] **用户 2026-10-10 拍板重设计**：「闸门」→「刹车」。客户的转账权不该被员工收走；改成大额延迟到账 + 时间窗内员工一票否决（拦截，必选枚举理由）+ 客户可撤销 + 到点自动到账
- [ ] M0 未完成：客户端作者对 `app/**` 改动签字（本次超出原 <30 行预算）；agent 冻结稿回执
- [x] Phase 0 已完成（2026-10-09）：交付物 1–7 全部落地并冒烟绿
  - `staff/` 骨架可跑（登录页/外壳/六页占位）、`contract.ts` v1、`request()` 封装、mock 最小版
  - `server/staff-api.mjs` 六表+鉴权+writeAudit，列表/处置/审计接口已过冒烟
  - `design/staff-console/DEPLOY.md`、`tools/reset-demo.mjs`（--dry-run 可用，重复跑幂等）
  - 交付物 8 冻结稿文本已拟好，待人类转交 agent 负责人拿回执
- [x] 演示账号已预置（`staff_users`：王小明/csr、李主管/supervisor，`ensureStaffSchema` + `reset-demo.mjs` 双保险）
- [x] A1 工单前端（2026-10-09）：`TicketsPage` + `TicketDrawer`（筛选/3s 轮询/状态机按钮/转给主管/消息）
- [x] A2 工单后端（2026-10-09）：筛选、agent 权限面、纯转派语义、`customerName` 反查；20 项工单冒烟绿
- [x] A3 处置前后端 + 延迟到账主链（2026-10-10）：**47 项全链冒烟绿**
  - 服务端：`createTransferApproval` 自动建单（幂等、防伪造、riskSummary 服务端生成）/
    `closeTransferApproval` 三种收口 / `decide` 只收 `settle`|`intercept`，拦截必带枚举 `reasonCode` /
    走 `bankHooks.settleHeldTransfer`（不碰流水表）/ `execution_status` 与 `status` 分离
  - 桥接：`createDemoBank({ reviewThreshold, holdWindowMs, onTransferHeld, onHoldClosed })` +
    `getHeldTransfer`/`settleHeldTransfer`/`tickHolds()`（跨档案扫到期窗口，1 秒一次）
  - 客户端 mock：阈值进窗口 → **冻结 `available` 本金**（不动 `balance`）+ 占位流水
    `pendingReason='inflight'` + `holdUntil` + `heldRequest` 冻结快照；`recallTransfer` 用户撤销；
    `settleHeldTransfer` 三种收口都走同一条 `submitTransfer` 业务路
  - 员工端：`ApprovalsPage`（改名处置中心）真页 —— 列表轮询/参数快照/**窗口倒计时**/
    **立即到账**/**拦截（枚举理由下拉）**/新状态标签（已到账/已拦截/用户已撤销）
  - 必测场景全过：小额不进窗口 / 在途冻结可用不动余额 / 用户撤销解冻 / 拦截必选枚举理由（自由文本 400）/
    拦截解冻 / 立即到账扣款 / 重复处置 409 / **窗口到点自动到账** / 客服处置 403 / 审计留痕
- [x] 客户端 UI 补丁（**待客户端作者签字**，超出原 <30 行预算）：
  - `TransferPage`：「转账处理中 · 还剩 X 秒」+ **撤销**按钮；`TransactionDetailPage`：撤销按钮 + 在途截止
  - `lib/tx.ts`：`inflight` 显示「在途·延迟到账」（旧值 `'review'` 已废弃）
  - `app/src/api/mock/**`：延迟到账业务实现约 150 行（新模型把整条挂起链搬进 mock）
- [ ] agent 接口联调（A 顺序最后一项，等对方用冻结稿对接）
- [x] 全部改动已 commit/push（用户 2026-10-10 明确授权「把成果和进度文档push到github上」）
