# P14 · 公网部署（bank.waveflow.cn）

> 状态：**已上线并跑通**（2026-09-21）。
> 相关：`P6-WEB-BRIDGE.md`（桥接的接口面）、`P8-VOICE.md`（流式语音）、
> `P13-ANDROID.md`（安卓端连的就是这里的端点）、
> `../scripts/build.sh` 与 `../scripts/bootstrap.sh`（部署时修了两个 bug，见 §6）。

## 是什么

线上有两块，**都是这一份仓库的产物**：

```
浏览器 / 安卓 App
        │  https://bank.waveflow.cn
        ▼
   nginx (81.71.23.46)
        ├── /            → /var/www/bank.waveflow.cn   （Vite 静态产物）
        ├── /api/        → 127.0.0.1:8898              （占位银行后端，见 P15）
        └── /agent-api/  → 127.0.0.1:8898              （真 agent + 语音）
                                  ▲
                                  └── systemd: luckycat-bridge.service
                                      node22 + DSH 运行时 + OpenRouter/火山
                                      + 前端那份 mock（现场转译）
```

**同源**是关键的简化：两个前缀都挂在银行站下面，所以网页端不需要 CORS，
也不用为它们另买域名、另配证书。安卓端打的也是同一个地址。

## 1. 服务器上的布局

| 项 | 值 |
| --- | --- |
| 主机 | `ubuntu@81.71.23.46`（腾讯云，Ubuntu，3.6G 内存 / 59G 磁盘） |
| 静态产物 | `/var/www/bank.waveflow.cn`（`tools/deploy-bank.sh` 负责） |
| 桥接代码 | `/home/ubuntu/luckycat`（`framework/` 的内容，**平铺**在这一层，不含 node_modules） |
| 占位银行要的 app 源码 | `/home/ubuntu/luckycat/app/src` + `/home/ubuntu/luckycat/tools/ts-resolve-hook.mjs`（见 P15） |
| 桥接密钥 | `/home/ubuntu/luckycat/.env`，**权限 600** |
| 桥接端口 | `127.0.0.1:8898`（**不是默认的 8788**——那个被另一个项目的 waveagent-gateway 占了） |
| node | `/home/ubuntu/.local/node22/bin/node`（v22.20.0；系统的 node 是 v18，**不够**） |
| 服务 | `systemctl status luckycat-bridge` |
| nginx 站点 | `/etc/nginx/sites-available/bank.waveflow.cn` |

**这台机器是多家共用的**：`agent.waveflow.cn`（waveagent-gateway，也在 443）、
`waveflow.cn`、`remote-terminal` 都住在同一个 nginx 上。
改配置前先看 `sites-enabled/`，改完必须验其它站点没受影响——`tools/deploy-bank.sh`
的自检里本来就有这一条，别删。

## 2. 为什么 agent 必须上公网

网页版是**纯静态**的，所有业务数据都在浏览器里；但 agent（聊天、确认卡片、语音）
是服务端能力，走 `/agent-api/*`。线上那份原来把 `VITE_AGENT_ENABLED` 设成 `false`
（"静态部署没有 agent 可连，回落固定话术"），所以之前线上**既没有 agent 也没有语音**。

手机端要能离开电脑用，就必须有一个公网可达的 agent 端点——**这就是这次部署的全部理由**。

## 3. 安全姿态（这是有意的取舍，不是漏了）

- **端点公开，没有访问口令。** 口令写在网页 bundle 里等于公开（用户 F12 就能看到），
  那是自欺。所以选的是**限流**：nginx `limit_req_zone`，按 IP `30r/m`、`burst=20`。
- **密钥在服务器上**（OpenRouter + 火山）。这是公开端点必然的代价：有人扫到就能调用，
  会烧额度。限流把最坏情况压住，但不等于没有风险。
- **工具全是占位数据**（`demo: true`），所以没有真实资金/客户数据可泄露。
- **支付密码**只从客户端 POST 给桥接，不进对话、不进模型上下文（见 `P5-CONSENT.md`）。
- systemd 里给了 `MemoryMax=1500M` 当保险阀：宁可这一个服务被 OOM 掉，
  也不能把整台机器（还跑着别的站点）拖垮。

## 4. nginx 里那两处不能少

```nginx
# http 上下文
limit_req_zone $binary_remote_addr zone=luckycat_agent:10m rate=30r/m;

# bank.waveflow.cn 的 443 server 块里
location /agent-api/ {
    limit_req zone=luckycat_agent burst=20 nodelay;
    limit_req_status 429;
    proxy_pass http://127.0.0.1:8898;
    proxy_http_version 1.1;
    proxy_set_header Connection '';
    proxy_buffering off;        # ← 见下
    proxy_read_timeout 3600s;
    proxy_send_timeout 3600s;
    client_max_body_size 13m;
}

# 占位银行后端（见 P15）。`/api/` 是前缀匹配，**不会**吃掉 `/agent-api/`
# ——后者不以 `/api/` 开头。这里没有 SSE，不需要关缓冲。
location /api/ {
    limit_req zone=luckycat_agent burst=20 nodelay;
    limit_req_status 429;
    proxy_pass http://127.0.0.1:8898;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    client_max_body_size 13m;
}
```

**`proxy_buffering off` 不是优化，是功能开关。** 事件流和语音流都是 SSE；
开着缓冲时 nginx 会攒够一批才吐出去，「首帧到达就出声」直接失效——
表现成"要等整段合成完才响"，而且**没有任何报错**。当初本机直连是好的，
只有经过 nginx 才会坏，属于典型的"加了反代才出现"的问题。

## 5. 怎么重新部署

**前端**（改完 `app/` 之后）：

```bash
BANK_SSH_KEY=~/.ssh/waveagent_key bash tools/deploy-bank.sh
```

**桥接**（改完 `framework/` 之后）：把源码重新同步过去、重建、重启服务。
`framework/` 源码只有 1.6M（`node_modules` 542M 在服务器上装），所以整目录传一遍很快。

⚠️ **不要 `rm -rf ~/luckycat`**：`.env`（密钥）、`.dsh-home`（会话与上传）、
`node_modules` 都在那一层，删了就一起没了。只覆盖源码目录。

```bash
cd <repo>
K=~/.ssh/waveagent_key
SSH="ssh -i $K ubuntu@81.71.23.46"

# 1) framework 源码：先删掉那几个源码目录，再铺新的（保留 .env / .dsh-home / node_modules）
$SSH 'rm -rf ~/luckycat/bridge ~/luckycat/packages ~/luckycat/profiles ~/luckycat/scripts ~/luckycat/examples'
tar czf - -C framework --exclude=node_modules --exclude=.dsh-home --exclude=lib --exclude=design . \
  | $SSH 'tar xzf - -C ~/luckycat'

# 2) 占位银行后端要的两样（见 P15）：转译钩子 + app 源码
$SSH 'mkdir -p ~/luckycat/tools ~/luckycat/app/node_modules'
tar czf - -C tools ts-resolve-hook.mjs | $SSH 'tar xzf - -C ~/luckycat/tools'
tar czf - -C app src package.json | $SSH 'tar xzf - -C ~/luckycat/app'
$SSH 'ln -sfn ../../node_modules/typescript ~/luckycat/app/node_modules/typescript'

# 3) 重建并重启（bootstrap 必须在 build 之前：它建包之间的链接）
$SSH 'export PATH=$HOME/.local/node22/bin:$PATH; cd ~/luckycat \
  && bash scripts/bootstrap.sh && bash scripts/build.sh \
  && sudo systemctl restart luckycat-bridge'
```

（`npm install` 只在**首次**部署时要跑。改了依赖才需要重跑。
`bootstrap.sh` 是幂等的，每次都跑没关系。）

`.env` 只在首次部署时写一次，同步源码不会覆盖它。

**部署后自检**（这一条会真的调模型）：

```bash
node tools/check-deployed.mjs
```

它验的不只是状态码——状态码 200 完全可能"静态文件在、agent 连不上、回落固定话术"。
它会走真实登录、发一句话、收一次音频，**并且**断言页面的 `data-agent-status` 是
`ready`（不是回落）。这正是上一版线上看不出问题的地方。

## 6. 部署时修掉的四个 bug（都是"只有换环境才暴露"的类型）

| # | 问题 | 为什么本机看不出来 | 修法 |
| --- | --- | --- | --- |
| 1 | `scripts/build.sh` 按**字母序**构建，`bank-demo` 排在 `consent` 前，拿不到后者的 `lib/*.d.ts` → `Cannot find module '@luckycat/dsh-consent'` | 本机 `lib/` 早就构建过、一直在盘上 | 按 `package.json` 里的 `@luckycat/*` 依赖做拓扑排序 |
| 2 | `scripts/bootstrap.sh` 的安装列表里**没有 `tool-fs` 和 `ask`**（它们是做 P10/P12 时手工 `dsh plugin add` 的） | 本机 profile 里已经有，所以看不出缺 | 补进列表；否则全新环境的 agent **看不了图、弹不出提问卡片**，`verify.sh` 也会红 |
| 3 | 桥接调用要 **pnpm**，服务器上没有 | 本机 `/opt/dsh-shell/payload/node/bin/pnpm` 一直在 | 服务器上 `npm i -g pnpm@11.22.0` |
| 4 | 服务器系统 node 是 **v18**，DSH 要 node22 | 本机就是 v22 | 用 `~/.local/node22/bin/node`（服务器上本来就有） |

## 7. 实测结果

`node tools/check-deployed.mjs` → **10 通过 / 0 失败**：

```
PASS  站点首页 200
PASS  首页引用的 2 个资源都能下载
PASS  深链接 /dashboard 回落正常
PASS  agent 端点可达且 ok=true
PASS  health 不夹带模型名/厂商名
PASS  服务端如实报出语音能力
PASS  语音流正常：start → audio×8 → end
PASS  网页显示「已连接 agent」（不是回落固定话术）
PASS  助手真的回了话（55 字）：您好，我是招财猫银行的智能客服小招。…
PASS  页面没有 JS 运行时报错
```

安卓端（模拟器，打公网地址）也拿到了 `ok=true` 与 `voice.tts=true`——
见 `P13-ANDROID.md`。

## 8. 已知的边界

- `waveflow.cn` 的 **https 没配**（只有 80），访问 `https://waveflow.cn` 会失败。
  这是**部署前就有的状态**，不是这次改坏的。
- 限流是**按 IP** 的。同一出口 IP 后面有很多人时会互相挤；演示场景够用。
- 会话与上传文件堆在服务器的 `~/luckycat/.dsh-home` 下，**没有清理策略**。
  演示用得多了要手工看一眼磁盘。
- 桥接重启会丢掉内存里的会话（切到"助手已经不记得了"的提示，符合 `P7` 的设计）。
