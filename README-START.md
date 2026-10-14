# 本地前后端启动（Windows / PowerShell）

需要 **Node.js 24**（自带 npm）。所有命令从包含 `app/`、`server/` 的仓库根目录开始。
你当前运行的目录是 `C:\AI banking\Maneki-Neko`；队友使用自己克隆的目录。

## 1. 首次准备

安装依赖，首次或依赖更新后执行：

```powershell
npm --prefix app ci
npm --prefix staff ci
```

首次克隆后，要复现共享的虚拟卡、余额和流水，再执行：

```powershell
New-Item -ItemType Directory -Force server/data | Out-Null
Copy-Item demo-database/bank.sqlite server/data/bank.sqlite
```

已有本地数据库时跳过复制，保留当前工作状态。需要替换已有数据时，先停止后端并备份，按 [数据库恢复说明](demo-database/README.md) 操作。

## 2. 终端一：启动后端

在仓库根目录运行，并保留终端：

```powershell
node server/index.mjs
```

看到 `[bank-server] http://127.0.0.1:8080` 表示启动成功。
可访问 <http://127.0.0.1:8080/health> 检查状态。SQLite 的实验功能提示不影响启动。

## 3. 终端二：启动前端

新开终端，进入同一个仓库根目录后运行：

```powershell
$env:VITE_USE_MOCK='false'
$env:VITE_PROXY_TARGET='http://127.0.0.1:8080'
npm --prefix app run dev
```

客户端登录页为 <http://127.0.0.1:5180/login>，工作人员登录页为 <http://127.0.0.1:5180/staff/login>；客户端登录页也有工作人员入口。两端共用这个前端服务，两个终端都需要保持运行。

`npm --prefix app run build` 会同时生成两端，统一产物位于 `app/dist/`，工作人员页面位于 `app/dist/staff/`。回归检查可运行 `node tools/check-unified-site.mjs`，使用临时数据库验证两端登录、同源代理和权限隔离。

## 4. 演示登录

工作人员端默认使用同一网站的 <http://127.0.0.1:5180/staff/login>，无需额外启动。需要单独开发工作人员页面时，也可运行 `npm --prefix staff run dev`，使用 5181 端口。
运维账号 `运维人员 / 123456` 可查看服务、事件、备份与版本；接口说明见 [运维监控](docs/api/operations.md)，日常维护、备份和恢复步骤见 [运维端维护手册](docs/operations-maintenance.md)。
工作人员助手入口 `/staff/assistant`，客服/主管使用 `framework` 中 `npm run start:staff`（8789），运维使用 `npm run start:ops`（8790）。运维原生 DSH 工具和 Clef Flash 风险确认的配置见 [工作人员 Agent](docs/api/staff-agent.md#运维原生-dsh-与-clef-flash)。

- 主账号：`13800138000`；另一个演示账号：`13600136000`。
- 登录密码：`123456`；支付密码：`888888`。
- 点击「获取验证码」，验证码会显示在输入框下方，再填入登录。

获取验证码失败时，先确认后端终端仍在运行、`/health` 能打开。
端口被占用时不要重复启动同一个服务；停止服务可在对应终端按 `Ctrl+C`。

上述步骤覆盖网页和 SQLite 银行业务。AI 对话服务已接同一登录账户；还需启动框架桥接服务、编译插件及配置服务端模型密钥，步骤见 [完整 README §2.1](README.md#21-接上-agent-与当前银行账户)。
