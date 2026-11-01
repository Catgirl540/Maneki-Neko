# 本机内网穿透（frp 中转）

目标：本机跑着的网页（`127.0.0.1:5180`）和 SSH 终端（`127.0.0.1:22`）经百度云服务器 `120.48.123.112` 的 frps 中转，让其他电脑从公网打开网页、登录本机终端。

## 拓扑

```
同事电脑 ──> http://120.48.123.112:18080 ──> frps(7000 控制) ──> 本机 frpc ──> 127.0.0.1:5180
其他电脑 ──> ssh -p 18022 bigguga@120.48.123.112 ──> frps(7000 控制) ──> 本机 frpc ──> 127.0.0.1:22
```

网页只映射一个端口：Vite 自己会把 `/api` 转到本机 8081、`/agent-api` 转到本机 8788，所以**不需要**把后端和 Agent 端口单独暴露。

SSH 走同一条 frpc 进程的另一个 proxy（`maneki-ssh`），由本机 `ssh.socket` 提供 22 端口。

## 前置：安全组

百度云该实例的安全组当前只放行 `22 / 80 / 443 / 7000`。需要新增入站规则：

- 协议 `TCP`，端口 `18080`，来源 `0.0.0.0/0`（或限定同事出口 IP）——网页。
- 协议 `TCP`，端口 `18022`，来源 `0.0.0.0/0`（**强烈建议**限定为自己的固定出口 IP）——SSH。

一次配到位可以只放行端口段 `18000-18099`（与 frps 的 `allowPorts` 保持一致），以后再加服务不用改安全组。

没开这些规则时，frp 隧道本身是通的（服务器本机 `curl 127.0.0.1:18080` 返回 200、`/dev/tcp` 读 18022 能拿到 SSH banner），但公网连接会在 TCP 握手阶段超时。

## 服务端（120.48.123.112）

frps 0.71.0 已由 systemd 管理：

- 二进制 `/usr/local/bin/frps`，unit `frps.service`
- 配置 `/etc/frps.toml`（600，含 token）：

```toml
bindPort = 7000
auth.token = "<token>"
allowPorts = [ { start = 18000, end = 18099 } ]
```

`allowPorts` 限制客户端只能占用 18000–18099；token 避免任何人连上 7000 就能占用服务器端口。改完执行 `systemctl restart frps`。

## 本机

文件在 `.generated/frp/`（已被 gitignore）：

- `frpc`：frp 0.71.0 linux amd64 客户端
- `frpc.toml`（600）：`serverAddr`、`auth.token`，两个 proxy
  - `maneki-web`：`127.0.0.1:5180` → `18080`
  - `maneki-ssh`：`127.0.0.1:22` → `18022`
- `frpc.log`：客户端日志

控制脚本：

```bash
scripts/frp-tunnel.sh start|stop|restart|status|log
```

## 从别的电脑连这台电脑的终端

两条路，A 不需要改安全组，B 需要。

**A. 服务器当跳板（现在就能用，推荐）**

```bash
ssh -J root@120.48.123.112 -p 18022 bigguga@127.0.0.1
```

`18022` 在服务器本机监听，所以先落到 `120.48.123.112` 再连 `127.0.0.1:18022` 就能穿回本机 22。写成 `~/.ssh/config`（在**你另一台电脑**上）：

```sshconfig
Host maneki-pc
  HostName 127.0.0.1
  Port 18022
  User bigguga
  ProxyJump root@120.48.123.112
```

之后 `ssh maneki-pc` 即可。

**B. 直连公网端口（需要安全组放行 18022）**

```bash
ssh -p 18022 bigguga@120.48.123.112
```

持久化（在你自己的终端里执行，需要能常驻的会话）：

```ini
# ~/.config/systemd/user/maneki-frp.service
[Unit]
Description=Maneki local frp tunnel
After=network-online.target

[Service]
Type=simple
WorkingDirectory=%h/文档/招财猫Bank
ExecStart=%h/文档/招财猫Bank/.generated/frp/frpc -c %h/文档/招财猫Bank/.generated/frp/frpc.toml
Restart=on-failure
RestartSec=5

[Install]
WantedBy=default.target
```

`systemctl --user daemon-reload && systemctl --user enable --now maneki-frp`，再执行
`sudo loginctl enable-linger "$USER"` 让它在未登录时也能运行。

## 排错

| 现象 | 原因 |
| --- | --- |
| 公网连接超时，服务器本机 `curl 127.0.0.1:18080` 正常 | 安全组没放行端口 |
| `ssh -p 18022` 超时，但服务器本机 `/dev/tcp/127.0.0.1/18022` 能读到 banner | 安全组没放行 18022 |
| `ssh -p 18022` 提示 `Connection refused` | 本机没装/没开 sshd（Ubuntu 桌面默认 `ssh.socket` 未启用，`sudo systemctl enable --now ssh.socket`） |
| `ssh -p 18022` 提示 `Permission denied (publickey,password)` | 认证失败：没配公钥或密码不对 |
| 返回 502/连接被重置 | 本机 5180 没起，或 frpc 没连上（看 `frpc.log`） |
| 返回 403 `Blocked request` | Vite 的 allowedHosts 拒绝该 Host，需要在本机 Vite 配置里放行 |
| 页面能开但接口 401 | 正常：需要登录；演示账号见 README-START |

## 安全边界

- 这是把本机演示银行暴露到公网：登录、支付密码、演示数据都可被访问，只用于临时给同事看。
- 用完执行 `scripts/frp-tunnel.sh stop`；长期开放建议在服务端加 nginx 及 Basic Auth，或改成只放行固定 IP。
- **SSH 暴露比网页更危险**：`18022` 打开后等于把这台电脑的 shell 放到公网，密码爆破会立刻开始。至少要：
  1. 用公钥登录，并把 `PasswordAuthentication no` 写进 `/etc/ssh/sshd_config.d/99-maneki.conf`；
  2. 安全组把来源限制为自己的固定 IP；
  3. 用完就 `scripts/frp-tunnel.sh stop` 或删掉安全组规则。
- 不要把 `8081`（银行后端）或 `8788`（Agent）直接映射到公网：后端没有针对公网裸露做加固。
- token 只存在于 `.generated/frp-token.txt`、`frpc.toml` 和服务器 `/etc/frps.toml`，不要提交或贴到聊天里。
