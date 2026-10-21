# 招财猫银行 · Agent 接手说明

更新：2026-10-20。卡数量限制与会员制新方案均已在本地实现、未提交/未部署。旧版交接中的 SQLite、裸 IP 发布和旧源码目录操作已退出当前流程；历史可通过 Git 查看。

**2026-10 进展：卡数量限制与会员制新方案已在本地实现并通过验收**（`tools/check-card-limit.mjs`、`tools/check-membership.mjs`、`check-single-account.mjs`、`check-registration.mjs`、lint/build、服务端测试）。会员规则细节见 [会员制规则设计](../../docs/product/membership-rules.md)（2026-10-20 用户定稿），卡数量限制见 [银行卡与会员体系](../../docs/product/cards-and-membership-proposal.md)（会员段落已标注历史）。尚未提交到远端、未部署公网；存量客户档案的迁移按 `normalizeMembership`/档案迁移幂等执行，重复卡保留为历史记录不删除。

## 1. 先读与当前任务

先读根目录 `AGENTS.md`、[客户端版本](../../CLIENTS.md)、[账户模型](../../docs/product/account-model.md)，再读[会员制规则设计](../../docs/product/membership-rules.md)与[银行卡与会员体系](../../docs/product/cards-and-membership-proposal.md)。

用户最新要求：**每位客户至多一张 Visa、一张银联；会员改为纯资产分层的新方案（删掉付费订阅）。** 2026-10-20 用户确认三条附加决策：旧的两项已接通权益（制卡/换卡费减免、换汇点差折扣）与新权益并存；AUM 按储蓄 + 理财持仓 + 现金管理全口径；新权益本轮全部落地（贵宾厅核销、理财优先购、VIP 工单优先、专属经理/顾问标识）。

本轮开始时业务代码基线为已推送的 `main`，最新提交 `52b92ef`。本地目录 `/home/bigguga/文档/招财猫Bank`；仓库 `https://github.com/Catgirl540/Maneki-Neko`。接手先检查工作区及远端最新状态，不假定分支与服务器相同。

## 2. 已确认（均已实现）

- Visa、银联各至多一张；使用中/锁定/寄送中占名额，replaced 不占；换卡原子接替名额；服务端强制（`CARD_NETWORK_LIMIT`，先于验密与收费）。
- 会员四档：普通（standard，开户即享，¥0）/ 金卡（≥ ¥10 万）/ 白金（≥ ¥50 万）/ 钻石（≥ ¥300 万），按**月均 AUM** 评定。
- AUM = 资金账户折人民币余额（含外币按中间价）+ 理财持仓市值 + 现金管理余额；不含信用卡 / 授信额度。日终快照存当日 AUM，北京时间落档，缺日按 0 计。
- 评定：每月 1 号按上月日均重算；**升级即时**（实时 AUM 达标当天升）；**降级连续 2 个评定周期不达标**才降（`belowPeriods` 缓冲）。惰性触发：会员中心 / 申卡 / 换汇等入口。
- 权益统一由 `entitlements(tier)` 返回并在业务点消费：境外转账费减免（金卡+）、客服 VIP 工单（金卡+）、专属客户经理（白金+）、理财优先购窗口（白金+）、贵宾厅 2/6 次（白金/钻石）、专属理财顾问（钻石）、境外汇款手续费减免（钻石）；生日礼遇暂缓，字段保留但为 `false`。
- 旧权益并存：制卡/换卡费年度减免（金卡半价 1 次、白金全免 1 次、钻石全免 2 次含寄送）+ 换汇点差折扣（9/8/7 折）。
- 付费订阅彻底删除：`MembershipPlan`/`MembershipSubscription` 类型、订阅接口、`membership.legacy` 字段与 `user.memberLevel` 均已移除；`user.memberTier` 由 AUM 派生。
- 存量重复卡保留为历史记录（replaced），不静默删除、作废或替用户换卡；阻止继续增发。
- 一次性虚拟卡号派生自已占名额的实体卡，是临时凭证不额外占名额。

待确认：生日礼遇的礼物形态（文档标「暂缓」）；卡面按等级区分的设计。

## 3. 实现位置

- 共享规则：`shared/membership.mjs`（四档门槛 / `aumAssets` / `entitlements` / `evaluateMembership` 降级缓冲 / `applyRealtimeUpgrade` / `redeemLoungePass` / `transferFee` / 理财优先购闸门），两侧各自注入自己的 `FX_MID_RATES`。
- 服务端：`server/domain/index.mjs`（`openCard`/`replaceCard`/`getMembership`/`redeemLoungePass`/转账费/理财优先购/工单优先级）、`server/domain/state.mjs`（种子、迁移、`persist` 记录 AUM 快照）、`server/bank-api.mjs`（`POST /api/membership/lounge-pass` 路由）、`server/support-api.mjs`（客户工单按会员等级写 `priority`）、`server/staff-api.mjs`（工单列表 VIP → 加急 → 普通，再按创建时间倒序）。
- 网页 mock：`app/src/api/mock/{index,db}.ts` 镜像同一规则；`MOCK_SCHEMA` 仍为 21（会员结构在 `normalizeMembership` 内幂等修补）。
- 页面：`MembershipPage`（会员中心：等级卡 + AUM 升级进度 + 权益 + 贵宾厅核销 + 等级对比 + 评定记录）、`WealthPage`（优先购徽标）、`SupportPage`/`ChatWorkspace`（专属客户经理 / 理财顾问标识）、`Sidebar`/`SecurityPage`（`memberTier` label）。
- 断言：`tools/check-card-limit.mjs`、`tools/check-membership.mjs`、`check-single-account.mjs`、`check-registration.mjs`、`check-web-ui-corrections.mjs`、`check-transfer-holds.mjs`。
- 文档：`docs/product/membership-rules.md`、`docs/product/cards-and-membership-proposal.md`、`docs/product/account-model.md`、`docs/api/profile.md`、`docs/api/README.md`、`framework/knowledge/03-cards.md`。
- 注册新客户当前创建资金账户但不自动发卡；不要误将默认演示卡当作注册必须附送的卡。

代码入口：

- 网页：`app/src/pages/CardsPage.tsx`、`MembershipPage.tsx`、`SecurityPage.tsx`。
- 申换卡：`app/src/components/cards/CardApplicationModal.tsx`；类型和契约：`app/src/api/{types,contract}.ts`。
- 浏览器 mock：`app/src/api/mock/{index,db}.ts`；HTTP 银行业务：`server/domain/{index,state}.mjs`，路由在 `server/bank-api.mjs`。两侧都要核对，不能只改 mock。
- 共享账户规则：`shared/account-model.mjs`；持久化与事务：`server/database.mjs`。
- 银行卡文档：`docs/api/cards.md`；会员：`docs/api/profile.md`。
- Agent：`framework/knowledge/03-cards.md`、`framework/skills/bank-cards/SKILL.md`，以及对应银行工具与确认流程。

## 4. 建议接手顺序

1. 先与用户确认会员共用/独立分级、门槛、评定及保级周期、每档真实权益和存量卡处理方式。
2. 数量限制在后端事务中实现，覆盖网页、App、Agent、并发和重复提交；前端展示可申请网络与不可申请原因。同组织换卡不额外占名额，失败不重复扣费或作废旧卡。
3. 调整新演示夹具；服务器存量先只读盘点、备份，按确认方案迁移，保留资金、冻结、流水及历史卡记录。
4. 会员需要可追溯快照、评定结果和权益使用记录。缺少历史日终数据时不反推或编造日均资产，收费按后端报价及已接通的权益执行。
5. 同一提交同步账户模型、接口文档、知识/技能与断言；会员升级不能创建账户、扩大银行权限或跳过确认。

## 5. 上一轮已提交的工作与测试

已推送到 `main`：

- `a42ebda`：客服工作循环视频、空会话头像过渡、Agent 健康失败自动恢复、重复客服目录项移除。
- `7fda5ed`：隔离演示环境与新 VPS 部署资料。
- `52b92ef`：Flutter 重设计前只读归档；当前 Flutter 仍在 `mobile/`。

DSH 升级前 `0.1.6-alpha.2` 源码另见 [旧版框架归档](../../archive/2026-10-19/dsh-before-0.2.1/README.md)。当前框架实际安装及客户/员工/运维 profile 已核对为 `0.2.1-rc.2`；不要把截图中的旧版本、全局 `dsh` 或其他目录当作本工作区版本。接手时执行 `npm --prefix framework run check:dsh` 重新核实。

此前网页/员工构建、Agent 慢健康响应及恢复回归、单资金账户门禁均通过。这些结果**不代表新卡数量限制或新会员体系已验收**。

新业务实施后运行：

```bash
npm --prefix app run check:account-model
npm --prefix app run build
npm --prefix server run check:integration
```

完整整合门禁需要四个明确配置、可丢弃的 PostgreSQL 测试库，见 [后端说明](../../server/README.md)。不要使用线上两库；缺少连接或跳过测试不能记为通过。按新规则补充同组织重复申请、并发、锁卡、待激活、换卡原子性、不同组织各一张及会员边界断言。

## 6. 公网实际状态

域名 `https://bank.waveflow.men/` 已迁往 **15.235.241.158**，网页、银行 API、Agent、PostgreSQL 16 与 Flutter 下载均在新机。

**线上仍是 `b006b6d` 加两项已部署的 Agent 健康检查修复，不包含后来推送的客服视频、头像过渡及导航去重。** 上一轮尝试同步导航时 SSH/SCP 连接中断，未完成切换；不能看到 main 已更新就认定公网已更新。接手应重新确认连接和 current 指向，只发布明确目标版本，不复用未完成上传包。

当前源代码发布目录 `/srv/maneki-bank/releases/20261019-b006b6d`，运行链接 `/srv/maneki-bank/current`；静态目录 `/var/www/bank.waveflow.men/releases/20261019-b006b6d`，链接 `/var/www/bank.waveflow.men/current`。

- 客户演示：`luckycat-bank-demo` 8081、`luckycat-agent-demo` 8891，库 `maneki_bank_demo`。
- 员工后台：`luckycat-bank` 8080、员工 Agent 8789、运维 Agent 8790，库 `maneki_bank`。
- live 客户 bridge 保留在本机 8898，不是公开演示客户上游。
- 密钥及连接配置在 `/etc/maneki-vps2/`，root 目录 0700、环境文件 0600；不打印或提交内容。

完整通道、备份、兼容路径及回滚见 [单机部署说明](../../deploy/single-host/README.md) 和 [迁移记录](../../docs/bank-vps2-deployment-20261019.json)。原服务器的银行服务已停止并禁用自启动；数据及备份保留，不能恢复旧机写入或直接切回旧库造成双写/丢失新操作。

## 7. 接手边界

- 不修改或提交 `.arch/`；归档不参与默认源码搜索、构建和部署。
- 网页维护 `app/`，桌面验收；安卓维护 Flutter `mobile/`，不回到旧 Kotlin 或旧网页风格。
- 继续使用 PostgreSQL、匹配的数据及会话密钥；不清空客户库，不用演示快照覆盖线上数据。
- 本次文档没有联系其他 Agent、没有新增任务、没有实施分级或执行公网发布。由用户安排接手对象。
