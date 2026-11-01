# 工作人员微信 IM 与任务提醒

2026-10-21：已实现本地代码，覆盖客服 `csr` 和主管 `supervisor`；未部署、未进行真实微信扫码或投递验收。运维不进入工作人员 IM。

2026-10-29：已在统一环境启用员工 IM 与通知 Worker，客服/主管绑定列表、通知服务签名及真实二维码生成/取消验收通过；本人扫码绑定和真实投递尚待员工完成，详见[本次修复验收](../deployments/bank-staff-im-fix-deployment-20261029.json)。

入口为工作人员网页「IM 机器人」：同站部署 `/staff/im`，工作人员独立开发服务 `/im`。页面提供本人的页内微信扫码、明确绑定、私聊激活状态、提醒开关与静默时段、连接测试、解绑和投递记录；主管可维护值班客服、备用主管与值班时段。手机业务确认入口为同源 `/staff-agent-api/im`。

## 业务能力

当前注册表共 21 项员工工具：客服可用 17 项、主管可用 20 项，另 1 项只用于原有独立运维运行时。普通 `staff` profile 仅加载 20 项业务工具与提问工具，不加载运维工具。

员工微信复用客户 IM 的渠道协议与 Harness 适配器，以及原员工 Agent 的确认、补充信息、停止和结果回传。新增工作台真实聚合、合法转派人员、工单转派、创建审批、本人提醒记录和设置查询；补齐工单留言额外客户端提醒、状态/负责人筛选及分页。查询页最多 30 项，保留真实总数和下一页信息。

有效员工登录和绑定中的白名单 GET 查询可以在 IM 本轮直接授权并留痕；写操作继续使用银行页面一次确认。代客办理必须关联同一客户在办工单，由员工独立完成电话/短信/人脸核验，模型和微信文字不能代填。工单接手、转派、代客资格和权限在后端再次校验；`version/expectedVersion` 阻止旧确认覆盖新状态。

工单回复的 `visibleToCustomer` 只决定是否额外推到客户收件箱；客户自建工单的对话本来可见，不代表关闭该选项就成为私密留言。审批结果和资金执行状态分别报告。转账处置使用原在途指令，不产生第二笔转账。

## 配置与启动

沿用已有银行 PostgreSQL、员工 AI 会话库、员工 profile、模型和会话数据密钥，先阅读[启动说明](../../README-START.md)及[员工 Agent](staff-agent.md)。本功能不初始化、重置或替换现有客户资金数据。

数据库结构由数据库拥有者通过既有 `server/bootstrap-postgres.mjs` 升级；新增结构在 `server/staff-im-schema.sql`，员工权限版本和工单版本在 `ensureStaffSchema()`。生产应用仍保持 `BANK_AUTO_MIGRATE=false`，升级后按实际数据库和运行角色授予权限；历史 `deploy/postgres/grants.sql` 中的 `maneki_bank` 不可直接套用到统一库。本次七张表、事件触发器及 `maneki_app` 权限预检已通过，无需结构迁移。触发器和普通查询不要求应用获得 DDL 权限。

银行后端与员工 Bridge **都配置相同**的 `LUCKYCAT_STAFF_IM_SERVICE_KEY`，至少 32 字节，使用独立随机服务密钥，仅放服务进程环境；不要放 `VITE_*`、网页存储或仓库。银行后端还应配置正确的 `LUCKYCAT_STAFF_IM_PUBLIC_URL`，用于通知中的银行链接。

员工 Bridge 环境：

```powershell
$env:LUCKYCAT_STAFF_IM_ENABLED='1'
$env:LUCKYCAT_STAFF_IM_NOTIFICATIONS_ENABLED='1'
$env:LUCKYCAT_STAFF_IM_PUBLIC_URL='https://你的银行域名'
# LUCKYCAT_STAFF_IM_SERVICE_KEY 与银行服务一致；使用已有员工会话连接与密钥。
npm --prefix framework run start:staff
```

| 配置 | 用途 |
| --- | --- |
| `LUCKYCAT_STAFF_IM_ENABLED=1` | 只在客服/主管 Bridge 启用员工 IM，默认关闭 |
| `LUCKYCAT_STAFF_IM_NOTIFICATIONS_ENABLED=1` | 启用独立通知 Worker；需同时启用员工 IM |
| `LUCKYCAT_STAFF_IM_SERVICE_KEY` | 银行和员工 Bridge 的受限通知服务身份，至少 32 字节 |
| `LUCKYCAT_STAFF_IM_PUBLIC_URL` | 银行同源 HTTPS 网址；本机调试可用回环 HTTP |
| `LUCKYCAT_STAFF_IM_DATA_KEY` | 可选、规范 Base64 的独立 32 字节加密密钥；缺省以原 IM/会话密钥和员工专用派生域加密 |
| `LUCKYCAT_SESSION_DIR` | 稳定员工会话目录；员工 IM 子目录为 `staff-im/`，与客户 `im/` 分开 |
| `LUCKYCAT_PG_MODULE_PATH` | 本机未单独安装 Bridge PostgreSQL 驱动时，按原会话库文档指定已安装 `server/node_modules/pg` 的绝对路径 |

现有 `/staff-agent-api/ → 8789/agent-api/` 反向代理继续使用。银行的 `/internal/staff-im-notifications/` 仅供受控服务网络访问，**不增加公网反向代理**。请求需要签名、30 秒时间窗口、一次 nonce；该服务密钥不能调用员工业务工具或客户接口。Bridge 不把该密钥交给模型子进程。

关闭通知 Worker 停止新投递并保留队列；停用本人提醒会抑制该员工的待发通知。退出网页只结束业务登录，不取消持久化提醒授权。解绑撤销业务私聊归属和提醒绑定，旧任务不会自动迁移到新微信。

## 首次连接与使用

1. 员工登录「IM 机器人」，本人在页内生成二维码并扫码；扫码任务有归属、有效期和限流，不能读取或确认他人的二维码。
2. 明确确认绑定本人微信并开通任务提醒。扫码确认之前不会建立员工业务授权。
3. 在本人微信给机器人发一条私聊，建立本次凭据的投递上下文；在线状态和上下文就绪分别检查。重新扫码后通常需要重新激活。
4. 主管选择值班客服与至少一位备用主管并保存；首次规则为空时，任务保留“等待接收人”，不会随机群发。所有接收人需各自连接微信。
5. 需要时主动点击「发送连接测试提醒」；系统记录一条无客户内容的测试通知。该按钮本身是明确测试发送操作，测试状态仍以真实回执为准。
6. 收到任务后可在微信提出查询或处理需求；必要时打开员工确认页核验操作，最终结果回原私聊。登录失效时从原私聊取得新绑定链接重新登录，不续办旧指令。

同一员工普通业务重新登录保留通知绑定版本。主微信变更、解绑和重新扫码产生的新路由使旧通知失效。客户与员工使用独立配置、机器人实例、加密派生域和会话命名空间，账号 ID 同值也不会串用。业务员工不能访问机器人全局管理、企微 Secret 或运维终端。

## 事件、路由与可靠性

PostgreSQL 触发器在工单、客户补充、转派、审批创建及状态变化的原事务内写 Outbox；事务回滚不产生通知。事件只含资源编号与类型，不复制客户原文。客户请求原有幂等锁继续生效，员工写入也可通过 `X-Staff-Request-Id` 获取原结果。幂等请求、工单操作、资金动作及其审计共同使用现有银行业务提交边界，避免嵌套资金事务。

| 事件 | 收件规则 |
| --- | --- |
| 客户新建未分配工单 | 值班客服池；无合格客服则通知备用主管 |
| 已指派工单与客户补充 | 当前负责人；其未绑定、停提醒或角色失效则使用备用主管 |
| 工单转派 | 新负责人，旧负责人待发提醒经状态复核抑制 |
| 审批与临近到期的转账处置 | 值班主管，排除申请人；按真实 `holdUntil` 停止过期提醒 |
| 未接手、客户补充未响应 | 普通 5 分钟催办、15 分钟升级；加急/VIP 为 1 分钟与 3 分钟 |
| 持续离线 | 发送前退避等待；持续 2 分钟后生成去重的备用主管通知 |

连续客户补充按固定响应轮次和 30 秒批次合并；后续补充不重置响应起点。待接手与待响应分别计时。成功对客回复、等待客户或终态结束相关催办，打开消息或渠道确认不算接手。通知升级不自动改负责人。

通知模板只含任务编号、通用事件、优先级、北京时间及受保护银行链接。自动提醒不调用模型、不携带客户姓名/电话/余额/卡号或聊天原文，不要求持久化员工 Bearer。无合格接收人时保留 `waiting_recipient`，主管面板显示缺口。

Worker 使用唯一逻辑通知键、数据库租约和唯一发送尝试。发送前检查当前员工角色、主绑定及版本、当前工单归属、规则和有效窗口。明确尚未调用渠道的离线可退避重查，最多 20 次；开始发送后的超时、中断或部分发送为 `unknown`，不会自动重发。Worker 只重试完成状态上报，不重发微信。遗留 `sending` 超过发送租约后转 `unknown`。

`sent` 只表示渠道确认接受，不表示手机送达、微信已读或工单已接手。已经交给渠道的在途消息可能在解绑/解决之后仍到达，不能撤回；链接打开和业务执行始终读取最新状态。

## 接口与数据

员工连接接口位于 `/staff-agent-api/im`，上游 Bridge 内部仍使用 `/agent-api/im`：

- `POST /auth/login`：固定员工登录，拒绝客户短信登录和运维身份。
- `POST /weixin/qr`；`GET /weixin/qr/:id`；`POST /weixin/qr/:id/verify|cancel|confirm`：本人扫码生命周期。
- `POST /preview|claim`：从本人私聊取得绑定码，明确确认后绑定。
- `GET /bindings`；`DELETE /bindings/:id`；`POST /bindings/:id/test|reconnect`：本人连接、测试与重连。
- 业务确认、问题答复、事件读取、停止继续使用原员工会话接口，微信普通文字不批准操作。

银行接口新增 `/staff-api/workbench`、`/staff-api/assignees`，以及 `/staff-api/im/notification-preferences`（GET/PATCH）、`notification-rules`（主管 GET/PUT）和 `notifications`（GET 分页）。工单/审批列表支持 `page/size`，不带 `page` 时保留旧数组响应。

内部服务允许 `bind`、`validate-binding`、`revoke`、`test`、`claim`、`begin-send`、`not-ready`、`complete` 等固定方法；其中员工绑定和测试还要求有效员工 Bearer。内部请求不能指定任意微信收件人或自由通知正文。

业务 PostgreSQL 保存 `staff_im_bindings/preferences/rules/outbox/cycles/notifications/attempts` 和员工请求结果；渠道真实路由及凭据保存在员工 Bridge 受保护目录。数据库备份不包含渠道文件，恢复需同时保存匹配密钥；不得从旧快照重新广播不确定发送。上游上下文目录并非全部加密，按敏感资料限制访问与备份。

## 验证与当前限制

未启用员工 IM 时（`LUCKYCAT_STAFF_IM_ENABLED` 未设为 `1`），Bridge 不挂载 `/agent-api/im/*`。旧部署落到通用 404，页面会原样显示 `未知路径：GET /agent-api/im/bindings`；当前代码改为 `503 {"code":"IM_DISABLED"}`，页面显示「员工微信 IM 尚未启用」并禁用生成二维码。这只修正提示，真正开通还需银行与 Bridge 的服务密钥、数据库结构和重启，步骤见[员工微信 IM 开通手册](../staff-im-enablement.md)。

```powershell
npm --prefix staff run build
npm --prefix staff run lint
npm --prefix framework run test:staff:im
node --test server/staff-im.test.mjs
node tools/check-staff-im-ui.mjs
```

PostgreSQL 专项要求显式的可丢弃 `BANK_HTTP_TEST_DATABASE_URL`；缺少测试连接的跳过不是数据库验证通过。完整门禁为 `npm --prefix server run check:integration`，沿用四个专用数据库约束。浏览器可通过 `CHROME_PATH` 或 `CHROME_BIN` 指定已安装 Chromium。

已执行隔离 PostgreSQL、模拟微信、员工工具及浏览器验证，完整四库门禁通过。旧测试夹具的会员手续费假设等问题已经核对并修正，未改变业务收费规则；具体结果见[开发验证记录](../staff-im-development-20261021.md)。

首期值班参数、10 人接收池上限、响应时间及重试策略由代码规定；页面可修改接收人、值班时段、本人静默与加急选项。自动规则没有完整排班日历、人工重发界面或客户私密备注。真实微信登录互斥和网络投递仍须用本人账号单独验收，模拟协议验证不代表真实微信已送达。
