# 理财 Agent 赛题工程

## 归属

本目录是 AI Banking Agent 赛题（国内赛道）的独立工程目录。与队友日常迭代的 `app/`、`staff/`、`framework/` 解耦，共享文件只做薄委托。

## 红线

1. **资金变动只走 `submitTransfer` + `persist()`**，绝不直接改 `bank_accounts` / `bank_transactions` 投影表
2. **不直接改 `app_storage` JSON**（权威数据）
3. **不改 `app/src/api/{types,contract,http,mock}`**（P1/P2 零触碰，防撞）
4. **不改 `app/src/lib/wealth.ts`**（合规文案红线）
5. **`git add` 只加自己改的文件**，不 `git add .`

## 怎么跑

```bash
# 纯逻辑测试（不需要网络/浏览器/模型）
node --import ./tools/ts-resolve-hook.mjs challenge/checks/check-scheduled.mjs
node --import ./tools/ts-resolve-hook.mjs challenge/checks/check-payee-resolve.mjs

# 集成测试（本机假银行夹具）
node tools/check-challenge.mjs

# 白名单一致性
node framework/scripts/check-bank-tool-policy.mjs

# 演示
node server/index.mjs                                    # 后端 8080
node framework/bridge/demo-server.mjs                    # Agent 桥接 8788
cd app && npm run dev                                    # 客户端 5180
```

## 目录结构

```
challenge/
├── bridge/          # 业务纯逻辑（.mjs，不碰 storage/共享文件）
│   ├── scheduled.mjs        # 定时动作状态机 + 演示缩时
│   ├── payee-resolve.mjs    # 收款人消歧（别名/人名/手机号/流水）
│   └── tools.mjs            # bank-agent.mjs 的 prepare/execute 委托
├── mock/            # 数据层（操作 profile.challenge 附加段）
│   ├── state.mjs            # ChallengeState 形状 + ensure/seed
│   └── scheduled-api.mjs    # list/create/cancel/runDue
├── data/            # 种子数据
│   └── payee-aliases.json   # 收款人别名（「我妈」→ 陈嘉禾）
├── checks/          # 纯逻辑测试
├── eval/            # 评测题库（Phase 3）
├── scenario/        # 场景规格
├── demo/            # 演示脚本
└── prompt/          # 人设补充（env 注入）
```

## 共享文件的薄改

| 文件 | 改动 | 行数 |
|---|---|---|
| `framework/packages/bank-demo/src/challenge-tools.ts` | 新建（工具 schema） | 0（新建） |
| `framework/packages/bank-demo/src/http-tools.ts` | import + 数组展开 | +2 |
| `framework/bridge/bank-agent.mjs` | import + 两个 Set + default 委托 + execute 钩子 | +8 |
| `framework/profiles/luckycat/{cordis,doctor}.patch.yml` | allowedTools 追加 4 行 | +4 each |
| `framework/bridge/demo-bank.mjs` | scheduledApi + tickHolds 挂载 + 4 个方法 | +35 |
| `server/index.mjs` | /api/agent/challenge/* 路由 + readJsonBody | +35 |

## Phase 1 范围

- scheduled-action 底座 v1（状态机 + 演示缩时 + tickHolds 挂载）
- 别名转账（`bank_resolve_payee`）
- 定时转账（`bank_schedule_transfer` / `bank_list_scheduled` / `bank_cancel_scheduled`）
- 卡片管理（零开发，用现成工具编排演示）

## Phase 2 计划

- AA 拆单（`bank_aa_split`）
- 理财推荐对比（`bank_wealth_compare`）
- 跨场景联动（`bank_create_plan` 等）

## 演示缩时

| 环境变量 | 默认 | 说明 |
|---|---|---|
| `BANK_SCHEDULER_DEMO_SECONDS` | 20 | 缩时窗口（秒），0 = 关闭 |
| `BANK_SCHEDULER_DEMO_STAGGER_SECONDS` | = DEMO | 多步骤计划步间间隔 |
