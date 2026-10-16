# 银行合作平台后端（PostgreSQL）

后端使用 PostgreSQL 16，Node.js 24 和原生异步 `pg` 连接池。`BANK_DATABASE_URL` 必填，运行入口没有 SQLite 回退。现有前端源码和静态文件保持不变；兼容路由保留，真实资金功能由服务端接入状态控制。

业务模式是中国内地人民币零售、合作持牌银行托管资金并执行支付。合作银行尚未确定，当前真实银行通道关闭：`commercialReady=false`。平台保存支付意图、授权和经验证的回执；创建支付意图不扣余额、不生成成功到账。生产包没有虚构银行适配器、模拟签名或自动放行开关。

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

## 验证

```bash
cd server
npm test
node reconcile.mjs
node smoke.mjs
```

完整 PostgreSQL 集成测试需要明确配置专用测试库：`BANK_TEST_DATABASE_URL`、`BANK_CONNECT_TEST_DATABASE_URL`（库名 `maneki_connector_test`）、`BANK_HTTP_TEST_DATABASE_URL`（库名 `maneki_http_test`）。HTTP 测试会清空专用测试库的业务 schema，禁止设置生产连接。未提供 URL 的数据库测试会跳过，不能把跳过当作验收通过。

`smoke.mjs` 只查询已有服务，默认 `BANK_SMOKE_BASE_URL=http://127.0.0.1:8080`，不发送短信、不开户、不转账。`/health` 和 `/ready` 表示后端技术可达性，另有 `commercialReady` 和 `bankConnection` 表明银行接入状态；员工可查询 `/staff-api/bank-connection/readiness`。

[运维手册](../docs/bank-postgresql-operations.md) · [数据库设计](../docs/bank-database-design.md)
