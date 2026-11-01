# 统一银行环境

2026-10-29 已上线：官网、工作人员、运维和三类 Agent 统一使用现有 `maneki_bank_demo`，工作人员登录不再选择办理环境。本次沿用官网 sandbox 的客户及业务数据，没有重新初始化数据库。

## 部署状态

线上切换及公网/API 验证已完成，详见 [2026-10-29 统一环境部署验收](deployments/bank-unified-environment-deployment-20261029.json)。

| 项目 | 当前结果 |
| --- | --- |
| 源码发布 | `/srv/maneki-bank/current` → `/srv/maneki-bank/releases/20261029-unified-environment` |
| 网页发布 | `/var/www/bank.waveflow.men/current` → `/var/www/bank.waveflow.men/releases/20261029-unified-environment` |
| 切换前备份 | `/var/backups/maneki-unify-20261029T025532Z` |
| 统一数据 | 官网与工作人员均读取同一库中的 7 位客户；三位原工作人员密码 hash 保留，`auth_version=3` |
| 原库保全 | 原 live 全部表数据保留，未与 demo 资金相加；8080 旧服务定义已移至备份，服务名已 mask，禁止启动 |
| 活跃服务 | 银行 demo、客户 Agent、工作人员 Agent、运维 Agent 四项服务均为 active |
| 入口与权限 | 标准及旧兼容 API 使用同一令牌时角色权限一致，双库对账通过 |

2026-10-29 12:51（北京时间）已移除 8080 旧银行服务定义并 mask 服务名；员工与运维 Agent 的基础 unit 依赖同步切到 `luckycat-bank-demo.service`。实测仅 `127.0.0.1:8081` 监听银行端口，四项现用服务 PID 未变，Nginx 配置与页面/API 鉴权入口检查通过；未修改数据库。旧定义及依赖修改前备份位于 `/var/backups/maneki-retire-8080-20261029T045117Z`，见[移除验收](deployments/bank-retire-8080-deployment-20261029.json)。原库和匹配密钥保留用于历史恢复，不能直接恢复旧服务造成双写。

统一环境切换时工作人员 IM 仍未启用，浏览器入口出现 404。后续在 2026-10-29 12:19（北京时间）已增量启用员工 IM 与通知 Worker，并发布未启用状态的 `503 IM_DISABLED` 提示修正；客服/主管绑定接口 200、真实二维码生成及取消、通知签名和主管网页已验证，见[员工 IM 修复验收](deployments/bank-staff-im-fix-deployment-20261029.json)及[开通手册](staff-im-enablement.md)。员工本人尚需扫码绑定和私聊激活，真实 IM 投递未验收。运维终端继续关闭，真实银行接入状态保持原验收结果。

此前的 [2026-10-28 安全部署验收](deployments/bank-security-deployment-20261028.json) 记录的是官网演示库与原工作人员库分开的部署，不能用作本次统一验收。[AI 会话运维说明](bank-ai-session-postgresql.md) 中较早的 live 三通道部署记录保留作历史依据；统一环境的数据源以本说明及本次部署记录为准，namespace、加密与独占运行约束继续适用。

## 当前连接

| 入口或进程 | 统一去向 |
| --- | --- |
| 官网 `/api/` | `luckycat-bank-demo`，`127.0.0.1:8081`，`maneki_bank_demo` |
| 工作人员 `/staff-api/` | 同一 8081 后端，含 `/staff-api/ops/terminal/` |
| 旧 `/staff-demo-api/` | 同一后端 `/staff-api/` 的兼容别名，含终端；不再选择其他库 |
| 客户 Agent `/agent-api/` | `luckycat-agent-demo`，8891；银行地址 8081；会话 namespace 为 `customer` |
| 工作人员 Agent `/staff-agent-api/` | `luckycat-staff-agent`，8789；银行地址 8081；会话 namespace 为 `staff` |
| 运维 Agent `/staff-ops-agent-api/` | `luckycat-ops-agent`，8790；银行地址 8081；会话 namespace 为 `ops` |

三个 Agent 的 `LUCKYCAT_BANK_URL` 与 `LUCKYCAT_SESSION_DATABASE_URL` 都必须核对；只改网页代理不会统一 Agent。本次保留现行连接身份，每个 namespace 只运行一个 writer。切换前运行 URL 的数据库用户为 `maneki_owner`，本次不额外迁移角色权限；历史运维说明中的受限 AI 角色设计不能作为当前权限验收结果。保留与各 namespace 历史数据匹配的 `LUCKYCAT_SESSION_DATA_KEY`、原生模型日志、上传目录和 IM 状态，不把不同密钥的密文当作可互换数据。

`/staff/login?bank=demo` 与 `?bank=live` 等旧链接仍可打开统一登录页，但参数和旧浏览器存储不再切换数据源。客户令牌和工作人员令牌继续分开，客服、主管与运维继续按原角色授权；运维不能执行代客解冻。运维终端仍须显式启用，并通过独立凭据、PTY 依赖及后端权限检查。

## 历史数据保全

`maneki_bank_demo` 是统一后的现有业务数据源，保留官网客户及其原 ID、资金账户、余额分区、流水、冻结、支付错误次数、工单和审计。统一入口不改变 [单资金账户模型](product/account-model.md)。

原 `maneki_bank` 保留历史及恢复依据，已停止承接统一入口的新写入。不能因两库存在相同客户 ID、手机号、员工 ID 或姓名就覆盖或拼接记录；同名员工的身份、角色和凭据必须核对。本次原员工凭据保留、原库全部表保全及冲突检查结果记录在上述部署验收中。不得用重置员工密码、重新开户或重建空库代替迁移。

### 2026-10-29 切换前只读核对

- 原 live 只有两个种子客户，在 demo 均有相同 ID 与手机号，没有仅存于 live 的客户；不需要复制客户或新增资金账户。
- 原 live 的工单、审批、AI 会话与 IM 绑定均为空。其历史资金快照及 84 条审计与 demo 不同，且两库 `BANK_DATA_KEY` 不同；这些历史完整保留在原库及切换前备份，不与 demo 合计或覆盖。
- 三位重合工作人员的 ID、姓名和角色一致；live 密码 hash 已升级为 scrypt、`auth_version=2`，demo 为旧 hash、`auth_version=1`。只读密码验证表明 live 现有密码仍为原演示密码，均不匹配环境文件中的初始化密码；这里只能确认 hash 升级，不能声称密码已经修改、强度提高或原演示密码失效。实施目标是核验身份后保留 live 数据库现有 hash，令 demo 的 `auth_version` 大于双方旧最大值，使旧令牌失效；不以 env 初始化值覆盖现有密码，保留 demo 额外已撤销的测试员工。
- 两边 `staff`、`ops` namespace 均为空，无需迁移旧对话；现有 demo `customer` namespace、密钥及客户 IM 状态保持不变。
- 两边运维终端原本关闭，继续关闭。当前未发现维护 timer；旧部署记录中的备份/对账定时任务不代表当前已安装。

以上保留切换前检查及当时的实施目标；切换后的结果及数据摘要核验见本页部署状态与本次部署验收。

切换前备份两库、匹配密钥的独立保管信息、Nginx、systemd 配置及 Agent/IM 状态。若迁入会话，先停止相关 writer，核对目标 namespace 与 ID 冲突，保留可信归属和事件顺序，验证全部迁入密文可读。原客户 IM 已使用官网演示数据；保留其密钥与状态。若启用工作人员 IM，统一银行与 staff Bridge 的 `LUCKYCAT_STAFF_IM_SERVICE_KEY` 必须一致，并核对员工绑定对应的可信身份。

旧发布、原库和备份保留用于恢复。回退代码或流量前先保存统一库当前快照，不能用旧库或旧 dump 覆盖切换后接受的新写入；原 writer 的重新启用须先处理期间的数据差异，避免同时形成两套业务状态。

## AA 手机号付款通知（2026-10-30）

2026-10-30 17:34（北京时间）已上线：在现行 `/srv/maneki-bank/releases/20261029-transfer-security` 与同名网页发布目录上增量加入 AA 手机号收款通知、成员待付款、支付密码确认及原备注入流水。后端与三类 Agent 仍复用同一银行环境，通知保存于客户加密扩展域；不做结构迁移或数据重置。部署状态、备份和验证结果见当次 [AA 部署记录](deployments/bank-aa-payments-deployment-20261030.json)。

2026-10-30 21:22（北京时间）已将独立手机号收款入口合并至均分清单：逐项计算份额后绑定手机号与备注，再确认发送待付款通知；服务端重算金额并保留分项、本人份额及名单映射。18 项相关 PostgreSQL/业务回归及公网新版页面隔离交互验证通过，无结构迁移或真实客户测试扣款。备份及校验见 [合并均分清单部署记录](deployments/bank-aa-merged-list-deployment-20261030.json)。

## 发布与后续验收

仓库模板位于 [主站 Nginx 配置](../deploy/single-host/maneki-single-host.conf)、[旧入口兼容配置](../deploy/single-host/staff-demo.conf)；当前线上实际 include 为 `/etc/nginx/maneki-locations.conf`。实际发布还须修改受保护的 systemd 环境与依赖、核对两个工作人员路由和终端专用路由，执行 `nginx -t` 后再 reload。保留 demo 匹配的 `BANK_DATA_KEY`、sandbox 模式及 `BANK_AUTO_MIGRATE=false`，不整份套用原 live 环境。

后续更新需继续核对以下约束；具体哪些真实交互已验收，以当次部署记录为准：

- 所有客户与工作人员标准/兼容入口及三类 Agent 均连接同一业务库，旧环境参数不会恢复分流。
- 官网现有客户、冻结与工单可由具备权限的工作人员读取；客户、客服、主管、运维及 Agent 的拒绝越权行为保持有效。
- AI namespace、会话归属及匹配密钥保持可读，进程重启后历史保留；IM 状态保全。若以后启用工作人员通知，须另验服务鉴权和真实投递。
- 终端按原启用状态和运维权限验证；健康检查不代替终端或 IM 的真实交互验收。
- 两库备份、表数量与必要摘要、对账和原库保全结果；旧 writer 与定时任务的最终状态。
- 统一库的备份、对账及运维状态文件配置一致；如后续安装维护 timer，须单独验收，不能把旧记录当作已启用。`commercialReady=false`，真实银行连接状态未被放行。

连接验证和读取检查无需执行资金操作。密码维护脚本的当前适用范围见 [PostgreSQL 运维手册](bank-postgresql-operations.md#统一环境维护约定)；原 live 专用维护命令不能直接套用到 8081。
