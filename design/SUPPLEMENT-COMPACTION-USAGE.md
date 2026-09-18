# 补课：长对话压缩与用量统计

> 2026-09-17。P5（后端桥）因银行后端未就绪而**挂起**，本文件记录同期补上的两个
> sdk-minimal 出厂就缺的能力，以及一条**被同一个后端阻塞**的项（人工审批）。

## 1. 补了什么

`sdk-minimal` 不带压缩、也不带用量统计：聊长了会直接顶爆上下文，而且没有任何成本数字。
按 `dsh-base` 的出厂行挂了四行（配置照抄，未自创）：

| 行 id | 包 | 作用 |
|---|---|---|
| `token-meter` | `@deepseek-ai/dsh-token-meter` | `ctx.tokenMeter`：从会话日志**确定性**估算 token 与上下文压力，不发模型调用 |
| `session-checkpoint-policy` | `@deepseek-ai/dsh-session-checkpoint-policy` | 每次模型请求/顶层分发前的持久化检查点 |
| `tool-result-pruner` | `@deepseek-ai/dsh-compaction-tool-result-pruner` | 压力达标时把超大工具输出换成"头部 + 中间已裁剪 + 尾部"，**原始结果仍留在会话日志里** |
| `compaction-basic` | `@deepseek-ai/dsh-compaction-basic` | 压力接近上限时把最老的历史压成摘要；溢出后压一次再重试；用一次额外模型请求 |

**发现一条硬依赖**：`compaction-basic` 的 `static inject = ['llm', 'tokenMeter', 'sessions']`
——它**必须**有 token-meter，否则会一直 pending。所以这两行要一起挂（我们是一起挂的）。

## 2. 已验证到什么程度（说清楚边界）

| 断言 | 结果 |
|---|---|
| 四行都在组合树里 | ✅ 验收门 V2f |
| `compaction` 服务**真的激活**（不只是行在树里） | ✅ 探针报 `compaction=ACTIVE` |
| `tokenMeter` 服务真的激活 | ✅ 探针报 `tokenMeter=ACTIVE` |
| 启动零告警（没有 pending 条目） | ✅ |
| **压缩真的被触发过一次** | ❌ **未验证** |

最后一条必须诚实标注：`compaction-basic` 与 `tool-result-pruner` **只在 token 压力下动作**
（上游原文：*"below-pressure conversations remain unchanged"*），而我们默认路由的模型声明了
1M 上下文——要触发就得构造一个"上下文很小"的路由，那属于测试脚手架塞进生产配置，
我没有这么做。

**要补这一条验证的代价**（供决定）：加一个只用于测试的模型路由，把声明的 `contextWindow`
调到几千，跑一轮会产生大输出的对话，然后断言会话日志里出现 `compaction/start` 事件。
约需 30–60 分钟，且要接受"测试路由进配置"或"由脚本派生 overlay"。

## 3. 被同一个后端阻塞的项：人工审批接线

- SDK 协议**没有**审批方法；DSH 里唯一的真实 answerer 是 **Web 客户端 UI**
  （`packages/client/ui-approval`，通过 interaction 服务注册待决交互）。
- 也就是说：审批要通到"人"，需要一条**通到人的通道**——而这正是 P5 卡住的那部分
  （后端 + 前端）。
- 当前形态下的行为是**正确的 fail-closed**：`ctx.approval` 的 `ask` 在没有 answerer 时
  一律 deny（我们在 P0/P3 都实测过这条路径）。
- 结论：**不做技术兜底**，等后端就绪后与审批一起做；业务上先确认"是否需要人工审批"。

## 4. 现在的整体状态

| 项 | 状态 |
|---|---|
| 底座与安全（P0–P4） | ✅ 完成并验证（离线门 51 条 + 3 个可选端到端门） |
| 长对话压缩 / 用量统计 | 🟡 已挂并确认服务激活；**触发未验证** |
| 后端桥（P5） | ⛔ 挂起——等银行后端；对接面见 [BACKEND-CONTRACT.md](BACKEND-CONTRACT.md) |
| 人工审批 | ⛔ 与 P5 同一阻塞点 |