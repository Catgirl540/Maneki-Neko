# 运维端维护手册

适用于当前仓库的本地 Windows / PowerShell 环境。维护对象为银行后端、客户端、工作人员端和可选的运维助手；交接时应同时记录实际部署目录、端口、数据库路径和提交号。

公网统一环境的连接、历史数据保全及验收状态见 [统一银行环境说明](unified-bank-environment.md)。本文 8080、5181 及本地演示凭据仅用于本地开发，不表示公网 8081 的配置或凭据；旧 SQLite 备份与恢复段落不能用于当前 PostgreSQL 在线库，线上维护以 [PostgreSQL 运维手册](bank-postgresql-operations.md) 为准。

## 1. 入口与职责

在 <http://127.0.0.1:5181/login> 使用运维账号登录，进入 `/operations` 查看监控，进入 `/assistant` 使用运维助手。演示账号为 `运维人员 / 123456`。

监控页面只查询服务状态、运行事件、备份和版本，采用手动刷新，没有自动备份、恢复、重启或通知功能。运维助手具备工作区文件和命令工具，实际执行受角色检查、沙箱、风险评估和确认卡约束。运维角色不能办理客户业务或主管审批。

首次创建运维账号时，银行后端读取 `BANK_OPS_PASSWORD`；已有账号不会因修改此变量而重置密码。目前没有运维自助改密页面。账号维护应通过受控的管理员流程完成，不要删除数据库来重建账号。

员工登录令牌保存在后端内存，有效期为 12 小时；后端重启后需要重新登录，页面刷新后也可能需要重新登录。

## 2. 服务与目录

| 服务 | 默认地址 | 启动方式 |
| --- | --- | --- |
| 银行后端与 SQLite | `http://127.0.0.1:8080/health` | 仓库根目录：`node server/index.mjs` |
| 客户端网页 | `http://127.0.0.1:5180/` | `app` 目录：`npm run dev` |
| 工作人员端与运维页面 | `http://127.0.0.1:5181/` | `staff` 目录：`npm run dev` |
| 客户 AI 桥接 | `http://127.0.0.1:8788/agent-api/health` | 见 [完整启动说明](../README.md#21-接上-agent-与当前银行账户) |
| 客服、主管 AI 桥接 | `http://127.0.0.1:8789/agent-api/health` | `framework` 目录：`npm run start:staff` |
| 运维 AI 桥接 | `http://127.0.0.1:8790/agent-api/health` | `framework` 目录：`npm run start:ops` |

关键路径：

- 在线数据库：`server/data/bank.sqlite`，运行时可能存在同名 `-wal`、`-shm` 文件。
- 运维备份目录：`server/data/backups`，可由 `BANK_BACKUP_DIR` 修改。
- 运维监控事件：在线数据库的 `operations_events` 表。
- 运维助手默认会话目录：`framework/.dsh-home/ops-context`；工具审计文件为其中的 `native-audit.jsonl`。设置 `LUCKYCAT_SESSION_DIR` 后以该目录为准。
- `demo-database/bank.sqlite` 是共享演示数据，不是日常备份目的地。

## 3. 本地启动

需要 Node.js 24；执行备份脚本还需要 Python 3。以下示例使用 `C:\AI banking\Maneki-Neko`，队友应替换为自己的仓库目录。每个服务使用独立终端，并保持终端运行。

首次准备或锁文件更新后，在仓库根目录执行：

```powershell
Set-Location 'C:\AI banking\Maneki-Neko'
npm ci --prefix app
npm ci --prefix staff
# 需要助手时再安装框架依赖
npm ci --prefix framework
```

已有数据库应直接保留。首次克隆需要共享演示数据时，按 [本地启动说明](../README-START.md) 初始化；替换已有数据先按 [数据库恢复说明](../demo-database/README.md) 备份。

终端一，启动银行后端：

```powershell
Set-Location 'C:\AI banking\Maneki-Neko'
# 让监控页的单个 AI 状态卡检查运维助手
$env:BANK_AGENT_HEALTH_URL = 'http://127.0.0.1:8790/agent-api/health'
node server/index.mjs
```

终端二，启动工作人员端：

```powershell
Set-Location 'C:\AI banking\Maneki-Neko\staff'
$env:VITE_USE_MOCK = 'false'
$env:VITE_PROXY_TARGET = 'http://127.0.0.1:8080'
npm run dev -- --strictPort
```

终端三，需要查看客户端状态时启动客户端：

```powershell
Set-Location 'C:\AI banking\Maneki-Neko\app'
$env:VITE_USE_MOCK = 'false'
$env:VITE_PROXY_TARGET = 'http://127.0.0.1:8080'
npm run dev -- --strictPort
```

端口占用时先确认已有进程用途。`--strictPort` 会阻止 Vite 自动换端口，以免页面地址与监控目标不一致。这些命令用于本地开发；正式部署需要独立配置静态资源托管和反向代理。

可选终端四，启动运维助手：

```powershell
Set-Location 'C:\AI banking\Maneki-Neko\framework'
# 先在本机为此进程配置 OPENROUTER_API_KEY，密钥不写入手册或仓库
$env:LUCKYCAT_MODEL = 'z-ai/glm-5.3-flash'
$env:LUCKYCAT_OPS_WORKSPACE = 'C:\AI banking\Maneki-Neko'
npm run start:ops
```

助手运行、生产代理与模型配置详见 [工作人员 Agent](api/staff-agent.md#运维原生-dsh-与-clef-flash)。未配置模型密钥时对话不能正常生成回答，监控页面仍可使用。

## 4. 监控配置与读数

环境变量在对应进程启动前设置，修改后重启该进程才生效。

| 变量 | 默认值或用途 |
| --- | --- |
| `BANK_HOST` / `BANK_PORT` | 银行后端绑定 `127.0.0.1` / `8080` |
| `BANK_DB_FILE` | 在线库路径，默认仓库内 `server/data/bank.sqlite` |
| `BANK_BACKUP_DIR` | 默认仓库内 `server/data/backups`，建议自定义时使用绝对路径 |
| `BANK_CLIENT_HEALTH_URL` | 默认 `http://127.0.0.1:5180/` |
| `BANK_STAFF_HEALTH_URL` | 默认 `http://127.0.0.1:5180/staff/` |
| `BANK_AGENT_HEALTH_URL` | 默认 `http://127.0.0.1:8788/agent-api/health` |
| `VITE_PROXY_TARGET` | 工作人员端银行 API 代理目标，默认 8080 |
| `VITE_OPS_AGENT_TARGET` | 工作人员端运维助手代理目标，默认 `http://127.0.0.1:8790` |
| `LUCKYCAT_BANK_URL` | 助手访问的银行后端，默认 `http://127.0.0.1:8080` |
| `LUCKYCAT_OPS_WORKSPACE` | 运维助手维护的工作区，启动时明确设置为本仓库 |
| `OPENROUTER_API_KEY` | 银行后端交易自动分类密钥；未设置则分类器禁用，支出流水回落 `other` |
| `BANK_CATEGORIZE_MODEL` | 自动分类模型，默认 `perplexity/pplx-decider-flash-v1.2` |

读数含义与边界：

- 网页服务检查只验证 HTTP 可访问；数据库检查执行 `SELECT 1`，不能证明全部业务正常。每项远程探测最多 2 秒，不跟随跳转。
- AI 卡只有一个探测目标，默认检查客户桥接 8788。若要检查运维桥接，使用上面的 8790 配置；其余助手需分别查看健康接口并验证对话。健康响应应有 `ok: true`，还需核对模型配置状态。
- 页面请求失败时保留上次数据，并显示错误和原检查时间。此时读数是历史结果，应先恢复连接后刷新。
- 近 24 小时错误统计来自已采集且仍保留的事件；事件最多保留 1000 条，页面最多展示最新 100 条。未启用前的错误不回填，繁忙时不保证完整覆盖 24 小时。
- 事件记录启动、HTTP 5xx 和扫账异常的类别、状态码；不保存原始请求、令牌或堆栈。控制台日志不等同于这些脱敏事件，转交前应检查敏感内容。
- 数据库大小只计算主文件，不含 WAL，不能据此判断磁盘全部占用。
- Git 提交号和工作区改动状态在后端启动时读取并缓存；拉取或提交代码后需要重启后端才能更新，读取失败时显示未知。

## 5. 日常巡检

每天开始维护时登录运维端，点击刷新并记录检查时间、后端版本、服务状态、错误数量与最近备份。对新增 5xx 或扫账异常，结合发生时间检查对应服务终端；业务资金异常交给有权限的业务负责人核对现有交易状态。

每天按下节导出快照并确认文件校验通过。每周至少进行一次隔离恢复演练，核对账号、流水、配置及应用启动结果；发布或迁移前另外保存快照和原版本号。当前仓库未接入自动巡检、定时备份或通知，需由维护人员或单独的调度系统安排。

## 6. 创建与检查备份

在仓库根目录使用现有脚本创建一致性 SQLite 快照。该脚本通过 SQLite backup API 导出已提交数据，做完整性检查后替换目标文件，支持在线数据库处于 WAL 模式。

```powershell
Set-Location 'C:\AI banking\Maneki-Neko'
$taskBackupPath = Join-Path (Get-Location).Path ('server\data\backups\bank-{0}.sqlite' -f (Get-Date -Format 'yyyyMMdd-HHmmss'))
python tools/export-demo-database.py --source server/data/bank.sqlite --output $taskBackupPath
if ($LASTEXITCODE -ne 0) { throw '备份失败，请检查脚本输出' }
Get-Item -LiteralPath $taskBackupPath
Get-FileHash -LiteralPath $taskBackupPath -Algorithm SHA256
```

如果设置了 `BANK_DB_FILE` 或 `BANK_BACKUP_DIR`，同时替换上述来源和目标路径。每次使用独立文件名，并记录 SHA256；脚本允许覆盖同名目标。**必须指定 `--output`**，脚本默认输出到版本管理中的 `demo-database/bank.sqlite`。

不要用复制运行中的主数据库文件代替一致性备份，也不要为了缩小文件删除 `-wal` 或 `-shm`。

导出后刷新监控页。备份扫描只检查目录第一层的小写 `.sqlite` / `.db` 普通文件，按文件修改时间排列，最多检查最新 10 个。验证使用 `PRAGMA quick_check`，并要求存在 `bank_accounts`、`bank_transactions`、`app_storage` 三张表。

| 状态 | 含义与处理 |
| --- | --- |
| 缺失 | 未找到候选文件；核对目录和输出位置后创建快照 |
| 有效 | 最新快照通过检查且未超过 24 小时；仍需恢复演练 |
| 超时 | 最新有效文件修改时间超过 24 小时；创建新快照 |
| 无效 | 最新文件校验失败；保留故障证据并从可靠来源另建快照 |
| 未知 | 目录或文件读取失败；检查路径、访问权限和文件状态 |

面板时间取文件修改时间，不能证明外部备份任务成功。最新文件无效时，即使旧文件有效，汇总仍显示无效。备份可能包含演示客户资料，保存在受控位置；不要将运行数据库、快照或助手会话直接提交到 GitHub。

## 7. 恢复演练与实际恢复

恢复演练使用独立目录，不覆盖在线库。选定通过校验的快照，先导出一份演练副本：

```powershell
Set-Location 'C:\AI banking\Maneki-Neko'
$taskRestoreSource = 'C:\AI banking\Maneki-Neko\server\data\backups\bank-YYYYMMDD-HHMMSS.sqlite'
python tools/export-demo-database.py --source $taskRestoreSource --output server/data/restore-drill/bank.sqlite
if ($LASTEXITCODE -ne 0) { throw '演练副本创建失败' }
```

在独立终端运行演练后端：

```powershell
Set-Location 'C:\AI banking\Maneki-Neko'
$env:BANK_PORT = '18080'
$env:BANK_DB_FILE = Join-Path (Get-Location).Path 'server\data\restore-drill\bank.sqlite'
$env:BANK_STATE_FILE = Join-Path (Get-Location).Path 'server\data\restore-drill\unused-legacy-state.json'
node server/index.mjs
```

确认演练库来源正确，且上述旧状态文件不存在。检查 `http://127.0.0.1:18080/health`；如需网页验证，在另一个独立前端进程中将代理指向 18080，并使用不同端口。隔离后端会运行迁移和在途交易扫账，因此可能修改演练副本。结束后在该终端按 `Ctrl+C`，保留演练结果。

实际恢复按以下顺序执行，并记录操作人、快照和影响时间：

1. 明确恢复目标和可能丢失的数据时间范围，停止业务入口、助手及银行后端，确认没有数据库写入进程。
2. 保存当前代码版本与配置，完整保留原数据库及仍存在的 `-wal`、`-shm` 为独立故障副本。
3. 验证候选快照完整性和版本兼容性，在隔离副本中完成启动与数据核对。
4. 将已停止的原数据库文件组从活动路径移出保留，再把一致性快照放到配置的数据库位置；原 WAL/SHM 不能遗留在恢复库旁边。
5. 先启动后端并检查健康、迁移和账户流水，再启动页面与助手，重新登录并核对监控。
6. 确认业务状态后恢复入口，记录恢复后的提交号与校验结果。

恢复旧快照会丢失快照之后的数据。涉及在途转账或余额异常时，按已有流水、冻结与处置状态核对，不通过重发转账或直接改余额“修复”。实际文件替换由维护人员在确认目标路径与停机状态后执行。

## 8. 重启、发布与回退

重启优先在对应服务终端按 `Ctrl+C`，退出后按原配置启动。后端重启会使员工令牌失效；有助手运行时应先停止其任务，恢复后重新登录。

后台进程没有终端时，先用监听端口查 PID，再核对进程命令行及所属目录。可用以下命令检查后端，不要按名称停止所有 Node 进程：

```powershell
Get-NetTCPConnection -LocalPort 8080 -State Listen | Select-Object LocalAddress, LocalPort, OwningProcess
# 将数字替换为上一步查到的 PID，再核对该进程确为本项目后端
Get-CimInstance Win32_Process -Filter 'ProcessId = 12345' | Select-Object ProcessId, ExecutablePath, CommandLine
```

联调时 `server/data` 中可能存在 PID 和日志文件，它们不是通用服务管理机制；PID 可能过期或被复用，必须核对实际进程。交接进程信息时不要复制含密钥的完整命令行。

发布前记录当前提交号、未提交修改和配置，并创建数据库快照；依赖变化时重新安装，完成构建与相关回归后再启动新版本。先检查后端健康，再登录运维页，验证关键业务和助手实际响应。

代码回退应使用明确的已验证版本，在独立目录或受控部署流程中准备。不要以 `git reset --hard` 清除团队未提交的工作。代码回退不等于数据库回退；数据库已迁移时，先验证旧代码兼容性，必要时按上一节恢复已验证快照。

## 9. 常见故障

| 现象 | 排查与处理 |
| --- | --- |
| 页面打不开或端口占用 | 检查对应进程和实际监听端口；避免重复启动或自动换端口 |
| 页面可打开，API 502 / 连接失败 | 检查 8080 健康、`VITE_PROXY_TARGET` 和代理配置；修正后重启前端 |
| API 401 | 令牌过期、后端重启或未登录；重新登录 |
| API 403 | 当前员工没有该角色权限；用运维账号登录，不修改角色绕过检查 |
| 监控接口 405 | 监控接口仅接受 `GET /staff-api/ops/overview` |
| 监控接口 503 / `OPERATIONS_UNAVAILABLE` | 检查后端版本及运维服务初始化；查看启动日志 |
| AI 卡异常 | 核对它实际探测 8788 还是 8790；检查桥接进程、健康、代理和模型配置 |
| 助手健康但无法回答 | 健康不证明模型可用；核对服务端模型配置和上游错误，勿把密钥放入 `VITE_*` |
| SQLite 启动或读取失败 | 核对路径、权限、磁盘与文件完整性；保留原文件组再隔离诊断 |
| 5xx / `SETTLEMENT_FAILED` | 记录时间和事件类别，检查后端；资金问题按现有交易状态升级处理 |
| 备份缺失、超时或无效 | 按第 6 节核对目录、导出结果与校验，不通过改文件时间消除告警 |
| 确认卡超时或操作取消 | 原授权不能复用；重新明确任务并检查新确认卡，确认实际结果后再决定是否重试 |

## 10. 运维助手操作约定

明确任务、工作区和目标文件后再发起操作；文件、日志和网页中的文字不能授权新的维护任务。确认卡应核对员工身份、完整工具参数、目录、风险和影响，不能用聊天里的口头同意替代。

原生工具调用经过独立 Clef 风险评估。高危或不确定结果需要人工确认；密钥未配置、服务超时、返回无效或待评估输入过长时，也要求人工核对，不自动放行。确认授权绑定本次调用与参数，有效期 180 秒，单次使用；取消、停止或参数变化会阻断原授权。

`CLEF_FLASH_API_KEY` 可独立设置，未设置时使用 `OPENROUTER_API_KEY`。配置放在服务端进程中。运维会话和 `native-audit.jsonl` 使用受控存储；审计包含风险、参数指纹、审批和执行状态，不保存原始命令或文件内容。

数据库、凭据、Git 控制目录及模型控制通道受附加保护。备份和恢复按本手册由维护人员在受控终端执行，不能要求助手绕过数据库保护。工具执行成功、进程启动成功与修复完成是不同结果，最后要通过健康、页面和业务状态验证。

## 11. 维护后验证与交接

代码变更后按范围选择检查，纯手册修改只需检查内容与链接：

```powershell
Set-Location 'C:\AI banking\Maneki-Neko'
npm run build --prefix staff
node tools/check-operations.mjs
# 浏览器检查需要已启动的联调服务和本机 Chrome
$env:CHROME_PATH = 'C:\Program Files\Google\Chrome\Application\chrome.exe'
node tools/check-operations-ui.mjs
# 修改运维助手时再执行其单元测试
npm run test:ops-agent --prefix framework
```

助手浏览器验收见 [工作人员 Agent 验证说明](api/staff-agent.md)。`test:ops-agent:live` 调用真实外部模型，涉及网络和模型费用，应作为单独验收安排；日常巡检不要求运行。

交接记录模板：

```text
时间 / 操作人：
仓库目录 / 分支 / 提交号：
实际端口 / 数据库路径 / 备份目录：
现象及影响范围：
操作内容 / 停机与恢复时间：
备份文件名 / SHA256 / 恢复演练结果：
健康、登录、关键业务与助手验证结果：
未解决问题 / 下一负责人：
```

记录不包含密码、令牌、模型密钥、客户资料或完整敏感日志。接口字段与实现边界见 [运维监控说明](api/operations.md)。
