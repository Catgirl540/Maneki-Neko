# 微信与企业微信接入

固定使用社区插件 [`@xmanrui/dsh-im@5.1.0`](https://github.com/xmanrui/dsh-im)，由 `framework/bridge/im-channels.mjs` 复用其微信/企微 Controller、Runtime、扫码及消息协议。SDK 客户运行时通过银行 Harness 适配器接入，不修改第三方源码，不向 `sdk-minimal` 挂载依赖完整 Web Host 的管理界面。

支持客户 Agent 的微信私聊、企业微信智能机器人私聊、扫码连接、企微 Bot ID + Secret 绑定、重连、移除、文字收发和结果回传。企微自建应用、外部联系人客服、群聊业务、员工/运维工具的 IM 执行、图片及文件办理尚未接入。企微账号不授予银行员工权限。

## 本地扫码与收发验证

只验证真实扫码和私聊连接时，无需数据库或模型密钥：

```powershell
npm --prefix framework run start:im:local
```

服务仅监听 `127.0.0.1:8791`。通过 `framework/.dsh-home/im-connection-test/access.json` 中的 `url` 打开管理页面，点击微信或企微扫码按钮。完整入口带有本次启动的管理凭证，请勿分享。机器人收到私聊文字后回复固定的连接测试提示，不调用模型或银行接口。

此模式的机器人凭据和数据保存在独立目录 `framework/.dsh-home/im-connection-test/`；凭据加密密钥位于同目录 `data-key`，渠道状态和消息由上游维护，应限制整个目录的访问。切换银行模式后需在银行管理页重新配置机器人。使用 `npm --prefix framework run stop:im:local` 停止连接验证。

## 银行业务模式启动

先按 [启动指引](../../README-START.md) 配置银行 HTTP 服务、专用 AI PostgreSQL 会话连接、匹配的 AI 数据密钥和服务端模型。沿用已有银行数据与密钥，不替换生产数据库。

在仓库根目录执行（PowerShell）：

```powershell
npm --prefix framework ci
$env:LUCKYCAT_IM_PUBLIC_URL='https://你的银行域名'
npm --prefix framework run start:im
```

`start:im` 在仓库内构建本地插件、更新客户 profile，设置 `LUCKYCAT_IM_ENABLED=1` 后启动现有客户 Bridge。不可与占用同一 customer namespace 的客户 Bridge 同时运行。服务管理器也可继续运行 `node framework/bridge/demo-server.mjs`，增加此开关与公网 URL 后按原流程重启。员工和运维 Bridge 不加载客户渠道。

默认端口仍为 8788，沿用 `LUCKYCAT_DEMO_PORT`。本地入口为 `http://127.0.0.1:8788/agent-api/im`。公网 URL 必须是银行 HTTPS 域名，已有 `/agent-api/` 同源反代继续指向客户 Bridge，不增加公网端口。未设置公网 URL 仅适用于 localhost 调试，手机不能使用电脑的 127.0.0.1 链接。

可选 `LUCKYCAT_IM_DATA_KEY` 为规范 Base64 编码的独立 32 字节密钥；未配置时从 `LUCKYCAT_SESSION_DATA_KEY` 派生域分离的 IM 子密钥，不使用银行数据密钥。配置仅放服务端。IM 默认关闭，普通 Bridge 启动不自行启用渠道。

## 使用

1. 打开银行域名下 `/agent-api/im`，选择「机器人管理」，使用现有运维账号登录。客服、主管和客户不能管理机器人。
2. 微信点击「扫码连接微信」；企微点击「扫码创建企微机器人」，或填写已有 Bot ID、Secret。完成授权后查看状态。
3. 本人在机器人私聊发送文字，得到十分钟有效、仅可使用一次的绑定链接。进入链接，用本人银行账户和短信验证码登录，页面自动核对私聊来源；确认是本人私聊后点击绑定。链接已使用或过期时，回到原私聊发送“绑定”，使用机器人新回复的链接，无需重新扫码机器人。
4. 回到原私聊发送需求。消息沿现有客户 Agent、技能和银行工具处理。登录有效期间，余额、流水、交易详情、卡片概要、卡产品、已保存收款人、银行列表、自动扣款列表、消费、现金流及本人已有工单查询，由服务端核对绑定和客户归属后直接回复，不要求逐次打开网页确认。写操作、敏感卡信息、其他未列入白名单的工具或补充信息仍使用银行确认页面。
5. 在银行页面核对真实字段，按要求验证支付密码、本人抄录风险语句或回答问题。复用原接口，聊天里的「确认」不视为授权。最终回复回传原机器人、原私聊，以银行回执为准。

获取登录验证码后，页面显示 60 秒重发倒计时。演示环境返回的验证码会在验证码栏下独立显示并自动填入；真实短信环境仍由用户从手机短信获取。更换手机号会清空旧验证码，重发冷却按手机号保持。验证码提示不因普通登录报错而被覆盖，服务端频率限制保持不变。

连接页支持桌面和手机，不改变主网页的普通手机下载引导。页面令牌只保存在内存；「退出页面」清理页面登录，不解除 IM。停用请点击「解除连接」并二次确认，会取消未结束的任务和授权，已经提交银行的业务不会撤销。解除后旧绑定码不能复用，重新绑定须获取新链接。

银行登录失效或 Bridge 重启后需重新登录连接，并创建新银行会话；不续办旧指令或恢复旧授权。换绑其他客户须先由原客户解除。机器人扫码与银行客户绑定是独立流程。

## 权限与状态

- 来源按渠道、机器人、私聊标识隔离。绑定不创建资金账户，客户仍只有一个资金账户，多币种与多卡归属不变。
- 沿用银行鉴权、会话归属、参数绑定、一次授权和提交前状态校验。仅当前有效绑定且正在处理 IM 请求的会话可复用绑定登录，服务端基于已准备的真实工具白名单、GET 方法、无请求体且不含支付密码或风险确认的条件，发放本次只读查询授权并持久化 `im-query-authorized` 事件。查询仍复核归属、参数和有效期且不可重放。写操作及卡密不走此路径，继续逐次网页确认；不接收 IM 支付密码，不转发卡密事件或原始工具结果。普通网页和员工/运维 Agent 的确认行为保持原状。
- 不开放 IM 原生工作区、模型和任意会话切换命令；不在群聊办理个人业务。绑定码为 192 位随机、十分钟有效、一次消费。
- 回传前重验登录和绑定；解除、换绑或登录失效抑制旧结果。平台拒绝或不确定发送时不自动重试结果，用户可在银行连接页查看已保存回复与业务记录。
- 银行令牌只在 Bridge 内存。机器人 Secret/Token 和归属映射保存在 `LUCKYCAT_SESSION_DIR/im/bank-bindings.enc.json`，使用 AES-256-GCM、域分离密钥和原子替换。
- 同目录渠道配置、去重、IM 上下文和部分已发消息由上游维护，不能视为全部加密。整个 AI/IM 目录须限制服务账号读写，按敏感数据备份并保留密钥，不提交二维码、绑定链接或真实消息截图。

## API

| 路径 | 授权与用途 |
|---|---|
| `GET /agent-api/im`、`/agent-api/im/portal.js` | 加载页面，CSP 禁止嵌入与第三方脚本 |
| `POST /agent-api/im/auth/sms`、`/auth/login` | 仅转发固定银行认证接口，额外来源限流，不进入模型 |
| `POST /agent-api/im/preview`、`/claim` | 银行客户核对/消费绑定码 |
| `GET /agent-api/im/bindings` | 当前客户的连接与会话 |
| `DELETE /agent-api/im/bindings/:id` | 原客户解除 |
| `GET /agent-api/im/admin/status` | 当前有效 ops 查看状态 |
| `POST /agent-api/im/admin/:channel/provision` | ops 发起扫码并返回二维码 |
| `GET /agent-api/im/admin/:channel/provision/:id` | ops 查询扫码状态 |
| `POST /agent-api/im/admin/:channel/cancel/:id`、`/verify/:id` | ops 取消或提交微信扫码验证码 |
| `POST /agent-api/im/admin/wecom/bind` | ops 保存企微凭据 |
| `POST /agent-api/im/admin/:channel/reconnect/:id` | ops 重连 |
| `DELETE /agent-api/im/admin/:channel/bots/:id` | ops 取消关联任务并移除机器人 |

`channel` 仅接受 `weixin`、`wecom`。确认、问题答复、事件读取和停止复用既有银行会话接口，不增加宽松的 IM 执行接口。

## 验证

```powershell
npm --prefix framework run bootstrap:customer
npm --prefix framework run check:dsh
npm --prefix framework run test:im
npm --prefix framework run test:im:browser
```

浏览器测试需要 `tools` 的 `playwright-core` 和 Chrome/Edge，可用 `CHROME_PATH` 指定路径。测试复用实际插件控制器及微信/企微运行时，外部协议和银行服务使用隔离夹具；另以真实 DSH 0.2.1 和本地模型协议验证文字回合。覆盖来源隔离、绑定、加密、过期、重启、解除、授权交接、回传、运维权限、错误支付密码及桌面/手机页面，不调用真实 IM 或付费模型。

完整银行与会话库回归仍需原有四个专用 PostgreSQL 测试连接，见 [后端验证说明](../../server/README.md#验证)，缺少连接不视为通过。实际微信/企微还需用户扫码或自己的机器人凭据，夹具通过不代表线上已连接。
