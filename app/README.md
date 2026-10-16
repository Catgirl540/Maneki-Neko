# 客户端前端维护手册

当前维护版本为此目录的桌面网页工作台。旧版源码、视觉规范和安卓工程已归档；修改其他客户端前先读 [CLIENTS.md](../CLIENTS.md)。

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
| 桌面侧栏、首页服务入口与业务返回入口 | `src/components/layout/`，主导航在 `navigation.ts`，智能服务在 `services.ts` |
| 按钮、表单、弹窗等通用控件 | `src/components/ui/` |
| 图表、品牌图形 | `src/components/charts/`、`src/components/brand/` |
| 颜色、字体、圆角与工作台布局 | `src/styles/tokens.css`、`src/styles/workbench.css`；基础样式在 `global.css` |
| 登录页布局与样式 | `src/pages/LoginPage.tsx`、`src/styles/login.css`；中央表单垂直居中，背景为蓝紫渐变泡泡；保留现有验证码与银行登录接口 |
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

本轮以 `docs/design/exports/2026-10-15/zhaocai-cat-bank.html` 为视觉依据，**仅验收桌面网页**。首页是单一智能工作台，没有传统/智能模式开关。

侧栏主导航为「账户总览、转账与支付、银行卡、账单与交易、理财与储蓄」。账户总览 `/dashboard` 展示助手与十个智能服务；资金信息在侧栏「账户资产」`/accounts`，其余业务集中在 `/services`，个人资料从左下角进入。

`AppShell.tsx` 始终挂载同一个 `SupportPage`，业务页只替换 `Outlet`，不得把助手放回各路由分别挂载，否则切页会丢失输入草稿、待发图片和正在接收的事件。`ChatWorkspace` 的可选 `workbench` 配置控制首页/底部输入栏展示；员工端使用独立 client 和身份，不传客户功能选择。选择智能服务不会自动发送消息；真正发送时用 `serviceIds` 提交本轮选择并回到首页，原始消息不加标题前缀。服务端按唯一映射加载完整技能，多选组合、清除后自动匹配；历史重发沿用原消息的选择快照。工具与支付确认沿用已有实现，维护见 [业务技能说明](../framework/design/SMART-SERVICE-SKILLS.md)。

首页保留「历史对话、新对话、转人工、人工工单」。人工工单是异步处理，组件位于 `src/components/support/HumanSupport.tsx`。独立 Agent 未接通时明确显示未连接，禁用助手发送，不以固定话术冒充智能回复；传统业务与手动转人工仍可使用。

主要路径：

- `/dashboard`：智能首页；`/support` 为同一智能首页的兼容地址。
- `/transfer`：独立转账任务页，复用 `TransferForm` 的报价、收款人核验与支付确认。
- `/accounts`：账户余额、其他资金账户、近期交易；转入和转出弹窗仍可在此打开。
- `/cards`：卡片列表、锁卡/换卡、交易设置、验证后查看安全信息。
- `/analysis`、`/analysis/statistics`、`/analysis/autodebits`：流水、消费分析、自动扣款。
- `/wealth`：理财产品、风险测评与开户；存钱、现金管理、定投另有可见入口。
- `/services`：完整功能目录，包括换汇、工资、借款、保险、身份、邀请、会员。

旧的 `/dashboard?flow=in|out` 兼容到 `/accounts?flow=in|out`；`/receiving` 兼容到 `/accounts?flow=in`。关闭弹窗会清除 `flow` 参数。原有银行接口、鉴权与金额单位不变。

品牌资源在 `src/assets/design/`，网页字标由 `WorkbenchBrand.tsx` 统一渲染。`support-cat.png` 使用新生成的耳麦招手猫，在首页欢迎区、回复头像和思考状态中共用。主题中的 `gold` 变量名为兼容旧业务组件而保留，实际颜色已为品牌紫；员工端使用独立主题文件。

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
转账挂起与清算：`node --import ./tools/ts-resolve-hook.mjs tools/check-transfer-holds.mjs`；HTTP 全链路使用 `node tools/transfer-hold-smoke.mjs`，仅写临时数据库。
结果与详情自动刷新检查运行 `node tools/check-transfer-status-ui.mjs`，覆盖到账、拦截、清算及查询失败恢复。
收款字段与剪贴板检查运行 `node tools/check-receiving.mjs`。

上述浏览器脚本需要可用的 Chromium，可通过 `CHROME_PATH` 指定；HTTP 脚本自行启动临时后端和数据库。
涉及 Agent HTTP 链路的修改，再运行 `node tools/check-agent-http.mjs`（使用 fixture，不调用付费模型）。
`node tools/check-agent-risk.mjs` 使用本地 HTTP 夹具验证余额工具的测评状态及确认流程：`unassessed` 为未完成、`expired` 为已完成但过期、`valid` 为有效、`unknown` 为无法确认；未完成时不返回默认等级、分数或日期作为个人测评历史。
新增网页流程可独立验证：`node --import ./tools/ts-resolve-hook.mjs tools/check-web-ui-inputs.mjs` 检查金额与证件号展示；设置 `CHROME_PATH` 后运行 `node tools/check-web-ui-corrections.mjs`，只启动前端并模拟 API 响应，覆盖报价变化/过期、表单校验、核验入口及手机布局。
客户端测试报告回归运行 `node tools/check-web-report-regressions.mjs`：使用非安全 HTTP 本地域名，所有银行与 Agent 请求均拦截为夹具，覆盖复制降级及手动复制、非法转账金额、登录深链、账单分页与失败重试、风险测评状态、空设备/日志和语音禁用原因。
转入页当前仅展示和复制银行账户资料；接口未提供 FPS 登记归属与状态，确认前不分享 FPS 手机号或 ID。HTTP 下录音不可用时显示原因；复制先尝试兼容方式，失败后可手动选择文本。
事件流连接释放与失败重试运行 `node tools/check-agent-connections.mjs`；连续新建对话必须关闭上一段空闲连接，握手失败必须停止重连。
事件流首帧被缓冲或中途断开时，自动切换到 `/sessions/:id/events` 短请求，按游标续取事件；运行 `node tools/check-agent-polling.mjs` 验证兼容接收、账户隔离和单次卡密展示。
助手正文按累计快照更新同一气泡，完成后替换为最终文本；生成期间不自动朗读。运行 `node tools/check-agent-streaming.mjs` 验证流式显示、断线恢复与消息合并。

## 7. 构建与发布

独立域名 `https://bank.waveflow.men/` 部署在 guga，使用根路径构建；配置、接口代理及回滚见 [guga 站点说明](../design/deploy/guga.md)。

线上客户端部署在 `/bank/`，按以下配置构建：

```bash
# 首次发布或更新安卓版时，先构建 APK 并准备官网静态下载文件
cd mobile
flutter build apk --debug --dart-define-from-file=config/public-server.json
cd ..
npm --prefix app run prepare:android
npm --prefix app run build:server
```

官网导航与页脚提供「下载安卓版」入口，公开地址为 `/bank/download`。Android/iPhone 等手机访问任意客户端路径都会跳到该页，且不挂载账户、登录或助手页面；电脑及平板保留网页功能。设备判断在 `src/lib/device.ts`，使用 UA 与 UA Client Hints，不按窗口宽度拦截。iPhone 显示暂无 iOS 版，不能安装 Android APK。

`tools/package-android-download.mjs` 从 APK 读取版本、包名、最低系统与架构，验证签名，再生成 `app/public/downloads/android.json` 和带哈希名的安装包。可用 `node tools/package-android-download.mjs /绝对路径/app-release.apk` 替换为正式包。APK 与元数据不进 Git；部署时必须上传整个 `app/dist/`，包括 `downloads/`。`build:server` 会核对 APK 是否存在、大小及 SHA-256，缺失时直接失败。新版本使用新的文件名，避免浏览器缓存旧包。

该 `android.json` 也是安卓版应用内更新源。新包必须增加 Flutter 的 build 数字并沿用签名；`mobile/releases/<version>.md` 的可选说明会写入元数据，不能手动伪造版本。更新流程见 [安卓版维护说明](../mobile/README.md#5-应用内更新)。

下载页的加载、错误重试和安装说明在 `src/pages/DownloadPage.tsx`；安装包信息读取失败时不展示下载按钮。运行 `npm --prefix tools ci` 后执行 `node tools/check-android-download.mjs`，验证生产 `/bank/` 构建的桌面入口、手机深链接、完整文件下载校验和故障重试；`CHROME_PATH` 可指定 Chromium。

产物在 `app/dist/`。发布、服务管理和 nginx 配置按[服务器开发交接文档](../design/handoff/AGENT-HANDOFF.md)执行。
发布后运行 `node tools/check-web-deployment.mjs`，检查 `/bank/`、资源路径与类型、银行和 Agent 代理、深层链接，以及下载元数据和 APK 文件头。nginx 的 `/bank/downloads/` 应直接提供静态文件，缺失时返回 404；`android.json` 不缓存，带哈希名的 APK 可以长期缓存。仅首页返回 200 不能说明网页正常，资源请求可能实际返回其他应用的 HTML。最后在浏览器确认电脑官网和手机下载安装页。

公网客户与工作人员入口、三个 Agent 代理和回滚约定见 [裸 IP 部署说明](../design/deploy/README.md)。

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
