# 公网客户演示环境

> 本页保留 2026-10-18 的原分离部署记录。2026-10-19 已将演示库与服务一起迁往新 VPS；当前配置、服务路径与回滚方式见 [单机部署说明](../single-host/README.md)。不要用以下旧配置覆盖当前环境。

`bank.waveflow.men` 客户端使用独立 sandbox，验证码显示在页面，不发送真实短信。业务仍遵循[单资金账户模型](../../docs/product/account-model.md)。员工 API 和原 `/bank/` 继续连接 live；本演示不改变其数据库、密钥或服务配置。

## 已部署位置

- 源码副本：`/srv/maneki-bank/demo-20261017`，源提交 `9f0656f`，框架依赖、profile、会话和上传目录独立。
- PostgreSQL：`maneki_bank_demo`；owner、银行应用、银行 worker、AI 会话分别使用 `maneki_demo_owner`、`maneki_demo_app`、`maneki_demo_worker`、`maneki_demo_ai`。从空库初始化演示数据，未复制 live 客户数据。
- 银行：`luckycat-bank-demo.service`，本机 `8081`。
- 客户 Agent：`luckycat-agent-demo.service`，本机 `8891`。
- 配置：`/etc/luckycat-bank-demo/{bank,agent,owner}.env`，仅 root 可读，不提交。`owner.env` 仅用于维护，不注入常驻进程。

银行配置显式使用 `NODE_ENV=development`、`BANK_INTEGRATION_MODE=sandbox`、`BANK_ALLOW_DEMO_SEED=true` 和 `BANK_AUTO_MIGRATE=false`。初始化由 owner 执行既有 `server/bootstrap-postgres.mjs` 及 AI session bootstrap，按既有 grants 模板授权；日常进程使用受限应用/AI 角色。银行与 AI 会话使用不同的随机密钥，并沿用各自持久配置。禁止将演示环境文件用于 live 服务。

## 代理与验证

原银行服务器将 [独立 Nginx 路由](../../design/deploy/maneki-bank-demo.conf) include 到对应 server 中，`/bank-demo/api/` → `8081`、`/bank-demo/agent-api/` → `8891`。guga 仅将 `/api/` 和 `/agent-api/` 上游改为这两个路径，员工、下载及静态发布保持原路由。更改后 `nginx -t` 通过才 reload。

演示客户为 `13800138000` / `123456`；点击获取验证码后按页面提示填写。验证页面验证码、登录、银行 HTTP 鉴权、Agent 建会话和流式回复；错误/过期验证码及原限流规则保持既有实现。模型密钥仍只在 Agent 服务端。

## 更新与回滚

演示目录单独更新、构建和 bootstrap；不要把 demo profile 或会话目录覆盖到 live。仅重启 `luckycat-bank-demo`、`luckycat-agent-demo`。密钥和现有演示数据必须保留。

本次代理回滚备份：guga 的 `/etc/nginx/snippets/bank.waveflow.men-app.conf.before-demo-20261017`；原服务器的 `/var/backups/luckycat-bank-demo/opencode-web.before-demo.conf`。恢复对应配置，先 `nginx -t` 再 reload 即可撤销流量切换。回滚网页代理不删除演示数据库，不回滚 live 数据。
