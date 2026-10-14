# 本地前后端启动（Windows / PowerShell）

需要 **Node.js 24**（自带 npm）。所有命令从包含 `app/`、`server/` 的仓库根目录开始。
你当前运行的目录是 `C:\AI banking\Maneki-Neko-main`；队友使用自己克隆的目录。

## 1. 首次准备

安装依赖，首次或依赖更新后执行：

```powershell
cd app
npm ci
cd ..
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
cd app
$env:VITE_USE_MOCK='false'
$env:VITE_PROXY_TARGET='http://127.0.0.1:8080'
npm run dev
```

浏览器打开终端显示的地址，默认 <http://localhost:5180>。两个终端都需要保持运行。

## 4. 演示登录

工作人员端运行：在 `staff/` 设置 `$env:VITE_USE_MOCK='false'` 后 `npm run dev`，打开 <http://127.0.0.1:5181>。
运维账号 `运维人员 / 123456` 可查看服务、事件、备份与版本；说明见 [运维监控](docs/api/operations.md)。
工作人员助手入口 `/assistant`，客服/主管使用 `framework` 中 `npm run start:staff`（8789），运维使用 `npm run start:ops`（8790）。运维原生 DSH 工具和 Clef Flash 风险确认的配置见 [工作人员 Agent](docs/api/staff-agent.md#运维原生-dsh-与-clef-flash)。

- 主账号：`13800138000`；另一个演示账号：`13600136000`。
- 登录密码：`123456`；支付密码：`888888`。
- 点击「获取验证码」，验证码会显示在输入框下方，再填入登录。

获取验证码失败时，先确认后端终端仍在运行、`/health` 能打开。
端口被占用时不要重复启动同一个服务；停止服务可在对应终端按 `Ctrl+C`。

上述步骤覆盖网页和 SQLite 银行业务。AI 对话服务已接同一登录账户；还需启动框架桥接服务、编译插件及配置服务端模型密钥，步骤见 [完整 README §2.1](README.md#21-接上-agent-与当前银行账户)。

## 5. 安卓客户端（Flutter）

新版安卓版位于 `mobile/`，按照 Android 设计稿使用「账户、理财、助手、我的」四个入口，直接连接银行 HTTP 与 Agent 服务。旧 `android/` Kotlin 工程保留作迁移参考。

```powershell
cd mobile
flutter pub get
flutter run --dart-define-from-file=config/public-server.json
```

当前公网接口前缀为 `http://120.48.123.112/bank`；本机模拟器联调用 `config/local-emulator.json`。构建、签名、接口维护与测试见 [Flutter 维护说明](mobile/README.md)。
