# 网页银行后端（演示联调）

这个服务把当前 `BankApi` 的全部银行业务接口开放在 `/api/*`，供网页在 HTTP 模式下联调。
它复用 `app/src/api/mock/` 的虚拟银行业务规则；`framework/bridge/demo-bank.mjs`
负责把接口契约映射成路由。本入口另加随机 Bearer 会话令牌，按登录用户切换数据档案。
数据保存在本地 SQLite 数据库。账户和流水同步到 `bank_accounts`、`bank_transactions`；
虚拟银行卡有独立的 `virtual_cards` 表，完整卡号与演示安全码在
`virtual_card_secrets` 表，列表接口不会返回它们。其他演示业务档案保存在 `app_storage` 表。

## 启动

需要 Node.js 24 和 `app/` 的依赖（现场转译 TypeScript 使用其中的 `typescript`）。
Node 24 的内置 SQLite 模块目前会打印一条实验功能提示，不影响演示。

```powershell
cd app
npm ci
cd ..
node server/index.mjs
```

服务默认监听 `127.0.0.1:8080`；`GET /health` 可检查状态。数据库文件为
`server/data/bank.sqlite`，可用 `BANK_DB_FILE` 覆盖。第一次启动时若存在旧版
`server/data/demo-bank-state.json`，会自动导入 SQLite；之后以 SQLite 为准。
仓库里的 [`demo-database/`](../demo-database/README.md) 保存一份可供队友复现的
虚拟银行卡和账户状态快照；请按其中说明复制到本地运行目录。
`BANK_HOST` 和 `BANK_PORT` 可改监听地址与端口。会话令牌只存于进程内存，
重启服务后需要重新登录。

另开终端启动网页，并让 Vite 把 `/api` 代理到此服务：

```powershell
cd app
$env:VITE_USE_MOCK='false'
$env:VITE_PROXY_TARGET='http://127.0.0.1:8080'
npm run dev
```

虚拟卡支持查询、申请、锁定／解锁、换卡、设置线上与境外支付、设置单日限额，
以及验证演示支付密码后单独查看卡号和安全码。默认登录密码是 `123456`，
**支付密码是 `888888`**。申请或换卡会扣取演示工本费，并在账户里增加流水。

演示档案中尾号 8888、3366、2046 的三张卡共享一个储蓄资金账户。
换汇仅新增账户内的币种余额，账单按币种查看，不提供卡间划转。
档案 v19 会合并旧同币种卡账户，保留余额、可用余额、关联流水与历史回单快照；
外币作为独立记账分区保存，不与人民币直接加总。SQLite 兼容表的行数不是资金账户数。
卡片锁定或待激活限制卡支付，不冻结资金账户。详细约束与验证见
[账户模型](../docs/product/account-model.md)。

另有演示用户「陈嘉禾」：手机号 `13600136000`、登录密码 `123456`，账户号
`8820000000124471`，可用网页显示的演示短信码登录。她有一张已激活的银联借记卡，
可在其「银行卡」页面验证支付密码 `888888` 后查看卡号。主账号在转账页点常用收款人
「陈嘉禾」，或手输她的账户号／银行卡号并选招财猫银行，即可转账。
转账前会核对本行收款账户和户名；付款人扣款、收款人入账及两边流水在同一 SQLite
事务中提交。不存在的本行账号、错误户名、给同一账户转账和余额不足均会拒绝。
其他银行的汇款仍是演示清算：扣款流水标记为待处理，不会伪造外行用户的入账。

不要把这个入口当真实银行系统部署。它仍使用演示短信验证码、人脸票据、虚拟余额与
mock 业务规则；银行卡数据是虚构演示数据，完整卡号与安全码在本地库中以明文保存，
仅用于模拟界面流程，**不得写入真实卡数据**，
数据库仍不具备正式银行所需的清算、对账及完整审计能力。当前 Agent 的
`/agent-api/*` 仍由 `framework/bridge/demo-server.mjs` 单独提供。

独立的 HTTP 冒烟测试使用临时数据文件，不会改动上述演示状态：

```powershell
node server/smoke.mjs
```

## 查看数据库

`.sqlite` 是二进制文件，不能当文本直接打开。可运行：

```powershell
node server/inspect.mjs
node server/inspect.mjs server/data/bank-preview.md
```

第二条会生成可在编辑器中打开的 Markdown 清单。清单只显示卡尾号和业务状态；
数据库更新后需重新运行命令刷新。
