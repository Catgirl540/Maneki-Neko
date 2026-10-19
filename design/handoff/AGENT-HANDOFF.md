# 招财猫银行 · Agent 接手说明

更新：2026-10-19。本次交接只整理文档，银行卡与会员新体系尚未实现、未部署。旧版交接中的 SQLite、裸 IP 发布和旧源码目录操作已退出当前流程；历史可通过 Git 查看。

## 1. 先读与当前任务

先读根目录 `AGENTS.md`、[客户端版本](../../CLIENTS.md)、[账户模型](../../docs/product/account-model.md)，再读[银行卡与会员规则草案](../../docs/product/cards-and-membership-proposal.md)。

用户最新要求：**每位客户至多一张 Visa、一张银联，并设计类似 ZA 用户等级与微众会员的分级体系。** 用户随后要求更新文档，暂由其他 Agent 接手；没有要求立即改业务代码或迁移客户数据。

本轮开始时业务代码基线为已推送的 `main`，最新提交 `52b92ef`。本地目录 `/home/bigguga/文档/招财猫Bank`；仓库 `https://github.com/Catgirl540/Maneki-Neko`。接手先检查工作区及远端最新状态，不假定分支与服务器相同。

## 2. 已确认与待确认

已确认：Visa、银联各至多一张；延续一个储蓄资金账户、多币种余额，银行卡不单独存钱。

以下是上一位 Agent 的建议，**用户尚未确认，不能直接当作正式规则上线**：

- 统一客户会员等级，两种卡共享等级与权益；也已询问用户是否希望每种卡独立分级，尚未收到选择。
- 四档白银、黄金、铂金、钻石；开户即享及日均资产 1 万、10 万、50 万元只是建议参数，不是用户定案或其他银行现行门槛。
- 上月日均资产评定本月等级、北京时间日终快照、评级资产组成及换算方式，均待确定。
- 用资产等级替换当前付费订阅、改名“会员与权益”、各档费用优惠及卡面方案，均为建议。
- 锁定、待激活等状态占名额，换卡接替名额，虚拟卡及一次性凭证口径见草案；落地前确认边界。

尚未获得存量重复卡的保留方案。不得静默删除、作废、替用户换卡，或将草案门槛用于服务器真实评定。

## 3. 已查明的实现差距

- 默认演示档案有两张 Visa、一张银联，不符合新数量要求。
- `openCard` 当前未按客户和卡组织限制数量，不能只把网页按钮隐藏。
- 用户资料中有固定“金卡会员”，会员域另有普通会员和月费套餐，数据口径不一致。
- 当前套餐只记录订阅设置，扣费和所列权益没有完整接通，不能宣称已享权益。
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
