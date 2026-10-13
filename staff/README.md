# 工作人员端维护说明

## 本地启动

需要 Node.js 24。在仓库根目录执行：

```bash
npm --prefix staff ci
VITE_USE_MOCK=false npm --prefix staff run dev
```

默认地址 `http://127.0.0.1:5181/assistant`。银行后端监听 8080，员工 Agent 8789，运维 Agent 8790；运行时和密钥配置见 [工作人员 Agent](../docs/api/staff-agent.md)。网页 mock 模式不连接 Agent。

## 共享聊天

`src/pages/assistant/AssistantPage.tsx` 接入客户端的 `app/src/components/agent/ChatWorkspace.tsx`。两端共用流式消息、图片压缩、语音、Markdown、历史抽屉、编辑与重新生成；不要再复制一份聊天界面。

- 传输：`app/src/api/agent.ts` 的 `createAgentClient` 为每条通道创建独立实例。员工端 `src/api/agent.ts` 注入员工令牌，客服/主管使用 `/staff-agent-api`，运维使用 `/staff-ops-agent-api`。
- 历史：存档键包含 `staff.角色.员工ID`，身份变更时重建工作区。朗读缓存随工作区释放。
- 确认：`StaffConsentCard.tsx` 保留员工核验流程；不使用客户支付密码确认卡。语音不会自动批准操作。
- 样式：颜色和圆角在 `src/styles/tokens.css`，共享动效在 `app/src/styles/chat.css`。Tailwind 扫描共享源码，Vite 合并 React 实例，TypeScript 统一 React 类型。

聊天通道不可用时禁用输入并提示重试，不调用客户客服接口。员工令牌失效时返回登录页。

## 人工工单

客户通过“助手 → 转人工”或 Agent 确认提交后，工单进入“工单中心”。列表和打开的详情每 3 秒检查更新。员工接手后可回复客户、等待补充和标记解决；客户补充会出现在同一处理记录中。已解决工单只读。客户接口只公开客户提交的工单，不公开员工内部工单及审批资料。联调使用 `node tools/check-human-support.mjs --browser`。

## 验证

```bash
VITE_USE_MOCK=false VITE_BASE_PATH=/staff/ npm --prefix staff run build
npm --prefix staff run lint
node tools/check-staff-agent.mjs --browser
node tools/check-ops-agent.mjs --browser
node tools/check-agent-streaming.mjs
node tools/check-agent-http.mjs --browser
```

浏览器检查可通过 `CHROME_BIN` 指定 Chromium。夹具使用临时数据库与本地模型协议，覆盖图片、语音、角色隔离、确认卡及手机布局。共享代码修改后同时回归客户端；真实计费抽查使用 `tools/check-staff-media-live.mjs`，详见 Agent 文档。
