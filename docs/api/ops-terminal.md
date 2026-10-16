# 运维网页终端

入口：工作人员端 → 运维监控 → 终端。仅 `ops` 角色可访问，客服、主管、客户和 Agent 令牌均不可使用。

## 连接与会话

前端使用同源 `/staff-api/ops/terminal/sessions`，Shell 在银行后端服务所在机器运行，不在前端服务器 guga 上运行。每个标签独立，Bearer 令牌只在 HTTP 请求头中传递，不放在 URL 或模型上下文中。输入、输出及窗口尺寸通过 HTTP + SSE 传输。

| 方法 | 路径后缀 | 用途 |
|---|---|---|
| GET | 空 | 列出当前登录会话拥有的终端 |
| POST | 空 | 用 `{cols, rows}` 创建终端 |
| GET | `/:id/events?after=序号` | 读取输出、进程退出和输出截断事件 |
| POST | `/:id/input` | 输入 `{data}`，包含控制字符 |
| POST | `/:id/resize` | 调整 `{cols, rows}` |
| DELETE | `/:id` | 结束终端并回收会话 |

同一运维账号的不同登录令牌互相隔离。最多 8 个终端/账号、32 个/服务；单次输入最多 16 KiB，输出回放最多 512 KiB。断开且无操作 15 分钟后回收；令牌到期、注销或后端关闭时清理 PTY。审计记录开关与退出等会话元数据，不记录原始键入内容、输出或 Bearer 令牌。

## 启用

银行后端安装 `framework/` 依赖并以非 root 服务账号运行。配置：

```ini
BANK_OPS_TERMINAL_ENABLED=true
BANK_OPS_PASSWORD=<独立的至少12位运维密码>
# 可选：默认使用后端仓库目录和系统 Bash
BANK_OPS_TERMINAL_CWD=/srv/maneki-neko
BANK_OPS_TERMINAL_SHELL=/bin/bash
```

运维账号的数据库密码摘要必须与配置一致。`BANK_OPS_PASSWORD` 只为新数据库初始化账号，不会覆盖旧库密码；旧库需由管理员先完成凭据更新。公开演示密码 `123456` 不满足启用条件。Shell 权限等同后端服务的 Unix 用户，不额外授予 sudo；不继承模型密钥等应用环境变量。

## guga 发布

前端仍使用 `https://bank.waveflow.men/`，终端通道需要加密连接到原银行服务器。`bank.waveflow.men-app.conf` 将终端请求单独代理到 guga 的 `127.0.0.1:18080`；应由受管理的 SSH 本地转发连接原银行服务器的 `127.0.0.1:8080`，只监听回环地址。示意命令（在 guga 运行，使用已授权的 SSH 身份）：

```sh
ssh -NT -L 127.0.0.1:18080:127.0.0.1:8080 ubuntu@120.48.123.112
```

长期运行应交由服务管理器维护重连。此文档不包含或分发 SSH 私钥。终端代理必须关闭缓冲、保留 Authorization，并使用长连接超时。原裸 IP 的终端路径返回 404，避免将 Shell 输入通过公网 HTTP 传输；普通银行与员工 API 代理继续沿用原配置。

部署时同步更新银行后端、工作人员前端和两端 Nginx 配置；先验证凭据、SSH 通道和 `nginx -t`，再启用。停用时关闭功能开关并重启银行服务，现存终端会被结束。工作人员新版页面已于 2026-10-16 发布，公网终端后端仍未启用。

线上银行当前使用 PostgreSQL 异步鉴权与数据访问，本地终端实现按 SQLite 同步接口验证。正式启用前需单独适配线上接口并回归，不能用本地 `server/index.mjs` 或 `staff-api.mjs` 覆盖现有 PostgreSQL 后端；本次网页及技能发布保留了线上银行服务。

## 验证

`node --test server/ops-terminal.test.mjs` 使用内存数据库、临时工作目录及真实 PTY，覆盖权限、弱凭据拒绝、独立标签、ANSI、尺寸、Ctrl+C、断线续接、注销回收、并发限制与空闲回收。`node server/smoke.mjs`、`node tools/check-operations.mjs` 回归原业务和运维授权。
