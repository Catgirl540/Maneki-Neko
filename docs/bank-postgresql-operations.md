# PostgreSQL 后端运维手册

> 当前主机与配置路径：2026-10-19 已迁往 `15.235.241.158`。2026-10-29 已将官网、工作人员和运维统一到 `8081 / maneki_bank_demo`，原 `maneki_bank` 全部表留作历史保全，原 live writer 已停止、禁用并加启动防护；详见 [统一银行环境说明](unified-bank-environment.md) 与 [部署验收](deployments/bank-unified-environment-deployment-20261029.json)。下文第 1–9 节保留原 live PostgreSQL 改造的流程和部署实证；其中 `120.48.123.112`、`/etc/luckycat-bank/`、8080 及旧 service 名不能直接用于统一环境，也不能启动旧机写入服务。实际路径与定时任务见 [单机部署说明](../deploy/single-host/README.md)。

## 统一环境维护约定

统一入口继续使用现有 `maneki_bank_demo` 及其匹配的 `BANK_DATA_KEY`，不新建空库、不覆盖官网客户、余额、流水、安全状态或工单。原 `maneki_bank` 及其匹配密钥、发布和服务配置完整保全；不按相同客户 ID、员工 ID 或姓名盲目拼接两库记录。员工身份、历史工单、审计及会话如何保留或迁入，必须在部署验收中逐项记录。

| 对象 | 当前统一环境与维护要求 |
| --- | --- |
| 银行 HTTP | `luckycat-bank-demo.service`，`127.0.0.1:8081`，官网与 `/staff-api/` 共用 |
| 银行配置 | 当前 systemd 实际加载的受保护环境文件，单机配置目录为 `/etc/maneki-vps2/`；不得覆盖既有匹配密钥 |
| 运行模式 | 沿用 demo 的 `BANK_INTEGRATION_MODE=sandbox` 与匹配的非 production 配置，`BANK_AUTO_MIGRATE=false`；不能直接套用下文 live 示例 |
| AI 会话 | 同一业务库内保留 `customer`、`staff`、`ops` namespace 及各自密钥；每类进程只有一个 writer |
| 数据库连接身份 | 切换前运行 URL 使用 `maneki_owner`，本次保留现行身份，不额外迁移角色；下文最小权限角色为既定设计，不能记为当前验收事实 |
| IM | 客户与员工状态、绑定和密钥分别保留；工作人员适配器仍未启用，未来启用时另验服务鉴权及真实投递 |
| 活跃备份与对账 | 2026-10-29 切换前未发现维护 timer；若后续安装，须核对实际库名、调度及备份/应用/运维页状态文件，单独完成验收 |
| 原 live 库 | 全部表及备份保留供历史查询，writer 已停止、禁用并加启动防护，不承接统一入口新写入；双库对账通过 |

维护前先核对 systemd 的 `EnvironmentFiles`、实际进程、端口和目标库名，只输出脱敏结果；不要打印含密码的 URL 或密钥。改变配置前备份两库、Nginx、systemd 环境、AI 原生日志、上传目录及 IM 状态；停止相关 writer 后再移动会话数据，不能同时启动同一 namespace 的新旧进程。切换后的新业务继续写入统一库，回退发布或流量时不得恢复旧快照覆盖这些写入。

本文第 6.1 节的 `deploy/postgres/admin.py` 仍是原 live 专用入口：它固定检查 `luckycat-bank.service` 和 production 环境，不能用于当前 demo 服务的密码维护。仅改 `--env-file` 或停止 8080 不能证明 8081 已停止。适配维护服务检查、匹配环境与互斥锁并验证之前，不套用该节命令；账号解冻继续通过工作人员关联工单、核验身份的受审计流程办理。

适用范围：本次 PostgreSQL 16 改造，以及中国内地人民币零售场景下、合作持牌银行托管资金并执行支付的平台后端。本文取代旧版手册中的 SQLite 在线运维流程；旧库、旧部署记录和旧脚本只用于留存迁移证据，不能用于维护 PostgreSQL 在线库。前端静态文件不在本次发布范围。

当前合作银行尚未确定，商用闸门保持关闭。数据库结构和部署完成不等于已经具备银行经营资格，也不等于真实银行已接受支付、确认到账或接收监管报送。`banking` 保存银行账户关联、授权、支付意图、签名回执和对账；`accounting` 区分平台自身账与银行资金备查账；`regulatory` 保存报表定义、版本、数据血缘和校验结果。未完成机构适用性确认的科目和报表保持草稿。

## 1. 部署约定与权限

| 对象 | 约定 |
| --- | --- |
| 接入主机 | `120.48.123.112`；实际配置以末尾部署记录为准 |
| PostgreSQL | 16，连接仅限本机 Unix socket 或环回地址；禁止对公网开放 5432 |
| 后端入口 | `/srv/maneki-bank/current/server/index.mjs` |
| 业务配置及字段密钥 | `/etc/luckycat-bank/bank.env`，`root:root 0600` |
| 应用连接配置 | `/etc/luckycat-bank/pg-app.env`，`root:root 0600` |
| 所有者连接配置 | `/etc/luckycat-bank/pg-owner.env`，`root:root 0600` |
| 只读备份连接配置 | `/etc/luckycat-bank/pg-backup.env`，`root:root 0600` |
| 银行回执 worker 连接配置 | `/etc/luckycat-bank/pg-worker.env`，`root:root 0600` |
| AI 会话连接及独立密钥 | `/etc/luckycat-bank/pg-ai-session.env`，`root:root 0600` |
| 备份目录 | `/var/backups/luckycat-bank/postgresql`，`root:root 0700` |
| 运维脚本 | `/srv/maneki-bank/current/deploy/postgres/{backup,restore,check,admin}.py`，四份文件必须一起发布 |
| 后端服务 | `luckycat-bank.service`，环回 `127.0.0.1:8080` |
| 辅助服务 | `luckycat-staff-agent.service`、`luckycat-ops-agent.service`；客户 bridge 独立运行 |
| 前端 | `/var/www/maneki-neko`，本次不构建、不上传、不覆盖 |

本次数据库名为 `maneki_bank`，所有者为 `maneki_owner`，应用角色为 `maneki_app`，银行回执 worker 为 `maneki_bank_worker`，只读备份角色为 `maneki_backup`，AI 会话角色为 `maneki_ai_session`。所有者负责审核后执行初始化和结构升级；运行角色只有所需的连接、schema 使用、表 DML 与序列使用权限，没有创建数据库、创建角色或修改会计触发器的权限。回执 worker 与应用分离，按银行证据处理职责授权。AI 角色只访问 `ai_sessions`，三个 namespace 的迁移、恢复与独占运行说明见 [AI 会话 PostgreSQL 运维说明](bank-ai-session-postgresql.md)。实际授权验证结果记录在末尾。

本次备份及巡检 unit 由 Linux root 执行，使用 `pg-backup.env` 中的 `maneki_backup` 连接，以 `pg_read_all_data` 读取专用库；该连接没有业务 DML、DDL 或 `CREATEDB` 权限。所有者连接也不授予 `CREATEDB`。恢复使用另行受控的数据库管理员连接。

备份角色必须能读取 `public`、`banking`、`accounting`、`regulatory` 及 `ai_sessions`。AI bootstrap 在备份角色已存在时补授该 schema 的 `USAGE`、表与序列的 `SELECT`；新增表或 schema 后仍须重新验证全库备份权限。`pg_read_all_data` 属于广泛的数据读取权限，连接只供受控备份和巡检使用，不能注入应用或 AI 常驻进程，也不能借此取得两把字段解密密钥。

部分业务表的 `lock_version` 是权限辅助列，具有 `NOT NULL DEFAULT 0 CHECK(lock_version=0)`，只能保持为 `0`，不是递增版本号。PostgreSQL 的 `SELECT ... FOR UPDATE/SHARE` 要求至少一个列具有 `UPDATE` 权限，因此仅为需要行锁的角色授予 `UPDATE(lock_version)`，不扩大其对机构审批、风控闸门、会计政策或其他业务字段的修改权限。应用角色对应 `banking.providers`、`release_gates`、`account_links`、`consents`、`payment_intents`；worker 在其正常业务写权限之外，仅对 `providers`、`release_gates` 和 `accounting.charts` 取得该辅助列权限。维护授权时不得把列级授权替换为整表 `UPDATE`。权限依据见 [PostgreSQL SELECT 文档](https://www.postgresql.org/docs/16/sql-select.html)。

生产运行配置要求 `BANK_AUTO_MIGRATE=false`。此时银行、工作人员及合作银行模块不能在启动时建表、建索引或修改触发器；结构版本不兼容应拒绝启动。首次引导配置仅补充缺失的初始账户和阈值，已有员工账户及密码哈希保持原样。不要用运行角色临时扩大权限来绕过版本错误。

运行配置示意如下，真实值由秘密管理渠道填写，不能提交到 Git：

```dotenv
NODE_ENV=production
BANK_HOST=127.0.0.1
BANK_PORT=8080
BANK_INTEGRATION_MODE=live
BANK_DATABASE_URL=postgresql://maneki_app:SECRET@127.0.0.1:5432/maneki_bank
BANK_AUTO_MIGRATE=false
BANK_DATA_KEY=EXISTING_DATABASE_MATCHING_32_BYTE_BASE64_KEY
BANK_PG_STATUS_FILE=/var/lib/luckycat-bank/backup-status.json
```

`BANK_DATA_KEY` 必须沿用与数据匹配的值。数据库连接密码、员工初始密码、银行证书私钥和字段加密密钥分开管理。客户会话已持久化到 PostgreSQL，仍受过期及撤销规则约束；员工会话在进程内，后端重启后员工需要重新登录。不要开启多个应用写入副本，直到完成状态并发和工作人员会话共享验证。

## 2. 安装和发布检查

先安装 PostgreSQL 16 服务端及客户端，核对 `pg_dump`、`pg_restore`、`psql`、`pg_isready` 和 Python 3 可执行。使用受控管理员连接创建专用数据库、所有者、受限应用角色及回执 worker。先由所有者完成版本化初始化，再用受限角色启动 `BANK_AUTO_MIGRATE=false` 的后端。客户端主版本应匹配 16；跨版本恢复需另做兼容性演练。

```bash
pg_dump --version
pg_restore --version
psql --version
python3 --version
systemctl status postgresql --no-pager
ss -lntp '( sport = :5432 )'
systemd-analyze verify /etc/systemd/system/luckycat-bank.service
```

这些脚本接收 `BANK_DATABASE_URL`，并将它解析为子进程环境变量 `PGHOST`、`PGPORT`、`PGUSER`、`PGPASSWORD`、`PGDATABASE`；URL 和密码不会传进命令行参数或脚本报告。也可直接使用标准 `PG*` 环境变量及受限 `.pgpass`。不要将完整 URL 写在 shell 命令、工单或日志中。远程数据库连接应使用经验证的 TLS 证书和 `sslmode=verify-full`。

首次 SQLite 迁移必须在停止旧写入后，从独立、已校验的快照导入新 PostgreSQL 库，并验证客户、账户、流水、余额、历史凭证、审批、审计及匹配密钥。旧演示余额保留迁移来源标记，不能转换成真实银行托管余额。新旧数据库不能同时接收业务写入。

完成切换后验证：

```bash
systemctl start luckycat-bank.service
curl --fail --max-time 5 http://127.0.0.1:8080/health
systemctl start luckycat-staff-agent.service luckycat-ops-agent.service
systemctl is-active luckycat-bank.service luckycat-staff-agent.service luckycat-ops-agent.service luckycat-bridge.service
systemctl start luckycat-bank-reconcile.service
journalctl -u luckycat-bank-reconcile.service -n 50 --no-pager
```

如果维护时停止银行联动停止工作人员与运维 AI，必须在银行健康后显式启动并核验它们。不要对独立客户 bridge 执行不必要的启停。检查原 nginx API 转发及前端资源摘要；不修改前端资源。

## 3. 定时任务与手动备份

备份服务读取 `/etc/luckycat-bank/pg-backup.env`，unit 设置 `BANK_PG_BACKUP_DIR=/var/backups/luckycat-bank/postgresql`。systemd 的 `EnvironmentFile` 由服务管理器读取，因此文件可以保持 `root:root 0600`，应用账户不需要直接读取秘密文件。

本目录提供完整的 PostgreSQL service 和 timer 模板。安装这些文件，替换同名旧 SQLite unit；清查并移除仍指向旧脚本的历史 drop-in。先核对已填写的环境文件及目录权限：

```bash
install -d -o root -g root -m 0700 /var/backups/luckycat-bank/postgresql
install -o root -g root -m 0644 /srv/maneki-bank/current/deploy/postgres/*.service /etc/systemd/system/
install -o root -g root -m 0644 /srv/maneki-bank/current/deploy/postgres/*.timer /etc/systemd/system/
systemd-analyze verify /etc/systemd/system/luckycat-bank.service /etc/systemd/system/luckycat-bank-backup.service /etc/systemd/system/luckycat-bank-reconcile.service /etc/systemd/system/luckycat-bank-check.service
systemctl daemon-reload
```

对账 unit 使用应用环境和 PostgreSQL 版 `server/reconcile.mjs`，不再传入 `.sqlite` 路径。手动跑通备份、对账和巡检，再启用定时器。模板每小时备份一次，随机延迟最多两分钟；每日对账为 `03:15 UTC`，即北京时间 `11:15`，随机延迟最多两分钟，`Persistent=true` 补跑遗漏任务。安装后的实际调度仍需核对。

首次备份和巡检必须顺序执行：先等待备份任务退出成功、清单校验及状态发布完成，再运行巡检，最后进行恢复演练及发布验收。不能把首次备份与要求存在有效备份的巡检并行启动。

```bash
systemctl start luckycat-bank-backup.service
systemctl status luckycat-bank-backup.service --no-pager
journalctl -u luckycat-bank-backup.service -n 30 --no-pager
systemctl start luckycat-bank-check.service
systemctl enable --now luckycat-bank-backup.timer luckycat-bank-reconcile.timer
systemctl list-timers luckycat-bank-backup.timer luckycat-bank-reconcile.timer --all
```

在已经注入备份环境的受控终端，也可以运行：

```bash
python3 -B /srv/maneki-bank/current/deploy/postgres/backup.py
python3 -B /srv/maneki-bank/current/deploy/postgres/backup.py \
  --output /var/backups/luckycat-bank/postgresql/bank-UNIQUE-RELEASE.dump
```

脚本只接受备份根目录中的规范绝对路径，拒绝符号链接和已存在的同名文件。输出为 `pg_dump -Fc` 自定义压缩格式及同名 `.manifest.json`，清单记录 SHA256、字节数、快照时间、工具版本、核心及银行会计结构版本、关键表行数和分币种余额。`ai_sessions` 存在时还记录会话、事件、导入总数及三个 namespace 的数量；缺少可选 schema 的旧演练库保持兼容，部分安装的 AI schema 则拒绝通过。备份与清单共用一个导出的只读事务快照，因此在线并发写入不会导致清单与备份统计错位。未完成文件以 `.partial` 保留，不纳入正常备份。

这是整个专用数据库的逻辑备份，包含业务 schema、数据、函数和触发器；不包含 PostgreSQL 角色、`pg_hba.conf`、服务配置、数据密钥或外部证书。它没有实现 WAL 连续归档、时间点恢复或异地复制。脚本不自动删除旧备份；需要按机构批准的保留策略另外配置归档、加密、异地复制及删除审计。SHA256 用于发现文件损坏，不能替代可信保管或签名证明。

备份服务及银行主服务均设置 `BANK_PG_STATUS_FILE=/var/lib/luckycat-bank/backup-status.json`，两者必须指向同一文件。完整备份及清单校验成功后，脚本在可信父目录内原子更新 `root:bank 0640` 的脱敏状态文件，只有格式、文件名、摘要、字节数及时间，不含客户行数、连接或口令。工作人员运维页使用这个文件展示最近工具校验结果，无需访问 `root 0700` 的备份目录；状态文件存在不能代替本次重新校验或实际恢复。

PostgreSQL 官方对备份格式及恢复工具的说明见 [pg_dump](https://www.postgresql.org/docs/16/app-pgdump.html) 和 [pg_restore](https://www.postgresql.org/docs/16/app-pgrestore.html)。

## 4. 日常巡检

日常使用读取受控环境的巡检 unit；直接调用脚本时，需先通过批准的渠道注入备份连接环境：

```bash
systemctl start luckycat-bank-check.service
journalctl -u luckycat-bank-check.service -n 50 --no-pager
df -h /var/lib/postgresql /var/backups/luckycat-bank/postgresql
df -i /var/lib/postgresql /var/backups/luckycat-bank/postgresql
journalctl -u luckycat-bank.service -u luckycat-bank-backup.service -u luckycat-bank-reconcile.service --since '24 hours ago' --no-pager
```

`check.py` 检查 `pg_isready`、只读 SQL、结构及业务表可读性、历史账本借贷与余额、已过账会计凭证的借贷平衡、外键校验状态和禁用的业务触发器，范围包含 `ai_sessions`。AI 表存在时检查每个会话的 `event_seq` 等于事件最大 `seq`，无事件时应为 `0`。随后验证最新 `.dump` 的清单、SHA256、归档目录可读性以及快照年龄；默认超过两小时返回失败。`--skip-backup` 仅适用于首次备份前的安装验收，日常巡检不能使用。`--max-backup-age-hours` 应与实际备份频次一致。

巡检通过只说明本次技术检查通过。它不验证全部加密字段、完整客户操作流程、银行端实际资金、外部清算、监管受理或商用闸门。检查结果中的机构及闸门计数用于说明接入状态。

| 异常 | 处理 |
| --- | --- |
| SQL 或接口不可用、5xx 增加 | 检查受影响服务、连接池、锁等待、磁盘和结构版本，不批量停止所有 Node 进程 |
| 分录不平、余额不符、业务触发器被禁用 | 暂停相关写入并保存证据，核对银行回执及账务；禁止直接修改余额、删除分录或停用约束来消除告警 |
| 银行请求超时或回执缺失 | 先以银行参考号及幂等标识查询银行状态，不能直接生成“成功”记录或重新发起另一笔支付 |
| 备份超期、摘要错误或恢复失败 | 保留失败文件和报告，检查权限及容量，重新创建唯一命名备份；核实最后有效异地副本 |
| 磁盘或 WAL 持续增长 | 检查长事务、复制槽、归档及容量；不要删除 PostgreSQL 数据目录内文件 |

本机 timer 和日志不能代替外部告警。完成值班通知、故障分级与送达演练后，才能作为无人值守运行依据。

## 5. 恢复到隔离新库

恢复脚本始终创建全新、显式指定的 `bank_restore_...` 数据库；名称只能包含小写字母、数字和下划线。它拒绝已存在的目标、源库和维护库，不使用 `--clean`，不会删除旧库、停止生产服务、切换连接或更新 nginx。恢复连接必须是受控的恢复管理员，不能借用应用运行角色。

先取得经过审批的备份与匹配密钥；注入恢复管理员环境后执行：

```bash
python3 -B /srv/maneki-bank/current/deploy/postgres/restore.py \
  --snapshot /var/backups/luckycat-bank/postgresql/bank-VERIFIED-SNAPSHOT.dump \
  --target-database bank_restore_drill_20261015
```

本机 `maneki_owner` 没有建库权限。采用 PostgreSQL 系统账户的 peer 认证演练时，先将选定 dump 与同名清单复制到独立的 `postgres:postgres 0700` 演练目录，文件设为 `0600`；不要改变生产备份目录的权限。例如在核对唯一目录及文件名后：

```bash
install -d -o postgres -g postgres -m 0700 /var/lib/postgresql/bank-restore-20261015
install -o postgres -g postgres -m 0600 /var/backups/luckycat-bank/postgresql/bank-VERIFIED-SNAPSHOT.dump /var/lib/postgresql/bank-restore-20261015/
install -o postgres -g postgres -m 0600 /var/backups/luckycat-bank/postgresql/bank-VERIFIED-SNAPSHOT.dump.manifest.json /var/lib/postgresql/bank-restore-20261015/
runuser -u postgres -- env -u BANK_DATABASE_URL -u PGPASSWORD -u PGSERVICE \
  PGDATABASE=maneki_bank PGUSER=postgres PGHOST=/var/run/postgresql \
  python3 -B /srv/maneki-bank/current/deploy/postgres/restore.py \
  --backup-root /var/lib/postgresql/bank-restore-20261015 \
  --snapshot /var/lib/postgresql/bank-restore-20261015/bank-VERIFIED-SNAPSHOT.dump \
  --target-database bank_restore_drill_20261015
```

脚本先校验清单、SHA256 和归档目录，再从 `template0` 创建隔离库，撤销 `PUBLIC` 对该库的默认连接权限，以单事务 `pg_restore --no-owner --no-privileges --exit-on-error` 恢复；随后核对清单中行数、分币种余额及账务检查，写入唯一的 `.restore.json` 记录。恢复对象由恢复连接角色持有，原应用授权不会自动恢复。失败时保留隔离目标与记录，生产库保持原状。

演练库不能直接接入生产应用、银行 API、短信网关或定时支付任务。后续在隔离应用环境中使用匹配的 `BANK_DATA_KEY`，验证解密读取、客户及员工登录、账户与历史流水、在途审批、支付授权及回执。业务测试使用机构批准的测试账户。恢复数据仍属敏感数据，保持同等级访问控制。

### 5.1 只读解密验证

`server/verify-restored-data.mjs` 仅接受 `BANK_MAINTENANCE=1` 和 `bank_restore_...` 隔离目标，使用匹配的银行数据密钥读取全部客户档案，并使用独立 AI 密钥核验所有会话旧上下文及事件密文；只输出数量和成功状态。本次实际验证使用 `maneki_owner` 在恢复目标上取得受限的 `CONNECT`、schema `USAGE` 和表 `SELECT` 权限，并由 root 进程加载受控环境运行；没有使用 postgres peer 身份运行此验证。

后续演练可按下列模板重跑，目标应替换为已恢复并已核对的隔离库。先由管理员仅在该目标授予只读访问：

```bash
runuser -u postgres -- psql -X --no-password --dbname=bank_restore_maneki_20261015 --set=ON_ERROR_STOP=1 <<'SQL'
GRANT CONNECT ON DATABASE bank_restore_maneki_20261015 TO maneki_owner;
GRANT USAGE ON SCHEMA public, banking, accounting, regulatory, ai_sessions TO maneki_owner;
GRANT SELECT ON ALL TABLES IN SCHEMA public, banking, accounting, regulatory, ai_sessions TO maneki_owner;
SQL
```

再在 Linux root 受控终端运行以下模板。两把密钥及连接 URL 只在进程环境中传递，不出现在命令参数或输出；模板不依赖 `/tmp` 中的一次性部署脚本：

```bash
python3 -B - <<'PY'
import os, re, subprocess, sys
from urllib.parse import quote, urlsplit, urlunsplit

release = '/srv/maneki-bank/current'
sys.path.insert(0, release + '/deploy/postgres')
from admin import read_environment

target = 'bank_restore_maneki_20261015'
if not re.fullmatch(r'bank_restore_[a-z0-9_]+', target):
    raise SystemExit('Isolated restore target required')
environment = dict(os.environ)
for path in ('/etc/luckycat-bank/bank.env',
             '/etc/luckycat-bank/pg-owner.env',
             '/etc/luckycat-bank/pg-ai-session.env'):
    environment.update(read_environment(path))
connection = urlsplit(environment['BANK_DATABASE_URL'])
if connection.scheme not in ('postgres', 'postgresql'):
    raise SystemExit('Protected PostgreSQL configuration required')
environment['BANK_DATABASE_URL'] = urlunsplit((
    connection.scheme, connection.netloc, '/' + quote(target, safe=''),
    connection.query, connection.fragment))
environment.pop('LUCKYCAT_SESSION_DATABASE_URL', None)
environment['BANK_MAINTENANCE'] = '1'
environment['BANK_AUTO_MIGRATE'] = 'false'
environment['PGOPTIONS'] = '-c default_transaction_read_only=on'
result = subprocess.run(
    ['/opt/maneki-node24/bin/node', release + '/server/verify-restored-data.mjs'],
    cwd=release, env=environment, check=False)
environment.clear()
raise SystemExit(result.returncode)
PY
```

只读解密验证通过也不代表已经恢复 Harness 原生日志、上传文件、外部银行状态或完整业务服务；这些仍须单独验收。

### 5.2 恢复后的切换与清理

恢复后投产切换由独立维护流程实施：确认恢复时点，暂停写入，向合作银行核对备份之后的所有在途及终态交易，处理外部回执重放与幂等，完成权限重新授予和代码兼容检查，再由负责人批准更新连接及启动服务。数据库回退不能撤销银行已执行的付款。严禁从旧备份恢复后自动重新发送 outbox 中的支付请求。

恢复脚本不自动删除演练库。验证结束后由管理员核对目标全名、留存恢复记录及保留期限，再按批准的清理流程删除指定隔离库；不能使用批量匹配删除生产或历史数据库。

## 6. 发布、回滚与密钥

每次发布前保存新备份、旧发布指针、结构版本、权限配置摘要及银行集成版本。结构升级由数据库所有者在维护窗口执行；成功后再启动使用 `BANK_AUTO_MIGRATE=false` 的应用。优先采用向前兼容迁移，旧版应用未经验证不能连接新结构。

代码回滚只改变发布指针；数据库恢复必须经过上一节的隔离恢复与对外核对。任何恢复前，保留当前库的新备份及事故证据，核对回退期间已发生的真实银行交易。维护后检查银行、工作人员 AI、运维 AI 和独立客户 bridge 的最终状态。

字段加密密钥与数据库备份分开保管，记录快照对应的密钥标识。丢失匹配密钥后，即使 PostgreSQL 恢复成功也不能解密客户资料。当前版本不提供在线多密钥轮换；不要直接生成新值覆盖旧 `BANK_DATA_KEY`。证书、银行回执验签公钥和连接密码的变更应分别保留版本和生效时间。

旧 `tools/` 中依赖 SQLite 临时库并启动后端的检查入口已经停用，执行时以 `LEGACY_SQLITE_FIXTURE_DISABLED` 和退出码 `2` 明确拒绝。即使环境里继承了 `BANK_DATABASE_URL`，这些入口也不会启动后端。新版 PostgreSQL 测试需要通过受控环境分别注入以下三个专用隔离库连接，再在 `server` 目录执行 `npm run test:postgres`；不能使用生产连接。

| 测试环境变量 | 专用数据库 | 用途 |
| --- | --- | --- |
| `BANK_TEST_DATABASE_URL` | `maneki_test` | 核心存储、客户认证、客服与工作人员模块 |
| `BANK_CONNECT_TEST_DATABASE_URL` | `maneki_connector_test` | 银行授权回执、支付状态及会计约束 |
| `BANK_HTTP_TEST_DATABASE_URL` | `maneki_http_test` | HTTP 全流程及 live 模式关闭未接入通道 |

后两类测试会重建各自专库中的业务 schema，必须使用可丢弃的测试库。缺少相应 URL 会将相关测试标记为 `skip`；存在跳过项目不能视为完成全套 PostgreSQL 验证。前端静态构建与不依赖这些旧库的工具保持原流程。

### 6.1 密码维护与账号冻结

`deploy/postgres/admin.py` 仅接受 Linux root，读取 `bank.env` 和 `pg-app.env`，以 `bank` 系统用户执行 PostgreSQL 版 `server/admin.mjs`。密码通过无回显 TTY 输入，并仅经子进程 stdin 传递，不接收密码参数，也不把新密码放入环境或文件。支付密码为六位数字；客户登录密码至少 8 个字符，须含 ASCII 大写字母、小写字母及标点或符号，空格不计作特殊字符，最多 1024 UTF-8 字节；员工登录密码继续要求 12–20 字符。维护输入均不接受 NUL 或换行。维护在数据库事务内完成，并记录 `bank_admin_audit`。

支付密码连续输错 5 次后冻结账号，必须在工作人员端关联客户工单、核验身份后解冻。维护入口已移除 `unlock-payment`，直接调用该 Node 动作也返回 `STAFF_UNFREEZE_REQUIRED`。冻结账号的 `set-payment-password` 返回 `ACCOUNT_FROZEN`，不修改密码或错误次数；`set-customer-password` 只重置登录密码，保留账号冻结。未冻结账号重置支付密码后可清零此前未达阈值的错误次数。旧 `deploy/bank/admin.py` 是 SQLite 历史入口，不用于当前 PostgreSQL 维护，也不能绕过这些服务端检查。

先完成新备份，停止银行并确认 `MainPID=0`，再按需要选择一条命令。服务及维护脚本共用 `.maintenance.lock`，维护期间启动银行会被拒绝。脚本不会替操作者停止或启动服务。

```bash
systemctl start luckycat-bank-backup.service
systemctl stop luckycat-bank.service
systemctl show luckycat-bank.service --property=ActiveState --property=MainPID
python3 -B /srv/maneki-bank/current/deploy/postgres/admin.py set-staff-password STAFF_ID
python3 -B /srv/maneki-bank/current/deploy/postgres/admin.py set-customer-password CUSTOMER_ID
python3 -B /srv/maneki-bank/current/deploy/postgres/admin.py set-payment-password CUSTOMER_ID
systemctl start luckycat-bank-reconcile.service
systemctl start luckycat-bank.service
curl --fail --max-time 5 http://127.0.0.1:8080/health
systemctl start luckycat-staff-agent.service luckycat-ops-agent.service
systemctl is-active luckycat-bank.service luckycat-staff-agent.service luckycat-ops-agent.service luckycat-bridge.service
```

## 7. 商用接入和可用性验收

当前单机 PostgreSQL 16 适合开发、迁移及受控联调，单点故障和主机资源限制仍存在。数据库换成 PostgreSQL 不会自动建立主备、高可用、灾备、KMS、WAL 归档或容量保证。本次备份脚本也没有实现这些能力。实际 RPO 按最后有效且可恢复的独立副本计算，RTO 通过演练测量。

真实业务开放前需完成具体合作银行合同、生产接口与账户、回执验签、银行端强客户授权、联调验收及对账流程，并通过 HTTPS、隐私、恢复和事件处置等商用闸门。会计政策、科目与监管模板应由适用主体确认及版本审批。不能通过手工改闸门为通过来代替证据。本次部署后的 `commercialReady=false`；合作银行尚未确定，HTTPS 仍待域名配置和验收。

## 8. 2026-10-15 部署与恢复实证

金融 PostgreSQL 于 **2026-10-15 18:06（北京时间，UTC+08:00）** 完成切换。客户、工作人员和运维 AI 的三个 namespace 随后也完成切换，金融及 AI 持久数据统一保存于 `maneki_bank`。以下为本次自动执行与验证记录；未提供人工复核人，本记录不声称完成独立人工复核。

| 项目 | 实际结果 |
| --- | --- |
| 目标主机与操作系统 | `120.48.123.112`；Ubuntu 24.04.4 LTS |
| PostgreSQL 版本 | 16.15；安装包 `16.15-0ubuntu0.24.04.1` |
| 发布指针 | `/srv/maneki-bank/current` → `/srv/maneki-bank/releases/pg-20261015-r2` |
| 结构版本 | 核心 `2026101502`；`banking`／会计集成 `2026101504` |
| 数据库及角色 | `maneki_bank`；所有者 `maneki_owner`、应用 `maneki_app`、回执 worker `maneki_bank_worker`、备份 `maneki_backup`、AI `maneki_ai_session` 相互分离 |
| 迁移业务数据 | 10 个客户、12 个账户、49 条流水、5 张审批；55 条迁移审计，烟测后为 57 条；保留 6 条历史会计分录 |
| 余额核对 | CNY 账面余额与可用余额汇总均为 `44,632,455` 分；迁移及恢复核对一致 |
| 真实角色权限检查 | 应用角色 17 项、worker 12 项，共 29 项全部通过，包含允许操作与越权拒绝 |
| 自动测试 | 后端 65 项、AI 10 项、SSE 4 项，共 79 项通过；角色检查另计 |
| 服务状态 | 银行及客户／工作人员／运维三个 AI 服务均 `active`，认证与健康检查通过 |
| 日志检查 | 本次切换后检查窗口内，错误级 journald 未见条目 |
| 环境与备份权限 | 本次检查的 5 份 PostgreSQL／AI 环境文件为 root 所有 `0600`；备份根目录 `root:root 0700`，脱敏备份状态文件 `root:bank 0640` |
| 备份定时器 | 每小时执行，随机延迟不超过 120 秒 |
| 对账定时器 | 每日 `03:15 UTC`，即北京时间 `11:15`，另加不超过 120 秒随机延迟 |
| 前端检查 | 客户与工作人员两个 URL 均返回 `200`，前端资源摘要保持不变，见下文 |
| 商用状态 | `commercialReady=false`；合作银行未确定；HTTPS 待域名配置及验收 |

### 8.1 首次切换尝试记录

首次切换尝试中，备份和巡检并发启动，巡检先于备份完成运行，导致验收未通过并触发自动回退。该次 PostgreSQL 库保留为 `maneki_cutover_retained_20261015`。流程改为等待备份成功后再执行巡检，随后重新取得源快照、重新导入，并于上述 18:06 完成成功切换，未以失败尝试的状态直接继续投产。

金融源码及旧数据库保全目录为 `/var/backups/luckycat-bank/postgres-cutover-20261015T100611Z`；AI 源码、会话源库及迁移证据保全目录为 `/var/backups/luckycat-bank/ai-postgres-cutover-20261015T100636Z`。旧源未删除。

### 8.2 最终全库备份与恢复

| 项目 | 实际结果 |
| --- | --- |
| 备份文件 | `/var/backups/luckycat-bank/postgresql/bank-20261015T101055Z-198dcd9df191.dump` |
| 配套清单 | 上述文件名追加 `.manifest.json` |
| 快照时间 | `2026-10-15T10:10:55.231146Z`，即北京时间 `2026-10-15 18:10:55.231146` |
| 字节数 | `597351` |
| SHA256 | `d43039ea2bbe7dbc6af490ae2c6f2748220a7d7f408c00d307fe06e3023f9a36` |
| 隔离恢复数据库 | `bank_restore_maneki_20261015` |
| 恢复结果 | 成功，清单中的行数、版本及余额 inventory 全部匹配，账务检查通过 |
| 数据库恢复耗时 | `1.17` 秒；这是数据库恢复步骤的测量值，不是完整业务 RTO |
| 只读解密验证 | `server/verify-restored-data.mjs` 验证 10 个客户档案、12 个 AI 会话及全部 365 条 AI 事件，成功 |

最终备份包含金融与 AI 会话 schema；两把匹配的密钥独立保管，不包含在 dump 或清单中。该次演练证明选定快照可完成数据库及密文读取恢复，未测得完整业务服务、外部银行状态或模型原生日志的端到端恢复时间。

### 8.3 AI 会话与前端核对

| namespace | 会话 | 保留事件 |
| --- | ---: | ---: |
| `customer` | 8 | 294 |
| `staff` | 1 | 20 |
| `ops` | 3 | 51 |
| 合计 | 12 | 365 |

AI 使用独立的 `LUCKYCAT_SESSION_DATA_KEY`，不能以银行数据密钥代替；完整维护说明见 [AI 会话 PostgreSQL 运维说明](bank-ai-session-postgresql.md)。

前端未修改，核对的资源 SHA256 为 `bf23972c586c7c192ac139c60777e3c2fbf66206f1ef6acda0cac24a904e446e`。本次成功切换和验证不改变第 7 节的商用接入及高可用限制。

## 9. 2026-10-16 收尾发布与隔夜验收

2026-10-16 北京时间 09:45 再次执行巡检和对账，结果通过。银行及三类 AI 服务持续运行，隔夜检查窗口内未见错误级服务日志；定时备份正常，前端资源摘要仍与第 8 节一致。

当天将生产配置保护和最终文档发布到 `/srv/maneki-bank/releases/pg-20261016-r1`，`current` 已指向该目录。主服务模板显式声明 `BANK_INTEGRATION_MODE=live` 和 `BANK_PG_STATUS_FILE`；后端在 `NODE_ENV=production` 下缺省采用 `live`，显式设置 `sandbox` 会拒绝启动。新增模式检查及相关认证、HTTP 回归共 25 项全部通过，没有跳过。数据库结构和历史数据未再次迁移；上一 PostgreSQL 版本仍保留，回退配置位于 `/var/backups/luckycat-bank/release-20261016T015008Z`。

发布后已重新验证三类 AI 的认证健康、客户历史会话及事件读取、员工运维页、备份状态、余额一致性和只读烟测。前端源码和已部署静态资源均未修改。员工登录会话随银行进程重启失效，需要重新登录。

| 当日定时备份恢复检查 | 实际结果 |
| --- | --- |
| 备份文件 | `/var/backups/luckycat-bank/postgresql/bank-20261016T010018Z-7e6b72d32483.dump` |
| 快照时间 | `2026-10-16T01:00:18.140125Z`，即北京时间 09:00:18.140125 |
| SHA256 | `48106b7d9d3bcfff917b9ccd27cb8620a7faf339f653a6b2f2ae10eed2f3e222` |
| 全新隔离目标 | `bank_restore_maneki_20261016` |
| 恢复及解密 | 清单、账务校验通过，10 个客户档案、12 个 AI 会话、365 条事件全部验证通过 |
| 数据库恢复耗时 | 2.32 秒，仅数据库恢复步骤；未切换生产 |
| 恢复记录目录 | `/var/lib/postgresql/maneki-production-restore-drill-20261016` |

当前 `commercialReady=false`，合作银行仍未确定。真实银行支付、银行强授权派发、银行验收、可信 HTTPS 及适用会计政策审批等依赖仍按第 7 节保持未完成状态。
