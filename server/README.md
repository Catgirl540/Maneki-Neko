# 银行合作平台后端（PostgreSQL）

后端使用 PostgreSQL 16，Node.js 24 和原生异步 `pg` 连接池。`BANK_DATABASE_URL` 必填，运行入口没有 SQLite 回退。现有前端源码和静态文件保持不变；兼容路由保留，真实资金功能由服务端接入状态控制。

业务模式是中国内地人民币零售、合作持牌银行托管资金并执行支付。合作银行尚未确定，当前真实银行通道关闭：`commercialReady=false`。平台保存支付意图、授权和经验证的回执；创建支付意图不扣余额、不生成成功到账。生产包没有虚构银行适配器、模拟签名或自动放行开关。

账户模型以 [单资金账户约束](../docs/product/account-model.md) 为准：多张卡共用一个资金账户，外币是余额分区；档案 v20 保留被合并的历史账本行，禁止按卡开户和换汇开户。每个卡组织至多一张在用卡（`CARD_NETWORK_LIMIT`，先于验密与收费）；会员等级按上月日均储蓄资产评定，规则共享在 `shared/membership.mjs`，制卡费减免与换汇点差在此结算，`assetSnapshots` 为评定凭证。旧 SQLite 适配仅用于显式测试夹具，不是生产入口。

## 启动和结构部署

```bash
cd server
npm ci --omit=dev
# 通过受保护环境文件注入 BANK_DATABASE_URL、BANK_DATA_KEY 及初始化凭据
node bootstrap-postgres.mjs   # 仅数据库所有者执行结构部署
# 改用受限应用连接，设置 BANK_AUTO_MIGRATE=false
node index.mjs
```

运行时需要 `BANK_DATA_KEY`（32 字节规范 Base64，沿用迁移源的密钥），`BANK_INTEGRATION_MODE=live`，`BANK_AUTO_MIGRATE=false`。`NODE_ENV=production` 时缺省为 `live`，显式配置 `sandbox` 会拒绝启动；模拟业务仅在隔离测试环境运行。所有者、HTTP 应用、未来银行 worker、AI 会话使用独立角色。连接密码和私钥禁止写入仓库。参考 `deploy/postgres/grants.sql` 安装最小权限。

`live` 模式拒绝未接入的短信、身份核验和旧模拟资金功能；`sandbox` 仅供隔离测试，生产切换后不提供演示余额冒充银行资金。历史兼容账户标记为 `legacy_demo`，真实账户只来自 `banking.account_links` 的银行确认数据。

## 数据结构

`public` 保留加密客户档案、历史账户及流水、认证、员工工单审批和审计。`banking` 存银行准入证据、账户关联、客户授权、幂等支付意图、不可修改回执、outbox、账单和对账异常。`accounting` 提供版本科目、账簿、明细账户、借贷凭证、营业日及日结；平台财务账与银行客户资金备查账分开。`regulatory` 提供版本报表、血缘和校验记录，尚未连接监管报送接口。

科目模板 `CN-PLATFORM-DRAFT-1` 保持草稿，等待主体会计政策审批；`BANK-MEMO-1` 仅为银行资金备查账。不存在适用于所有机构、可直接宣称完整且获监管认可的通用银行科目表。

## 交易自动分类

记账时对 `category === 'other'` 的支出流水调用 OpenRouter 决策模型（`/api/alpha/decisions`）按对方户名、摘要、渠道与金额归入消费分类；`transfer`、`salary` 等明确赋值与 `businessType` 流水不参与。模型链默认 `perplexity/pplx-decider-flash-v1.2` → `respan/span-02`：每个模型最多重试 3 次，一个模型全部失败换下一个，全失败才回落 `other`。`BANK_CATEGORIZE_MODEL` 可用逗号指定首选模型（其后仍接默认回退）。无密钥、超时或响应异常不影响记账；失败结果不写缓存，下次同一商户会重新尝试。相同流水要素有进程内缓存去重。浏览器 mock 不调用付费模型，行为不变。模拟消费的分类在**后台**进行：流水先落 `other` 并标 `classificationState=pending`，分类完成后回写分类与状态（`done`/`failed`），进程重启会把未完成的接着分。门禁：`node tools/check-categorize.mjs`（纯夹具）。

## 验证

```bash
cd server
npm test
node reconcile.mjs
node smoke.mjs
```

完整 PostgreSQL 集成测试需要明确配置专用测试库：`BANK_TEST_DATABASE_URL`、`BANK_CONNECT_TEST_DATABASE_URL`（库名 `maneki_connector_test`）、`BANK_HTTP_TEST_DATABASE_URL`（库名 `maneki_http_test`）。HTTP 测试会清空专用测试库的业务 schema，禁止设置生产连接。未提供 URL 的数据库测试会跳过，不能把跳过当作验收通过。

单账户与 Agent 完整整合门禁从仓库根运行 `npm --prefix server run check:integration`。它要求以下四个连接全部明确配置（允许 `_` 加小写字母、数字的后缀），缺少配置立即失败：

| 环境变量 | 专用数据库名 |
| --- | --- |
| `BANK_TEST_DATABASE_URL` | `maneki_bank_test` |
| `BANK_CONNECT_TEST_DATABASE_URL` | `maneki_connector_test` |
| `BANK_HTTP_TEST_DATABASE_URL` | `maneki_http_test` |
| `LUCKYCAT_SESSION_TEST_DATABASE_URL` | `maneki_ai_sessions_test` |

这些库都须可丢弃，并由测试角色拥有建表、建 schema 权限。先安装 `server`、`app`、`staff`、`framework` 依赖，运行 `bash framework/scripts/link-local.sh`、`bash framework/scripts/build.sh` 和 `bash framework/scripts/bootstrap.sh`。会话测试可设置 `LUCKYCAT_PG_MODULE_PATH` 为已安装 `server/node_modules/pg` 的绝对路径，或先安装 `framework/bridge/pg-runtime` 的独立依赖。

门禁依次执行银行数据库/HTTP、Agent 桥接测试和 `tools/check-agent-http.mjs`。HTTP 夹具使用 `server/testing/http-fixture.mjs`，只重建显式指定的 `maneki_http_test`；Agent 只重建 `maneki_ai_sessions_test` 的 AI schema。验证迁移、冻结保留、原交易/凭证身份、旧 ID 写入、跨币种 FPS、手续费失败回滚、幂等重试、live 拒绝模拟业务、会话重启、角色隔离、确认卡、SSE、模型重试及图片上下文；模型上游是本机协议夹具，不产生模型 API 费用。

`server/sqlite-legacy-database.mjs` 已移除：它没有调用方且不符合现版异步事务接口。`bank-schema.sql` 仍作为只读迁移源与 SQLite 导入测试的结构依据。旧 `tools/` SQLite 集成入口保留明确拒绝，不能通过删除保护导入来启动现版后端。运维 PTY 检查另用 `node --test server/ops-terminal.test.mjs`；root 环境拒绝 PTY，相关真实终端测试会明确跳过，不能据此宣称完成终端交互验收。

`smoke.mjs` 只查询已有服务，默认 `BANK_SMOKE_BASE_URL=http://127.0.0.1:8080`，不发送短信、不开户、不转账。`/health` 和 `/ready` 表示后端技术可达性，另有 `commercialReady` 和 `bankConnection` 表明银行接入状态；员工可查询 `/staff-api/bank-connection/readiness`。

[运维手册](../docs/bank-postgresql-operations.md) · [数据库设计](../docs/bank-database-design.md)
