# 本地启动（Node.js 24 + PostgreSQL 16）

客户端版本见 [CLIENTS.md](CLIENTS.md)，账户关系见 [单资金账户约束](docs/product/account-model.md)。当前网页在 `app/`，员工端在 `staff/`，安卓新版为 Flutter `mobile/`。以下从仓库根目录运行，示例使用 PowerShell。

## 1. 安装依赖

```powershell
npm --prefix server ci
npm --prefix app ci
npm --prefix staff ci
```

安装并启动 PostgreSQL 16，为自己创建专用开发数据库（例如 `maneki_bank_dev`）。通过受保护的本地环境配置提供 `BANK_DATABASE_URL` 和 `BANK_DATA_KEY`；连接串不能指向公网客户库。新空库的数据密钥可用 `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"` 生成一次，保存到受保护配置。已有数据库必须沿用匹配密钥，不能重新生成覆盖。

不要把 `demo-database/bank.sqlite` 复制到 `server/data/` 作为现版服务数据库。SQLite 只作为停止写入后的历史迁移源，迁移步骤见 [PostgreSQL 运维手册](docs/bank-postgresql-operations.md)。

可选：为银行后端进程配置 `OPENROUTER_API_KEY` 启用交易自动分类（默认模型 `perplexity/pplx-decider-flash-v1.2`，可用 `BANK_CATEGORIZE_MODEL` 换）。未配置时分类器自动禁用，支出流水回落为 `other`，不发起任何付费请求。密钥不写入仓库，详见 [服务端说明](server/README.md#交易自动分类)。

## 2. 初始化隔离开发库并启动后端

确认已在当前终端加载上述专用开发连接和密钥后：

```powershell
$env:NODE_ENV='development'
$env:BANK_INTEGRATION_MODE='sandbox'
$env:BANK_ALLOW_DEMO_SEED='true'
node server/bootstrap-postgres.mjs
$env:BANK_AUTO_MIGRATE='false'
node server/index.mjs
```

结构初始化需要数据库所有者权限。日常运行应改用已授权的应用角色；权限模板及维护步骤见 [server/README.md](server/README.md)。仅全新隔离开发库可创建演示数据。已有客户库的迁移必须保留原余额、冻结、流水、凭证和匹配密钥。

`http://127.0.0.1:8080/health` 应返回 `database: "postgresql"`。`commercialReady=false` 表示真实银行通道尚未就绪，不是数据库连接失败。生产要求 `BANK_INTEGRATION_MODE=live`，不会开放模拟短信、身份核验和资金办理；不得把本节开发配置用于生产。

## 3. 启动统一网页

另开终端：

```powershell
$env:VITE_USE_MOCK='false'
$env:VITE_PROXY_TARGET='http://127.0.0.1:8080'
npm --prefix app run dev
```

客户入口为 <http://127.0.0.1:5180/login>，员工入口为 <http://127.0.0.1:5180/staff/login>。构建使用 `npm --prefix app run build`，会同时生成客户与员工页面到 `app/dist/`；两端依赖都要安装。

仅上述隔离 sandbox 演示库使用主客户 `13800138000`、另一客户 `13600136000`，登录密码 `123456`、支付密码 `888888`；短信码由页面显示。新注册客户在开户表单中自行设置支付密码，安全中心可凭原密码修改或人脸核身重置。开发员工初始账号为王小明、李主管、运维人员，未显式配置时开发密码为 `123456`。生产不创建这些默认凭据。

## 4. 启动 Agent

```powershell
npm --prefix framework ci
bash framework/scripts/link-local.sh
bash framework/scripts/build.sh
bash framework/scripts/bootstrap.sh
```

通过受保护配置提供服务端模型密钥、`LUCKYCAT_BANK_URL=http://127.0.0.1:8080`、`LUCKYCAT_SESSION_DATABASE_URL` 与独立的 `LUCKYCAT_SESSION_DATA_KEY`，再运行 `node framework/bridge/demo-server.mjs`。会话库需先由所有者执行 `framework/bridge/session-schema.sql`，运行角色只授予 AI schema 所需权限。客户、员工及运维分别使用 `customer`、`staff`、`ops` namespace；各 namespace 单实例持锁。

模型密钥不放入 `VITE_*`，AI 会话密钥不能用银行数据密钥替代。完整配置见 [AI 会话维护说明](docs/bank-ai-session-postgresql.md)。

## 5. 验证整合

按 [后端验证说明](server/README.md#验证) 准备四个专用可丢弃 PostgreSQL 测试库；禁止使用客户库。完成上述框架构建后：

```powershell
npm --prefix app run check:account-model
npm --prefix server run check:integration
npm --prefix app run build
```

整合门禁缺少任何测试连接都会失败，不将数据库测试跳过当作验收。旧 SQLite 工具入口仍会以 `LEGACY_SQLITE_FIXTURE_DISABLED` 拒绝启动。`node server/smoke.mjs` 只探测已运行服务，不写入业务。

## 6. 安卓客户端

```powershell
cd mobile
flutter pub get
flutter run --dart-define-from-file=config/local-emulator.json
```

构建、签名及接口配置见 [Flutter 维护说明](mobile/README.md)。根目录 `android/` 仅为归档提示，不能用于构建新版 App。
