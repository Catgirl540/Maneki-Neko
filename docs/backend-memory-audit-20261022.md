# 后端内存性能评测报告（4GB VPS OOM 分析）

- **日期**：2026-10-22
- **背景**：生产 VPS（15.235.241.158，4GB）发生 OOM 宕机，系统已重装。本文档汇总代码审计与本地消融实测结果。
- **方法**：源码审计（只读）+ 本地克隆库放大实测（54/204/504 客户、每客户 200 笔流水，按 `database.mjs` 的真实行格式直灌规范化表）。

---

## 一、结论

OOM 主因是银行服务的"全量档案投影"机制：`server/database.mjs` 的 `hydrate()` 把**全部客户档案**解密成对象常驻内存；**每个 HTTP 请求**（含纯读）都 `beginUnitOfWork` → 全量 hydrate；`commitUnitOfWork` 再 hydrate 一次，并把**所有客户的所有流水行**逐行 upsert；`server/index.mjs` 还有**每秒一次**的 `tickHolds` 扫全量档案。瞬时堆峰值约为数据集大小的 **10 倍**。流水不可删、数据集单调增长。

## 二、实测数据（本地消融）

| profile 数据集 | bank 空闲 RSS | 负载峰值 | 表现 |
| --- | --- | --- | --- |
| 4 客户（正常量） | 125 MB | 143 MB | 正常 |
| 54 户 × 200 笔（~5MB） | **356 MB** | 451 MB | GET 需 16–30s |
| 204 户（~20MB） | 382 MB | **1256 MB 不回落** | 5 并发即冲上去 |
| 504 户 × 10 万笔（~54MB） | ~900MB–1.8GB | 2GB+ | 启动 3–6 分钟、CPU 100%、/health 超时 |
| 54MB + `--max-old-space=512` | — | **8.9 秒崩** | `Reached heap limit`，栈顶 `JSON.parse` profile blob |

其他进程基线（本地实测/推断）：

| 进程 | 空闲 RSS | 备注 |
| --- | --- | --- |
| bank（server/index.mjs） | ~125–145MB | 正常量下稳定 |
| bridge / agent（demo-server.mjs） | ~84–99MB | 30 会话后 ~99MB |
| dsh 子进程（每个 agent 服务 1 个） | ~135–185MB | 30 会话 + 20 并发 turn 后 ~185MB |
| PostgreSQL | ~220MB（默认配置） | 业务连接多时 400–700MB |
| 备份/对账（瞬时） | 50–150MB × 2 | 每小时/每日错峰 |

生产进程构成：4 个 agent 服务（bridge/live + demo + staff + ops）各带 1 个 dsh 子进程 + 2 个 bank + PostgreSQL + nginx ≈ **10 个 node 进程 + PG**，基线估算 ~1.6–2.3GB。

## 三、事实清单（带证据）

### 1. 全量投影与每秒扫账

- `server/database.mjs:225-234` `hydrate()`：`SELECT * FROM app_storage` + 对每个客户 `readProfile()` 全量解密，最后 `JSON.stringify` 成 blob。
- `server/database.mjs:268` `beginUnitOfWork`：每请求一次 hydrate（读请求也跑）。
- `server/database.mjs:278-281` `commitUnitOfWork`：`persistEntries` 后再 hydrate 一次。
- `server/database.mjs:172-195` `persistEntries`：staged 里**所有客户**逐行 upsert（含全部流水 `saveTransactions`，每行 SELECT+INSERT+AES）。
- `server/database.mjs:239-241` `stage()`：把整个 profiles map 塞进 `work.profiles`。
- `server/domain/state.mjs:1780-1813` `loadDb()/persist()`：冷路径 `storage.setMany` 无条件重写整 blob（parse+stringify+parse ×3）。
- `server/bank-api.mjs:344` `exclusive`：请求串行化。
- `server/index.mjs:113-121` `setInterval(1s)` → `tickHolds`（sandbox 模式常驻）：遍历 `listAllProfiles()` 逐客户 `activateDb` + `scheduledApi.runDue`。
- `server/index.mjs:42-43`：另开 connectionDb(max=4)+telemetryDb(max=2) 池；`openBankDatabase` 默认 max=10。

### 2. Agent 服务内存结构

- `framework/bridge/demo-server.mjs:381-383`：每会话 `entry.events` ≤256 条，`assistant-update` 存累计全文快照。
- `demo-server.mjs:488-496`：sessions ≤1000/全局、50/人，仅新建时挤位，无 idle 回收。
- `session-store.mjs:86-91` `interrupted()`：重启时恢复全部中断会话（每会话解密最近 256 条事件），绕过 sessions 上限。
- `demo-server.mjs:546`：dsh 会话 `compression:'none'`；图片（≤6MB base64）/音频（≤12MB）经 stdio 进子进程。
- `deploy/demo/luckycat-agent-demo.service:17`：仅 `agent-demo` 有 `MemoryMax=650M`（父进程+dsh 子进程共享）；其余服务无内存限额。
- 所有服务未设 `--max-old-space`，Node 24 默认 old-space ~4GB/进程。

### 3. 无界/惰性数据结构

- `server/domain/index.mjs:345-346` `humanTickets`/`humanRequests`：无 TTL、无容量、无清理。
- `domain/index.mjs:466` `exchangeQuotes`：仅新请求顺带扫过期，无上限。
- profile 内 `scheduledActions`/`staffNotices`/`membership.records`：只增不减。
- 有界项：`session-store` 事件（256/会话）、SSE、`pendingConsents`/`pendingQuestions`（180s TTL）、ops-terminal（≤32 PTY、512KiB/会话、15min 空闲回收）。

### 4. 后台分类写回

- `server/domain/index.mjs:239-267` `scheduleClassification`→`applyClassification`→`persist()` 在 `exclusive` 队列外执行，向进行中事务的 staged 写入；实测中观察到 profile_bindings 被并发写覆盖。

### 5. 排除项（确认不是内存主因）

- 语音/ASR/TTS 走远端 API（OpenRouter/火山 WSS），缓冲瞬时有上限；sherpa-onnx 在 node_modules 但运行时代码未加载。
- 生产无 headless Chrome（`CHROME_PATH`/`LUCKYCAT_IM_BROWSER` 仅测试用）。
- `@deepseek-ai` 566MB 为磁盘占用；dsh 子进程实际加载 sdk-minimal + 8 个 cordis 插件。

### 6. 当前 HEAD 状态

- `server/bank-api.mjs` 的完整性断言要求 ROUTES 与 BankApi 双向对齐。赛题理财合入后，`savingsGoalSweep`/`investPlanPause`/`investPlanTerminate` 三条路由在 `server/api/contract.mjs` 与 `server/domain/index.mjs` 中缺失，HEAD **无法启动**。
- 本地工作区已补这三个实现与路由键（未提交）：boot 断言通过，server 测试 30 pass / 0 fail；`server/invest-plan.test.mjs` 的 `cancelled` 用例同步改为 `terminated`。
- `server/index.mjs` 中 `scheduledApi`/`ensureChallengeState`/`compareWealthProducts`/`payee-resolve` 等 challenge 依赖已就位。

## 四、复现材料

- 实测脚本与采样日志：`/tmp/oom-lab/`（gen-bloat.mjs、probe-blob.mjs、rss.sh/watch-rss.sh）。
- 相关文档：`deploy/single-host/README.md`、`docs/bank-deployment-*.json`、`docs/product/account-model.md`。
