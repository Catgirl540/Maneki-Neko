# AI 会话 PostgreSQL 运维说明

> 2026-10-29 已上线统一环境：三类 Agent 均连接 `maneki_bank_demo`，分别使用 `customer`、`staff`、`ops` namespace。切换前两边 staff/ops 空间均为空，无需迁移历史；现有 demo 客户会话和匹配密钥保留。三类 Agent 与银行 demo 四项服务 active，详见 [统一银行环境说明](unified-bank-environment.md) 与 [部署验收](deployments/bank-unified-environment-deployment-20261029.json)。当前 systemd 配置在 `/etc/maneki-vps2/agent-*.env`，不得混用数据库或匹配密钥。下文保留原 live 三通道的历史部署及迁移细节，通用的 namespace、角色、加密与独占运行约束继续适用。

本说明覆盖客户、员工和运维 AI bridge 的会话归属、界面事件及旧会话迁移。金融数据库运行说明见 [PostgreSQL 运维手册](bank-postgresql-operations.md)。前端及静态资源不参与本次迁移。

## 存储与隔离

三类 bridge 共用 PostgreSQL 数据库 `maneki_bank` 的 `ai_sessions` schema，使用独立登录角色 `maneki_ai_session`。该角色仅有 `ai_sessions.sessions` 的查询、插入、更新权限，以及 `ai_sessions.events`、`ai_sessions.imports` 的查询、插入权限；不授予银行资金表权限、建表权限或会话事件删除权限。

| bridge 服务 | 固定 namespace | 原 SQLite 源库 |
| --- | --- | --- |
| `luckycat-bridge.service` | `customer` | `/srv/maneki-neko/framework/.dsh-home/web-context/sessions.sqlite` |
| `luckycat-staff-agent.service` | `staff` | `/var/lib/luckycat/staff-agent/web-context/sessions.sqlite` |
| `luckycat-ops-agent.service` | `ops` | `/var/lib/luckycat/ops-agent/web-context/sessions.sqlite` |

namespace 由进程的 audience 强制确定。显式设置 `LUCKYCAT_SESSION_NAMESPACE` 时必须与该进程匹配，不能给三个服务共用 `customer`。每个 namespace 由一条 PostgreSQL 会话级 advisory lock 独占；第二个同类实例会拒绝启动，不能直接按多实例方式扩容。

`ai_sessions.sessions` 保存可信归属、是否已启动、忙碌状态、事件序号及加密的旧文字上下文。归属不可修改，事件序号不能倒退。`ai_sessions.events` 保存 AES-256-GCM 加密事件，已有事件不可改、不可删；数据库保留全量新事件，网页重放缓存仍只取最近 256 条。`card-secret` 事件拒绝入库，卡密只走短时展示通道。会话对象中的银行 Bearer 不进入持久化字段。

`ai_sessions.imports` 保存源快照 SHA-256、迁入会话数、事件数和时间。原生 Harness 模型上下文仍由 Harness 日志保存；恢复完整对话还需要匹配的原生日志及上传目录，单独恢复 PostgreSQL 不等于恢复全部模型上下文。

## 配置、依赖与密钥

运行时必须配置以下变量：

| 变量 | 用途 |
| --- | --- |
| `LUCKYCAT_SESSION_DATABASE_URL` | `maneki_ai_session` 访问 `maneki_bank` 的 PostgreSQL URL |
| `LUCKYCAT_SESSION_DATA_KEY` | AI 会话专用、规范 Base64 编码的 32 字节密钥 |
| `LUCKYCAT_PG_MODULE_PATH` | 可选，已安装 `pg` 包的绝对路径；部署可指向金融后端 `server/node_modules/pg` |
| `LUCKYCAT_SESSION_NAMESPACE` | 可选，分别为 `customer`、`staff`、`ops`，必须与 audience 匹配 |

AI 密钥与银行数据密钥分开管理。密钥必须跨重启、跨发布保持不变，不能在启动脚本中每次生成。密钥缺失、格式错误或错误密钥导致解密失败时，服务拒绝继续处理；不能通过换一把新密钥“修复”已有密文。

服务器将 AI 配置保存在 root 所有、权限 `0600` 的 `pg-ai-session.env`，并由三个 unit 加载。具体绝对路径以 unit 的 `EnvironmentFiles` 为准。只检查路径，不打印变量值：

```bash
systemctl show luckycat-bridge.service luckycat-staff-agent.service luckycat-ops-agent.service -p EnvironmentFiles
```

不要把密钥或含密码的 PostgreSQL URL 放进命令行参数、日志、前端变量或工单。密钥通过受控环境文件注入；密钥备份使用独立的受控凭据存储。

独立依赖包在 `framework/bridge/pg-runtime`，锁定 `pg` 版本，未修改现有 framework 根依赖。可在已审核版本目录执行：

```bash
npm ci --omit=dev --ignore-scripts --prefix bridge/pg-runtime
```

若使用已经安装的金融后端 `pg`，则通过 `LUCKYCAT_PG_MODULE_PATH` 指向实际绝对目录；应用发布切换后必须确保此目录仍可读取。运行时没有 SQLite 回退。

## Owner 建表及授权

先由数据库管理员创建独立的 `maneki_ai_session` 登录角色，并授予 `maneki_bank` 的连接权限。角色不得拥有数据库/schema，不应继承银行应用角色或高权限角色。密码通过受控交互或凭据管理配置，不写入发布脚本。

在 framework 工作目录，由 owner 凭据执行一次 bootstrap。owner URL 只用于维护，不注入常驻 bridge：

```bash
# 通过受控环境加载 LUCKYCAT_SESSION_OWNER_DATABASE_URL、LUCKYCAT_PG_MODULE_PATH。
export LUCKYCAT_SESSION_MAINTENANCE=1
node bridge/bootstrap-session-store.mjs
unset LUCKYCAT_SESSION_MAINTENANCE
```

脚本执行 `session-schema.sql` 并授予运行角色最小权限；如果 `maneki_backup` 已存在，还会授予 schema `USAGE`、全部表及 sequence 的 `SELECT` 权限。输出 `backupRoleGranted` 必须为 `true`。若备份角色后建，可由 owner 补授：

```sql
GRANT USAGE ON SCHEMA ai_sessions TO maneki_backup;
GRANT SELECT ON ALL TABLES IN SCHEMA ai_sessions TO maneki_backup;
GRANT SELECT ON ALL SEQUENCES IN SCHEMA ai_sessions TO maneki_backup;
```

运行时不会执行 DDL。部署前应使用运行角色验证只能访问 AI schema，无法读取银行客户、支付或会计表。

## 停机迁移及源库保全

先停止三个 bridge，确认停止后制作一致的源快照。保留原库及已有 WAL/SHM 文件；迁移工具只接收不含待合并 WAL 的一致离线 SQLite 快照，不会写入或修复源库。存在非空 WAL 时先在隔离副本上生成一致快照，不要删除 WAL 以强行通过检查。

```bash
systemctl stop luckycat-bridge.service luckycat-staff-agent.service luckycat-ops-agent.service
systemctl is-active luckycat-bridge.service luckycat-staff-agent.service luckycat-ops-agent.service
```

分别记录三份一致快照的 SHA-256。源库在服务器保留，不下载客户对话数据；快照、原库和原生日志都应按原权限隔离保全。

在 framework 工作目录加载受控的 AI PostgreSQL URL、AI 密钥和 `pg` 依赖路径，逐个 namespace 运行，`--source` 使用一致快照的真实绝对路径：

```bash
export LUCKYCAT_SESSION_MAINTENANCE=1
LUCKYCAT_SESSION_NAMESPACE=customer node bridge/migrate-sessions-sqlite-to-postgres.mjs --source /absolute/snapshot/customer-sessions.sqlite
LUCKYCAT_SESSION_NAMESPACE=staff node bridge/migrate-sessions-sqlite-to-postgres.mjs --source /absolute/snapshot/staff-sessions.sqlite
LUCKYCAT_SESSION_NAMESPACE=ops node bridge/migrate-sessions-sqlite-to-postgres.mjs --source /absolute/snapshot/ops-sessions.sqlite
unset LUCKYCAT_SESSION_MAINTENANCE
```

工具要求目标 namespace 的会话与导入记录均为空，并取得同类进程独占锁。全部会话、实际保留的源事件、原始序号及导入证据在同一事务内写入；归属缺失、事件尾部不完整、卡密事件、源文件变化、目标非空等情况会拒绝导入。重复执行不会覆盖已有数据。失败输出仅包含错误代码，不打印对话、密钥或连接串。

旧 SQLite 版本原本只保留每会话最近 256 个事件。迁移保留源库实际存在的记录，不会重建旧版已经删除的事件。迁移后 PostgreSQL 不再按 256 条删除历史。

核对导入输出、源快照 SHA-256 和下列只读计数。只检查元数据，不查询解密对话：

```sql
SELECT namespace, count(*) AS sessions, count(*) FILTER (WHERE busy) AS busy
FROM ai_sessions.sessions GROUP BY namespace ORDER BY namespace;
SELECT namespace, count(*) AS retained_events
FROM ai_sessions.events GROUP BY namespace ORDER BY namespace;
SELECT namespace, source_sha256, session_count, event_count, imported_at
FROM ai_sessions.imports ORDER BY namespace, imported_at;
```

核对后加载新的 unit 环境并启动三个服务。原库保留为迁移证据，常驻服务只使用 PostgreSQL：

```bash
systemctl daemon-reload
systemctl start luckycat-bridge.service luckycat-staff-agent.service luckycat-ops-agent.service
systemctl is-active luckycat-bridge.service luckycat-staff-agent.service luckycat-ops-agent.service
```

## 中断、故障及重启

启动时，当前 namespace 上次 `busy=true` 的会话会原子标记为 `busy=false, interrupted=true`。恢复提示和 idle 事件持久化完成后才清除待恢复标志；原归属、已提交事件和原生上下文标记保留。重启不会恢复先前的一次性确认授权，旧待确认事项不能直接执行。

模型 SDK 的通知回调采用同步投影加串行持久化队列。可重放 SSE 事件只在数据库事务提交后发送；JSON 响应及 SSE 重连/回放会等待待写队列完成，消息 202 响应也须等待启动状态持久化。确认答复只有在对应事件持久化后才交回模型工具；失败时按拒绝处理。

运行期间断库、落库失败或解密失败会锁存故障，关闭事件流并对后续请求返回 `503 SESSION_STORE_UNAVAILABLE`。不要依赖数据库恢复后进程自行继续：先修复数据库连接、角色权限、磁盘或密钥配置，再重启对应 bridge。缺少数据库、依赖或密钥导致进程未启动时，反向代理可能表现为 502。

每个被忽略的 `publish()` Promise 都有内部拒绝处理器；持久化失败不会发送未提交事件。同步校验异常也转为已处理失败。关闭流、请求最外层及退出链均有失败收尾，避免异步拒绝无人处理而掩盖故障。

## 备份、恢复与回退

AI 会话与金融表位于同一个 `maneki_bank`，完整 PostgreSQL 备份应包含 `ai_sessions`，并由 `maneki_backup` 具备读取权限。备份校验与恢复演练参照 [PostgreSQL 运维手册](bank-postgresql-operations.md)。AI 密钥必须独立备份，并标明与数据库备份匹配的版本；数据库备份加银行密钥无法解密 AI 会话。

恢复前停止三个 bridge，避免恢复过程中继续写入。将 PostgreSQL、匹配的 AI 密钥、相应 Harness 原生日志和上传目录恢复到一致时间点，核对 namespace、归属及事件计数后再启动。仅恢复单个 namespace 时，必须先说明跨会话时间点及相关业务回执的影响，不能直接删除原事件以消除差异。

回退同样必须先停止写入。优先使用仍兼容 PostgreSQL schema 的上一版本后端；旧 SQLite 后端不能自动承接 PostgreSQL 中的新会话、新事件或新归属。迁移后已有新写入时，直接切回旧库会遗漏新数据。本版本不提供自动 PostgreSQL → SQLite 逆向迁移；应保全 PostgreSQL、匹配密钥及日志，制定经核对的数据处置方案后再操作。

## 验证

本地无需模型或数据库的持久化与 Promise 检查：

```bash
node --test bridge/demo-server-persistence.test.mjs bridge/session-store.test.mjs
```

真实 PostgreSQL 验证仅使用专用 `maneki_ai_sessions_test`，通过 `LUCKYCAT_SESSION_TEST_DATABASE_URL` 显式指定。测试会重建该专库的 `ai_sessions`，禁止指向真实 `maneki_bank`：

```bash
node --test bridge/session-store.test.mjs
```

验证范围包括归属不可改、namespace 隔离、同类 worker 独占、加密事件、260 条完整持久化与 256 条回放、忙碌重启恢复、错误密钥拒读、目标空维护导入、只读 SQLite 源迁移及重复导入拒绝。无需调用外部模型或发起真实支付。
