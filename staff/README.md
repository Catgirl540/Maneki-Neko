# 工作人员端维护说明

工作人员与客户网站使用同一套银行业务数据，登录页不再选择办理环境。所有工作人员业务请求统一使用 `/staff-api/`；旧登录链接中的 `?bank=demo`、`?bank=live` 和浏览器中遗留的环境选择均不影响请求路由。客服、主管、运维仍按原角色权限登录，工作人员助手、IM 和运维功能沿用各自的鉴权通道。

上线统一环境后，沿用原工作人员数据库中的现有凭据，不重置密码；初始化环境变量不覆盖已有工作人员密码。工作人员使用各自现有账号密码登录，登录页不展示账号密码。合并时提升工作人员鉴权版本，使旧会话失效后重新登录。

## IM 机器人设计

客服与主管的微信接入、任务自动提醒和配置见 [工作人员 IM 维护说明](../docs/api/staff-im.md)，原方案见 [设计方案](../docs/product/staff-im-robot-design.md)。入口为「IM 机器人」；代码已实现，默认关闭，尚未上线或进行真实微信投递验收。运维暂不在本次范围。

## 本地启动

需要 Node.js 24。在仓库根目录执行：

```powershell
npm --prefix app ci
npm --prefix staff ci
$env:VITE_USE_MOCK='false'
$env:VITE_PROXY_TARGET='http://127.0.0.1:8080'
npm --prefix app run dev
```

默认只启动一个前端服务：客户端登录页 `http://127.0.0.1:5180/login`，工作人员登录页 `http://127.0.0.1:5180/staff/login`，工作人员助手页 `http://127.0.0.1:5180/staff/assistant`。客户端登录页可切换到工作人员入口。

需要单独开发工作人员页面时，也可运行 `npm --prefix staff run dev`，使用 `http://127.0.0.1:5181/login`。银行后端监听 8080，员工 Agent 8789，运维 Agent 8790；运行时和密钥配置见 [工作人员 Agent](../docs/api/staff-agent.md)。网页 mock 模式不连接 Agent。

## 共享聊天

`src/pages/assistant/AssistantPage.tsx` 接入客户端的 `app/src/components/agent/ChatWorkspace.tsx`。两端共用流式消息、图片压缩、语音、Markdown、历史抽屉、编辑与重新生成；不要再复制一份聊天界面。

- 传输：`app/src/api/agent.ts` 的 `createAgentClient` 为每条通道创建独立实例。员工端 `src/api/agent.ts` 注入员工令牌，客服/主管使用 `/staff-agent-api`，运维使用 `/staff-ops-agent-api`。
- 历史：存档键包含 `staff.角色.员工ID`，身份变更时重建工作区。朗读缓存随工作区释放。
- 确认：`StaffConsentCard.tsx` 保留员工核验流程；不使用客户支付密码确认卡。语音不会自动批准操作。
- 样式：颜色和圆角在 `src/styles/tokens.css`，共享动效在 `app/src/styles/chat.css`。Tailwind 扫描共享源码，Vite 合并 React 实例，TypeScript 统一 React 类型。

聊天通道不可用时禁用输入并提示重试，不调用客户客服接口。员工令牌失效时返回登录页。

## 人工工单

客户通过“助手 → 转人工”或 Agent 确认提交后，工单进入“工单中心”。列表和打开的详情每 3 秒检查更新。员工接手后可回复客户、等待补充和标记解决；客户补充会出现在同一处理记录中。已解决工单只读。客户接口只公开客户提交的工单，不公开员工内部工单及审批资料。联调使用 `node tools/check-human-support.mjs --browser`。

## 网页样式与运维终端

工作人员端沿用当前用户端的紫色品牌、猫标、蓝紫登录背景和桌面侧栏。颜色统一引用 `app/src/styles/tokens.css`；工作人员布局在 `src/styles/global.css`，聊天样式限定在 `src/styles/workspace.css`，不改客户页面。仅验收桌面网页。

工作台统计来自工单接口，点击可进入对应筛选；待处理队列可直接打开工单。客户资料查看事由、身份核验、业务确认和角色限制继续保留。

运维监控的“终端”使用 xterm.js + node-pty，每个标签对应后端独立 Shell。支持新建/关闭标签、最大化、清屏、复制选中文本、Ctrl+C 和窗口尺寸同步；切换“概览”保留标签。离开运维页会关闭该页会话，退出登录会由后端立即回收。断线可重连；输出最多保留 512 KiB，断开且无操作 15 分钟后回收，每个运维账号最多 8 个终端。

终端 API 和上线条件见 [运维终端说明](../docs/api/ops-terminal.md)。默认关闭；不能使用公开演示密码启用公网 Shell。后端和前端必须一并发布，静态前端单独更新不会启用终端。

## 验证

```bash
VITE_USE_MOCK=false VITE_BASE_PATH=/staff/ npm --prefix staff run build
npm --prefix staff run lint
node tools/check-staff-unified.mjs
node tools/check-staff-agent.mjs --browser
node tools/check-ops-agent.mjs --browser
node tools/check-agent-streaming.mjs
node tools/check-agent-http.mjs --browser
```

浏览器检查可通过 `CHROME_BIN` 指定 Chromium。夹具使用临时数据库与本地模型协议，覆盖图片、语音、角色隔离、确认卡及手机布局。共享代码修改后同时回归客户端；真实计费抽查使用 `tools/check-staff-media-live.mjs`，详见 Agent 文档。

`check-staff-unified.mjs` 在构建后的 `staff/dist/` 上运行 Chromium，使用本地 HTTP 夹具验证旧环境链接与缓存、客服/主管/运维路由、助手与 IM 通道、员工令牌隔离、退出及 Agent 401。此检查无需数据库或模型服务。
