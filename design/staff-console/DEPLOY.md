# 工作人员端 · 部署与代理方案

> Phase 0 交付物 6（分工清单-ai.md）。读者：要在自己机器上跑起来的同学，以及要往服务器上放的同学。
> 约定：**客户端** = `app/`（客户手机银行），**员工端** = `staff/`（工作人员控制台），**后端** = `server/index.mjs`。

## 1. 端口分配（本地开发）

| 服务 | 目录 | 端口 | 说明 |
| --- | --- | --- | --- |
| 后端（银行 API + 员工 API + agent 通道） | `server/` | **8080** | `BANK_PORT` 可改；`/api/*` 给客户端，`/staff-api/*` 给员工端 |
| 客户端 | `app/` | **5180** | Vite 开发服务器 |
| 员工端 | `staff/` | **5181** | Vite 开发服务器，与客户端同时开、互不打架 |
| agent 演示桥（可选） | `framework/bridge/demo-server.mjs` | **8788** | 只有语音/对话演示要接 agent 时才起 |

两个前端**都代理到同一个后端 8080**，只是路径前缀不同（`/api` vs `/staff-api`）。
员工 token 与客户 token 两条通道不混用（清单 §1 / 不变量「token 分离」）。

## 2. 本地启动步骤

```bash
# 1) 后端（一个终端）
node server/index.mjs
# → [bank-server] http://127.0.0.1:8080

# 2) 客户端（另一个终端）
cd app && npm install && npm run dev        # → http://localhost:5180

# 3) 员工端（第三个终端）
cd staff && npm install && npm run dev      # → http://localhost:5181
```

演示环境变量（**演示/合练前必查**，见清单 §8）：

| 变量 | 值 | 为什么 |
| --- | --- | --- |
| `VITE_USE_MOCK`（客户端） | `false` | mock 的转账是立即到账，**挂起→审核→放行链只有真后端才有** |
| `VITE_USE_MOCK`（员工端） | `false` | 同理；不设默认走 mock（`staff/src/api/index.ts`） |
| `STAFF_AGENT_TOKEN` | 自定 | agent 通道 `X-Agent-Token` 的口令；不设时默认 `demo-agent-token` |

> 开发期前端各自默认 `VITE_USE_MOCK=true`，不需要后端也能看页面。
> 把 `false` 写进 `app/.env.local` / `staff/.env.local` 即可，别提交进仓库。

演示数据归零（开场前跑一次）：

```bash
node tools/reset-demo.mjs            # 先停掉 server，再跑
node tools/reset-demo.mjs --dry-run  # 只看它要做什么
```

## 3. Vite 代理（已写进各自的 vite.config.ts）

- `app/vite.config.ts`：`/api` → `http://127.0.0.1:8080`，`/agent-api` → `http://127.0.0.1:8788`
- `staff/vite.config.ts`：`/staff-api` → `http://127.0.0.1:8080`
- 后端地址都可用 `VITE_PROXY_TARGET` 覆盖（比如后端在别的机器上）

## 4. 上服务器：nginx 反代样例

两种放法任选其一。核心只有一件事：**`/staff-api` 必须打到后端 8080**。

### 4.1 独立站点（推荐，员工端整站单独一个域名/端口）

```nginx
# 员工端：静态文件 + /staff-api 反代
server {
  listen 8081;
  server_name staff.luckycat.example;

  root /srv/maneki-neko/staff/dist;    # npm run build 的产物
  index index.html;

  # 前端路由是 BrowserRouter，刷新深层链接要回落 index.html
  location / {
    try_files $uri /index.html;
  }

  location /staff-api/ {
    proxy_pass http://127.0.0.1:8080;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }
}

# 客户端：另一个站点（或另一个域名），/api 反代
server {
  listen 80;
  server_name luckycat.example;

  root /srv/maneki-neko/app/dist;
  index index.html;

  location / {
    try_files $uri /index.html;
  }

  location /api/ {
    proxy_pass http://127.0.0.1:8080;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }
}
```

### 4.2 同站子路径（只有 80 一个端口时用）

员工端挂在 `/staff/` 下。注意两点：

1. `staff/vite.config.ts` 加 `base: '/staff/'`，构建出来的静态资源才找得到；
2. `/staff-api` **保持根路径**，不要改成 `/staff/api`——契约里的 `routes` 表是冻结的（contract v1），
   改路径等于改契约，要走 `[contract]` 提交流程。

```nginx
server {
  listen 80;
  server_name luckycat.example;

  root /srv/maneki-neko/app/dist;

  location / {
    try_files $uri /index.html;
  }

  location /api/ {
    proxy_pass http://127.0.0.1:8080;
  }

  location /staff/ {
    alias /srv/maneki-neko/staff/dist/;
    try_files $uri $uri/ /staff/index.html;
  }

  # 员工 API 保持根路径前缀（契约冻结，别动）
  location /staff-api/ {
    proxy_pass http://127.0.0.1:8080;
  }
}
```

## 5. 上线自查（照清单 §8 的验收口径）

- [ ] `staff`、`app` 都是 `VITE_USE_MOCK=false` 构建的（mock 转账立即到账，挂起链只有真后端有）
- [ ] `/staff-api/health` 通，`/api/health` 通（或后端的 `/health`）
- [ ] 登录王小明/李主管（123456）能进；主管才看得到审计页（前端藏了，**后端 403 也要真的 403**）
- [ ] `node tools/reset-demo.mjs` 能归零（跑之前先停 server）
- [ ] 刷新深层链接（比如 `/audit`）不 404（nginx `try_files` 回落）

## 6. 已知取舍

- 员工端没有单独的生产配置文件：`VITE_PROXY_TARGET` / `BANK_PORT` 用环境变量就够，不另立配置体系。
- nginx 样例没配 HTTPS/HTTP2：比赛演示内网跑 HTTP 就行，真上线自己加证书。
- Windows 本机跑 nginx 麻烦的话，演示直接用 Vite 双端口 + node 后端即可，**不要**为此引入 Docker。
