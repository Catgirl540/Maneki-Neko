# 招财猫虚拟银行 · 服务器开发交接文档

> 给「在本机跑 agent、在服务器上开发/部署」的同学。
> 目标：看完这一份就能接管，不用再问服务器上的情况。
> 维护约定：改完服务器配置/部署方式，回来更新本文档，并重新发布下载（见文末 §15）。

---

## 0. TL;DR

| 项 | 值 |
| --- | --- |
| 服务器 | `120.48.123.112`（用你的 SSH 私钥登录；服务账号是 `ubuntu`，运维用 `root`） |
| 源码仓库（**唯一真源**，带 git） | `/root/projects/Maneki-Neko` |
| 远程仓库 | `https://github.com/Catgirl540/Maneki-Neko.git` |
| 当前主分支 | `main` |
| 部署目录（**服务实际从这里跑**，无 `.git`） | `/srv/maneki-neko` |
| 前端静态产物 | `/var/www/maneki-neko/{bank,staff,docs}` |
| 数据库 | `/var/lib/luckycat/bank.sqlite`（SQLite / WAL） |
| 密钥 | `/etc/luckycat/luckycat.env`（`600 root`）——**绝不入库、绝不写进任何提交** |
| Node | `/opt/maneki-node24/bin/node`（v24.21.0，自带原生 `node:sqlite`） |

线上入口（裸 IP，域名备案中，见 §10）：

- 客户端 `http://120.48.123.112/bank/`
- 员工端 `http://120.48.123.112/staff/`
- Logo 评审站 `http://120.48.123.112/logo-review/`
- 文档下载 `http://120.48.123.112/downloads/<file>`
- `http://120.48.123.112/` 根路径是 **OpenCode Web，别动**（见 §10）

---

## 1. 项目是什么

一个「招财猫银行」虚拟银行演示项目：网页客户端 + 工作人员控制台 + AI 客服/语音通道 + 演示银行后端。数据是演示用的假数据，通过 HTTP 后端（SQLite）持久化。

技术栈：

- **客户端 `app/`**：React + Vite + Tailwind v4 + react-router。可在 `VITE_USE_MOCK=true` 下纯前端跑 mock。
- **员工端 `staff/`**：独立的 React + Vite 应用，走 `/staff-api/*`（员工 token，与客户端 token 分离）。
- **后端 `server/`**：`index.mjs`（HTTP 路由 + 会话） + `database.mjs`（SQLite 适配层） + `staff-api.mjs`（员工端 API）。银行数据其实复用 `app/src/api/mock/` 那份 TS——后端用 `framework/bridge/demo-bank.mjs` 把前端 mock 挂到 HTTP 上（`framework/tools/ts-resolve-hook.mjs` 在 Node 里现场转译）。
- **Agent / 语音 `framework/`**：`bridge/demo-server.mjs`（HTTP + SSE，接 OpenRouter 模型、豆包 TTS/ASR）。

---

## 2. 仓库与分支

```bash
# 服务器上的克隆（真源）
cd /root/projects/Maneki-Neko
git remote -v
# origin  https://github.com/Catgirl540/Maneki-Neko.git

git log --oneline -8
# d32e12a fix(tools): transfer-hold-smoke 按脚本位置推导后端入口
# e91725b feat(staff): 支持子路径部署（VITE_BASE_PATH + BrowserRouter basename）
# a43db03 fix(bridge): 定时扫账/员工端切档后还原「当前档案」
# d2a55b9 Merge branch 'codex/web-ui-refresh-20261009'
# 1cfde7e feat(staff): 工作人员端 + 大额转账「延迟到账 + 拦截窗口」
# ...
```

- 之前的功能开发在 `codex/web-ui-refresh-20261009`，**已合并进 `main`**（合并提交 `d2a55b9`）。
- 建议：新功能开分支 → 合 `main` → 部署。或在 `main` 上小步提交（当前就是这种）。
- **推送可用的凭据**（已配好，不用重新登录）：
  - repo 级 `credential.helper` = `!f() { printf "username=x-access-token\npassword=%s\n" "$(HOME=/home/opencode /home/opencode/.local/bin/gh auth token)"; }; f`
  - `git config http.version HTTP/1.1`（避免大 push 卡住）
  - `gh` 二进制在 `/home/opencode/.local/bin/gh`（不是全局），账号 `tututu-qwq`
  - 即：在服务器上 `git push origin main` 直接可用。

---

## 3. 运行架构（nginx 路由表）

所有公网入口都在 nginx 的 **`server_name 120.48.123.112`** 这个 server 块里（`/etc/nginx/sites-available/opencode-web`）。它 `include` 了几个 snippet：

| 路径 | 处理方式 | 目标 |
| --- | --- | --- |
| `/bank/` + `/bank/assets/` | 静态 `root /var/www/maneki-neko` | 客户端（构建 `base=/bank/`） |
| `/bank/api/` | 反向代理 | `127.0.0.1:8080/api/`（银行后端） |
| `/bank/agent-api/` | 反向代理（SSE，关缓冲） | `127.0.0.1:8898/agent-api/`（Agent 桥） |
| `/staff/` + `/staff/assets/` | 静态 `root /var/www/maneki-neko` | 员工端（构建 `base=/staff/`） |
| `/staff-api/` | 反向代理（**保持根前缀**，契约冻结） | `127.0.0.1:8080/staff-api/` |
| `/logo-review/` | 反向代理 | `127.0.0.1:8091/` |
| `/downloads/<file>` | `alias` | `/var/www/maneki-neko/docs/<file>` |
| `/`（根） | 反向代理 | `127.0.0.1:49374` — **OpenCode Web** |
| 其它 Host（default_server `_`） | 反向代理 | remote-terminal：`18090`（文件面板）/ `8765`（终端、ACP） |

相关文件：

- `/etc/nginx/sites-available/opencode-web`（IP 入口，include 下列 snippet）
- `/etc/nginx/snippets/maneki-neko-ip.conf`（`/bank/*`）
- `/etc/nginx/snippets/staff-console.conf`（`/staff/*`、`/staff-api/*`）
- `/etc/nginx/snippets/logo-review.conf`（`/logo-review/*`）
- `/etc/nginx/snippets/downloads.conf`（`/downloads/*`）
- `/etc/nginx/sites-enabled/waveflow-off`（waveflow 域名 444 兜底，见 §10）
- `/etc/nginx/sites-available/{waveflow,waveagent-gateway}`（已停用，保留待恢复）

---

## 4. 服务器环境

- 用户：运维用 `root`；**所有服务以 `ubuntu` 运行**；`ubuntu` 有免密 sudo（`/etc/sudoers.d/90-waveflow-ubuntu`）。
- Node：`/opt/maneki-node24/bin/node`（v24.21.0）、`npm`（11.19.0）、`pnpm`（12.10.1）。systemd unit 里都显式 `Environment=PATH=/opt/maneki-node24/bin:...`。
- 目录归属：
  - `/root/projects/Maneki-Neko` → `opencode:opencode`
  - `/srv/maneki-neko` → `ubuntu:ubuntu`
  - `/var/www/maneki-neko` → `www-data:www-data`
  - `/var/lib/luckycat` → `ubuntu:ubuntu` `750`
  - `/etc/luckycat` → `root:root` `700`
- **服务器上没有无头浏览器**，涉及 Playwright/浏览器渲染的校验脚本在本机跑不了（见 §11）。

---

## 5. 构建与部署（照抄即可）

> 约定：先改 `/root/projects/Maneki-Neko`（提交/推送），再同步到 `/srv/maneki-neko` 构建部署。

### 5.1 同步代码到运行目录

```bash
rsync -a --chown=ubuntu:ubuntu \
  --exclude='.git' --exclude='node_modules' --exclude='dist' --exclude='.env.local' \
  /root/projects/Maneki-Neko/ /srv/maneki-neko/
```

- 不加 `--delete`：`/srv` 里的 `node_modules` 要保留（且仓库里没有它）。
- 若 `/srv/maneki-neko/app/node_modules` 或 `staff/node_modules` 不存在，先分别 `npm ci`。

### 5.2 构建并发布客户端（`/bank/`）

```bash
cd /srv/maneki-neko/app
VITE_BASE_PATH=/bank/ VITE_API_BASE_URL=/bank VITE_AGENT_URL=/bank/agent-api npm run build
rsync -a --delete /srv/maneki-neko/app/dist/ /var/www/maneki-neko/bank/
chown -R www-data:www-data /var/www/maneki-neko/bank
```

### 5.3 构建并发布员工端（`/staff/`）

```bash
cd /srv/maneki-neko/staff
VITE_BASE_PATH=/staff/ VITE_USE_MOCK=false npm run build
rsync -a --delete /srv/maneki-neko/staff/dist/ /var/www/maneki-neko/staff/
chown -R www-data:www-data /var/www/maneki-neko/staff
```

> 员工端 `base` 由 `staff/vite.config.ts` 的 `VITE_BASE_PATH` 决定，路由 basename 用 `import.meta.env.BASE_URL`。
> 员工 API 是**根路径** `/staff-api`（契约冻结，别改 `/staff/api`）。

### 5.4 重启服务 / 重载 nginx

```bash
systemctl restart luckycat-bank.service luckycat-bridge.service   # 后端/桥接有代码改动时
nginx -t && systemctl reload nginx                                # 只改了 nginx 时
```

### 5.5 备份数据库（改库/迁移前）

```bash
/opt/maneki-node24/bin/node -e "const {DatabaseSync}=require('node:sqlite'); \
  new DatabaseSync('/var/lib/luckycat/bank.sqlite').exec(\"VACUUM INTO '/root/bank.bak.sqlite'\")"
```

### 5.6 演示数据归零

```bash
systemctl stop luckycat-bank.service
cd /srv/maneki-neko
BANK_DB_FILE=/var/lib/luckycat/bank.sqlite /opt/maneki-node24/bin/node tools/reset-demo.mjs
systemctl start luckycat-bank.service
```

> `reset-demo.mjs` 认 `BANK_DB_FILE`；**不设这个变量它会删 `server/data/bank.sqlite`（不是线上库）**。一定要带路径。

---

## 6. 服务与 systemd

| 服务 | 作用 | 监听 | 入口 | 启动文件 |
| --- | --- | --- | --- | --- |
| `luckycat-bank.service` | 银行后端（客户端 + 员工 API + 大额挂起） | `127.0.0.1:8080` | `/bank/api` `/staff-api` | `/srv/maneki-neko/server/index.mjs` |
| `luckycat-bridge.service` | Agent/语音桥（SSE） | `127.0.0.1:8898` | `/bank/agent-api` | `/srv/maneki-neko/framework/bridge/demo-server.mjs` |
| `logo-review.service` | Logo 评审站（零依赖 Node） | `127.0.0.1:8091` | `/logo-review/` | `/srv/maneki-neko/design/logo-review/server.mjs` |

- unit 文件：`/etc/systemd/system/{luckycat-bank,luckycat-bridge,logo-review}.service`。
- 环境变量：`luckycat-bridge.service` 用 `EnvironmentFile=/etc/luckycat/luckycat.env`；`luckycat-bank` 只用 systemd 里那条 `BANK_DB_FILE`。
- 日志：`journalctl -u luckycat-bank.service -f`（同理 bridge / logo-review）。
- 银行后端启动日志会打印「大额延迟到账：阈值 ¥5000.00，窗口 300s」，可用来确认新代码已加载。

---

## 7. 配置与密钥

密钥**只在** `/etc/luckycat/luckycat.env`（`600 root`），键名如下（值请自己看服务器，勿外传）：

```
OPENROUTER_API_KEY
VOLC_APP_ID  VOLC_ACCESS_TOKEN            # 豆包语音（多 Key 方式）
LUCKYCAT_VOLC_API_KEY                     # 豆包语音（单 Key 方式，X-Api-Key）
LUCKYCAT_VOLC_APP_ID  LUCKYCAT_VOLC_RESOURCE
LUCKYCAT_PROVIDER  LUCKYCAT_MODEL  LUCKYCAT_ASR_MODEL
LUCKYCAT_DEMO_PORT  LUCKYCAT_CONSENT_URL  LUCKYCAT_QUESTION_URL
```

- 客户端产物的 API 地址是**构建期**注入的（`VITE_API_BASE_URL` / `VITE_AGENT_URL`），不是运行时 .env。
- 任何新增密钥：写进 `/etc/luckycat/luckycat.env` 并视情况在 unit 里 `EnvironmentFile`，**不要**写进仓库或前端 bundle。

---

## 8. 数据库

- 文件：`/var/lib/luckycat/bank.sqlite`（`ubuntu:ubuntu` `600`，WAL 模式）。
- 表：
  - `app_storage(key, value_json, updated_at)`：存演示档案 JSON。
    - `luckycat.mock.db` = **当前激活档案**（“current”）
    - `luckycat.luckycat.mock.user-profiles.v1` = 全部用户档案（key=手机号）
  - `virtual_cards` / `virtual_card_secrets`：虚拟卡。
  - `bank_accounts(owner_id,id,account_no,label,currency,balance_cents,available_cents)`。
  - `bank_transactions(...)`，含列 `pending_reason`（大额挂起用），并有 `idx_bank_transactions_account_time`。
- **约束（很重要）**：`bank_accounts` 有 `CHECK(balance_cents >= 0)` 和 `CHECK(available_cents >= 0)`，`bank_transactions.amount_cents > 0`。
  → **不支持负余额/透支**。若要「透支」类功能，必须改 schema + 前端展示，属于功能开发。
- **当前档案（current）语义**：`app_storage['luckycat.mock.db']` 是“当前登录档案”。**未登录的**短信/登录请求正是读写它（验证码 `pendingSms` 存在当前档上）。
  → 任何后台任务/员工操作只要「切过档」，**必须还原当前档**，否则未登录请求会串档（表现为 `SMS_NOT_SENT`）。这是 `a43db03` 修的坑（`tickHolds` + 员工端 `getHeldTransfer`/`settleHeldTransfer`）。
- **直接改库会被覆盖**：运行中的 bank 服务把内存档案 flush 回库。要改库，**先停服务再改再启**（或用 API）。
- 迁移：`server/database.mjs` 启动时做（`pending_reason` 列、卡片 owner 从手机号迁到 user id、账号/流水表从 JSON 补齐）。改 schema 请在此文件里加迁移，并在 §5.5 先备份。

---

## 9. 演示账号

| 端 | 账号 | 密码 | 备注 |
| --- | --- | --- | --- |
| 客户端 | `13800138000` 林小满 | `123456` | 默认金卡用户 |
| 客户端 | `13600136000` 陈嘉禾 | `123456` | 演示收款人 |
| 客户端 | `15608181912` 扫福瑞 | `123456` | |
| 客户端 | `18870768277` 黑格调 | 本人自设（非 `123456`） | 自行注册 |
| 客户端 | 支付密码 | `888888` | |
| 员工端 | `王小明`（csr） / `李主管`（supervisor） | `123456` | 主管才看得到审计页 |

- 登录需**先取短信验证码**（演示会回传 `demoCode`）。
- 员工端登录：`POST /staff-api/login {name,password}`。

---

## 10. nginx 注意事项 + waveflow 域名

- **`location /` 是 OpenCode Web，别占根路径**。本项目一律走子路径（`/bank/`、`/staff/` …）。
- nginx `reload` 后，**第一次 curl 可能命中旧 worker** → 偶发失败，重试即可。
- 从本机 `curl 127.0.0.1` 测站点时，**必须带 `-H 'Host: 120.48.123.112'`**，否则会落到 `default_server`（remote-terminal）。
- 中文别用 curl 发（会 GBK 乱码），用 Node `fetch`（参考 `tools/*.mjs`）。Logo 评审站的上传：raw body + 查询参数 `?title=&by=`（中文要 URL 编码）。

### waveflow.cn 域名（重新备案中，已断开）

`waveflow.cn` / `www.waveflow.cn` / `agent.waveflow.cn` 仍解析到本机，但已**不对外提供内容**：

- 停用了 `/etc/nginx/sites-enabled/waveflow`、`/etc/nginx/sites-enabled/waveagent-gateway`；
- 新增 `/etc/nginx/sites-enabled/waveflow-off`（对三个主机名 `return 444`），防止落到默认站点继续对外服务。
- 验证：`curl -H 'Host: waveflow.cn' http://127.0.0.1/` 应为连接关闭（`000`）。

**恢复**（备案通过后）：

```bash
rm /etc/nginx/sites-enabled/waveflow-off
ln -s /etc/nginx/sites-available/waveflow          /etc/nginx/sites-enabled/waveflow
ln -s /etc/nginx/sites-available/waveagent-gateway /etc/nginx/sites-enabled/waveagent-gateway
nginx -t && systemctl reload nginx
```

---

## 11. 测试与校验

在本机拉不到无头浏览器时，优先跑这些**不依赖浏览器**的脚本（都在 `tools/`，用 Node 24）：

```bash
cd /srv/maneki-neko
/opt/maneki-node24/bin/node tools/check-agent-http.mjs       # 期望：ALL PASS（fixture 驱动，不花模型钱）
/opt/maneki-node24/bin/node tools/transfer-hold-smoke.mjs    # 期望：47 通过 / 0 失败（延迟到账/拦截/撤销/自动到账/审计）
```

- 这俩会**自己拉起临时后端**（独立端口 + 临时库），不碰线上库。
- `tools/check-agent-http.mjs` 覆盖：Agent HTTP 登录/会话归属、确认卡→HTTP 工具→SSE、验密后入账、令牌与支付密码不进模型请求。
- `tools/transfer-hold-smoke.mjs` 覆盖：小额不进窗口 / 大额冻结 / 撤销 / 员工拦截（枚举理由）/ 立即到账 / 窗口到点自动到账 / 角色与重复处置校验 / 审计留痕。
- 其它 `tools/check-*.mjs` 很多是**浏览器/UI** 校验，服务器上没浏览器，需在本机或装了 Playwright 的环境跑。
- 改了前端，请**同时在本机浏览器**过一遍 `/bank/`、`/staff/`（尤其桌面模式、移动端导航）。

---

## 12. 关键决策与近期改动

- **子路径部署**：客户端 `base=/bank/`（`VITE_BASE_PATH`），`BrowserRouter basename=import.meta.env.BASE_URL`；员工端 `base=/staff/`。`VITE_BASE_PATH` 在 `app/vite.config.ts`、`staff/vite.config.ts` 里读取。
- **桌面模式适配**：`lg` 断点从 1024px 降到 **960px**（`app/src/styles/tokens.css` 的 `--breakpoint-lg: 60rem`），让 Chromium-Android「桌面版网站」（~980px）命中桌面布局；iOS Safari 桌面模式只改 UA，`app/index.html` 里有内联脚本对桌面 UA 设 `viewport width=980`。
- **语音栈**：Agent = OpenRouter `qwen/qwen3.8-flash`；ASR = `qwen/qwen3-asr-0.6b`；TTS = 豆包 `seed-tts-2.0`（单 Key `X-Api-Key`，见 `framework/bridge/volc-stream.mjs`）。
- **转账改为 4 步**：付款 → 收款 → 确认 → 完成（`app/src/pages/TransferPage.tsx`），并精简了各页标题说明文案。
- **大额转账「延迟到账 + 拦截窗口」**（main 新增，`1cfde7e`）：≥ 阈值的转账先冻结先进在途窗口，员工端可拦截，窗口到点自动放行，用户可撤销。阈值/窗口可用 env 调：`BANK_TRANSFER_REVIEW_CENTS`（默认 500000 = ¥5000）、`BANK_TRANSFER_HOLD_SECONDS`（默认 300s）。
- **员工端**（`staff/`，main 新增）：`/staff/` 子路径部署；`/staff-api/*` 与客户端 `/api/*` 同进程、token 分离。
- **Logo 评审站**：零依赖 Node（`design/logo-review/server.mjs`），数据在 `/var/lib/logo-review/`，支持每图评论 + 上传 + 投票。
- **近期修复**（都已推送 `main`）：
  - `a43db03`：后台扫账/员工端切档后**还原当前档案**，修 fresh 库上短信/登录串档。
  - `e91725b`：员工端子路径部署支持。
  - `d32e12a`：`transfer-hold-smoke.mjs` 去掉写死的本机绝对路径。

---

## 13. 已知坑（踩过的，别再踩）

1. **别动 nginx 根 `location /`**（那是 OpenCode Web）。
2. 改库前先停 `luckycat-bank`；运行中直改会被内存 flush 覆盖。
3. `bank_accounts` 有 `CHECK >= 0` —— **没有透支能力**。
4. 未登录请求依赖“当前档案”，后台切档后**必须还原**（§8）。
5. 员工 API 路径是 `/staff-api`（根前缀），**不是** `/staff/api`。
6. `reset-demo.mjs` 不设 `BANK_DB_FILE` 会删错库。
7. reload 后首个请求可能命中旧 worker；本机 curl 要带 `Host` 头。
8. `gh` 在 `/home/opencode/.local/bin/gh`，不在 PATH；推送靠 repo 级 credential helper。
9. Node 用 `/opt/maneki-node24/bin/node`（系统 node 版本可能不够）。
10. 部署 `rsync` 记得 `--chown=ubuntu:ubuntu`，并 `--exclude node_modules`（不要删掉它）。

---

## 14. 待办 / 路线图

- 功能差距与优先级见 `design/review/FEATURE-GAP.md`（含现金流/透支、计息引擎等缺口）。
- 已知未做：**黑格调「透支 1 万亿」**（用户明确选择暂不做；需先给演示银行加负余额能力）。
- 域名 `waveflow.cn` 重新备案中；通过后按 §10 恢复站点。
- 员工端还有占位页（`staff/src/pages/PlaceholderPages.tsx`：Customers/Actions/Audit 等）。

---

## 15. 关键文件索引

```
/root/projects/Maneki-Neko/            # 源码（真源）
  app/                                 # 客户端（React/Vite），base=/bank/
    vite.config.ts                     #   读 VITE_BASE_PATH
    index.html                         #   桌面模式 viewport 内联脚本
    src/styles/tokens.css              #   --breakpoint-lg: 60rem
    src/pages/TransferPage.tsx         #   4 步转账 + 在途倒计时/撤销
    src/api/mock/                      #   前端 mock（后端也复用这份 TS）
  staff/                               # 员工端（React/Vite），base=/staff/
  server/
    index.mjs                          #   银行后端入口（路由/会话/staffApi）
    database.mjs                       #   SQLite 适配 + 迁移
    staff-api.mjs                      #   员工端 API
  framework/
    bridge/demo-bank.mjs               #   把前端 mock 挂到 HTTP（含挂起/扫账）
    bridge/demo-server.mjs             #   Agent/语音桥（SSE）
    bridge/volc-stream.mjs             #   豆包流式 TTS/ASR
  tools/
    check-agent-http.mjs               #   Agent HTTP 全链校验（无浏览器）
    transfer-hold-smoke.mjs            #   大额延迟到账全链冒烟
    reset-demo.mjs                     #   演示数据归零
  design/
    review/FEATURE-GAP.md              #   功能差距与优先级
    staff-console/DEPLOY.md            #   员工端部署说明
    logo-review/                       #   Logo 评审站（server.mjs + index.html + img/）

/etc/luckycat/luckycat.env             # 密钥（600）
/etc/nginx/sites-available/opencode-web
/etc/nginx/snippets/{maneki-neko-ip,staff-console,logo-review,downloads}.conf
/etc/systemd/system/{luckycat-bank,luckycat-bridge,logo-review}.service
/srv/maneki-neko/                      # 部署目录（无 .git）
/var/www/maneki-neko/{bank,staff,docs} # 静态产物
/var/lib/luckycat/bank.sqlite          # 线上库
/var/lib/logo-review/                  # 评审站数据
```

---

## 16. 重新发布本文档（下载 URL）

本文档源文件在仓库：`design/handoff/AGENT-HANDOFF.md`。发布成下载：

```bash
cp /root/projects/Maneki-Neko/design/handoff/AGENT-HANDOFF.md /var/www/maneki-neko/docs/agent-handoff.md
chown www-data:www-data /var/www/maneki-neko/docs/agent-handoff.md
# nginx 里已有 location = /downloads/agent-handoff.md（downloads.conf）
nginx -t && systemctl reload nginx
```

下载地址：`http://120.48.123.112/downloads/agent-handoff.md`
