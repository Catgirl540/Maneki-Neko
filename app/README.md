# 客户端前端维护手册

适用范围：`app/` 网页银行客户端。技术栈为 React、TypeScript、Vite、Tailwind CSS。
下文命令均从**仓库根目录**执行，需要 Node.js 24 和 npm。

## 1. 本地启动

首次安装或锁文件更新后执行：

```bash
npm --prefix app ci
```

在两个终端分别启动银行后端和前端：

```bash
# 终端一
node server/index.mjs
```

```bash
# 终端二
npm --prefix app run dev
```

前端默认地址为 `http://localhost:5180`，银行后端为 `http://127.0.0.1:8080`。
演示登录：`13800138000` / `123456`，先获取页面显示的短信验证码；支付密码为 `888888`。

只做界面开发、需要浏览器 mock 时：

```bash
VITE_USE_MOCK=true npm --prefix app run dev
```

Agent 对话与语音由独立桥接服务提供，本地默认端口为 8788。
需要联调时，按[项目 README §2.1](../README.md#21-接上-agent-与当前银行账户)准备运行时与服务端密钥。

## 2. 修改时去哪里找

以下路径均相对于 `app/`。

| 维护内容 | 主要位置 |
| --- | --- |
| 页面与路由 | `src/pages/`、`src/App.tsx` |
| 桌面侧栏、手机导航与账户返回入口 | `src/components/layout/`，统一定义在 `navigation.ts`，账户分组使用 `AccountLayout.tsx` |
| 按钮、表单、弹窗等通用控件 | `src/components/ui/` |
| 图表、品牌图形 | `src/components/charts/`、`src/components/brand/` |
| 颜色、字体、圆角、断点 | `src/styles/tokens.css`；全局样式在 `global.css` |
| 银行接口、类型与 HTTP 请求 | `src/api/contract.ts`、`types.ts`、`http.ts` |
| 登录态与业务辅助逻辑 | `src/store/`、`src/lib/` |
| Agent 卡片、消息与语音 | `src/components/agent/`、`src/api/agent.ts`、`src/lib/useAgentChat.ts`、`src/lib/useVoice.ts` |

## 3. 配置怎么改

默认配置见 [`.env.development`](.env.development) 和 [`.env.production`](.env.production)。
个人覆盖写入 `app/.env.local`，不提交；修改配置后重启开发服务器。

| 变量 | 用途 |
| --- | --- |
| `VITE_USE_MOCK` | 只有 `true` 启用浏览器 mock，默认配置为 `false` |
| `VITE_PROXY_TARGET` | 开发时 `/api` 的代理目标，默认 `http://127.0.0.1:8080` |
| `VITE_API_BASE_URL` | 银行请求基地址；本地留空，线上 `/bank/` 部署时为 `/bank`，不要再拼 `/api` |
| `VITE_AGENT_URL` | 浏览器访问 Agent 的完整前缀，本地为 `/agent-api` |
| `VITE_AGENT_TARGET` | 开发时 Agent 代理目标，默认 `http://127.0.0.1:8788` |
| `VITE_AGENT_ENABLED` | 设为 `false` 关闭独立 Agent 通道 |
| `VITE_BASE_PATH` | 页面和静态资源根路径，本地为 `/`，线上为 `/bank/` |

这些变量在开发启动或构建时读取。生产构建完成后，修改服务器环境变量不会改变已有页面产物。
`VITE_*` 会进入浏览器，不能放模型密钥或服务端访问口令。

## 4. 常见修改流程

**新增页面**：在 `src/pages/` 编写页面 → 在 `src/App.tsx` 注册路由 → 按需更新 `navigation.ts`。
需要登录的页面放在 `RequireAuth` 包裹的路由组内；登录后的跳转统一由 `LoginRoute` 处理。

一级导航固定为 **账户、理财、助手、我的**，桌面与手机顺序一致。
助手使用全屏工作区：`AppShell.tsx` 隐藏通用顶栏，`global.css` 的 `chat-workspace` 与 `app-content-chat` 控制视口高度和手机导航留位；`SupportPage.tsx` 只滚动消息，输入栏固定在底部。
账户概览首屏是「余额主卡 + 常用功能入口卡」：五个高频入口（转账 / 账单 / 银行卡 / 存钱计划 / 多币种换汇）在桌面 ≥1024 宽的一屏内即可点开；近 30 天收支、最近交易与资金账户下移到首屏之下，末尾是「更多服务」分区。不设置横排子标签。
**转入、转出只在概览提供入口，各自打开一个弹窗**；大额二次确认也在转出弹窗内完成。

| 功能 | 路径 / 组件 |
| --- | --- |
| 账户概览 / 银行卡管理 | `/dashboard` / `/cards` |
| 转入 / 转出弹窗 | `src/components/account/MoneyDialogs.tsx`，内容为 `ReceivingContent` / `TransferForm` |
| 账单 | `/analysis`，从概览的“查看账单”进入 |
| 收支分析 / 自动扣款 | `/analysis/statistics` / `/analysis/autodebits`，从账单进入 |
| 存钱计划 / 多币种换汇 | `/dashboard/savings` / `/exchange`，入口在概览的常用功能 |
| 工资与备用金 / 借款与分期 | `/cashflow` / `/credit`，入口在概览的「更多服务」 |
| 现金管理 / 投资与定投 / 保险保障 | `/wealth/cash-management` / `/wealth/investments` / `/wealth/insurance`，入口在概览的「更多服务」 |
| 身份认证 / 邀请与奖励 / 会员与订阅 | `/security/identity` / `/security/invitations` / `/security/membership`，入口在「我的」 |

旧地址 `/receiving`、`/transfer` 分别跳转到 `/dashboard?flow=in`、`/dashboard?flow=out`。
弹窗开关保存在 `flow` 查询参数中；关闭后清除参数，重新打开重置表单，提交期间禁止关闭。

理财开户复用储蓄开户的实名资料，身份核验只要求短信码与人脸；保留风险测评和协议签署。

交易搜索在 账单页 `/analysis` 内（跟在分类筛选旁，不置顶），用 URL 的 `q`、`account`、`category` 保存筛选。
桌面端通知入口在左侧栏底部（用户信息上方），移动端没有侧栏，改用悬浮铃铛；两者共用 `NotificationsButton.tsx`。
登录默认进入账户概览；`/security` 对应“我的”，保留原有安全功能与退出登录。

**调整样式**：先修改设计 token，再调整组件布局。通用交互优先复用现有控件。
页面骨架用统一类：`.content-shell`（内容宽度与左右留白，随断点收放）、`.page-stack`（页面区块纵向节奏），标题用 `PageHeader` 组件；布局 token（`--content-max` / `--gutter-x*` / `--page-y*` / `--stack-gap*`）都在 `tokens.css`。
客户端 `lg` 断点为 **960px**，检查手机布局和浏览器“桌面版网站”，不要按默认 1024px 推断。

新增功能的页面、演示接口和业务完成度应分开判断，实际限制见 [接口文档](../docs/api/README.md#当前实现范围)。自动任务、核身、还款和权益等尚未完成，mock 被服务端复用后会影响共享演示数据。

**新增银行接口**：同步修改 `contract.ts`、`types.ts`、`http.ts`、mock 实现和后端路由映射，
并更新根 README 的接口清单。页面通过 `@/api` 调用银行业务；Agent 使用独立的 `src/api/agent.ts` 通道。

## 5. 数据与登录态

- 金额使用整数“分”（`Cents`），展示时使用 `src/lib/format.ts`，不要把显示字符串传回接口。
- HTTP 模式下，账户、余额和流水由后端保存；请求失败时显示错误，不用 mock 数据替代结果。
- 客户令牌和用户信息保存在 `sessionStorage`，同标签页刷新可恢复；银行服务重启后需要重新登录。
- 助手历史列表保存在浏览器本地，服务端按客户保存上下文，Agent 重启后可直接继续。旧版本自动迁入最近文字，图片需重发；中断的确认需重新发起，已提交业务以银行记录为准。
- `src/api/mock/` 的业务逻辑也被服务端复用，修改它会影响后端行为，不能只当作页面样例。

登录态入口见 `src/store/session.tsx` 和 `src/lib/authToken.ts`。
敏感操作保留“展示信息 → 用户确认 → 身份验证 → 执行”流程，前端路由守卫不能替代后端鉴权。

## 6. 修改后怎么验证

基础检查：

```bash
npm --prefix app run lint
npm --prefix app run build
node tools/check-contract.mjs
node tools/check-routes.mjs
```

改页面时，手工检查手机与桌面宽度、导航、表单错误、弹窗、登录后返回来源页和深层路由刷新。
转账等写操作使用本地演示数据，检查失败提示、成功后的余额和流水，以及重复点击提交。

需要完整 HTTP 页面回归时，先安装工具依赖，再执行：

```bash
npm --prefix tools ci
node tools/check-http-frontend.mjs
```

导航与响应式检查使用 mock 前端：启动后运行 `node tools/check-responsive.mjs`；
单弹窗转入、转出与撤销检查运行 `node tools/check-account-flows.mjs`；
收款字段与剪贴板检查运行 `node tools/check-receiving.mjs`。

上述浏览器脚本需要可用的 Chromium，可通过 `CHROME_PATH` 指定；HTTP 脚本自行启动临时后端和数据库。
涉及 Agent HTTP 链路的修改，再运行 `node tools/check-agent-http.mjs`（使用 fixture，不调用付费模型）。
事件流连接释放与失败重试运行 `node tools/check-agent-connections.mjs`；连续新建对话必须关闭上一段空闲连接，握手失败必须停止重连。
事件流首帧被缓冲或中途断开时，自动切换到 `/sessions/:id/events` 短请求，按游标续取事件；运行 `node tools/check-agent-polling.mjs` 验证兼容接收、账户隔离和单次卡密展示。
助手正文按累计快照更新同一气泡，完成后替换为最终文本；生成期间不自动朗读。运行 `node tools/check-agent-streaming.mjs` 验证流式显示、断线恢复与消息合并。

## 7. 构建与发布

线上客户端部署在 `/bank/`，按以下配置构建：

```bash
npm --prefix app run build:server
```

产物在 `app/dist/`。发布、服务管理和 nginx 配置按[服务器开发交接文档](../design/handoff/AGENT-HANDOFF.md)执行。
发布后运行 `node tools/check-web-deployment.mjs`，检查 `/bank/`、资源路径与类型、银行和 Agent 代理、深层链接。仅首页返回 200 不能说明网页正常，资源请求可能实际返回其他应用的 HTML。最后在浏览器确认官网与登录页正常显示。

## 8. 常见问题

| 现象 | 优先检查 |
| --- | --- |
| 白屏或错误页 | 浏览器 Console 的第一条错误、资源 404、构建是否通过 |
| 银行请求失败或返回 HTML | 后端 `/health`、Network 请求地址、`/api` 代理和 `VITE_API_BASE_URL` |
| 数据像固定样例 | `VITE_USE_MOCK` 及个人 `.env.local`，修改后重启 Vite |
| 助手无法连接或切回普通客服 | Agent 进程、健康检查、`VITE_AGENT_URL` 与代理目标；银行后端和 Agent 是两个服务 |
| 子路径资源 404、刷新页面 404 | 构建时的 `VITE_BASE_PATH` 和 nginx 的单页路由回退配置 |
| 配置或代码改了仍显示旧内容 | 确认访问端口与启动目录，重启 Vite；线上重新构建并发布产物 |

修改接口、配置或维护流程时，同步更新本手册；后端数据说明见 [server/README.md](../server/README.md)。
