# Phase 1 演示脚本：「能约能转」

## 场景

用户想给母亲（陈嘉禾）后天早上转 200 块，用定时转账。

## 演示流程

### 1. 启动服务

```bash
# 后端（8080）
node server/index.mjs

# Agent 桥接（8788）
node framework/bridge/demo-server.mjs

# 客户端（5180）
cd app && npm run dev

# 可选：演示缩时（默认 20 秒，0 = 关闭）
export BANK_SCHEDULER_DEMO_SECONDS=20
```

### 2. 对话

**用户**：给我妈后天早上转 200 块

**Agent 应做的事**：
1. 调 `bank_resolve_payee({ query: '我妈' })` → 解析出陈嘉禾
2. 调 `bank_schedule_transfer({ ... })` → 弹确认卡
3. 确认卡显示：
   - 收款人：陈嘉禾
   - 收款账号：****4471
   - 转账金额：CNY 200.00
   - 执行时间：2026-10-18T09:00:00.000Z
   - 演示模式：约 20 秒后执行（原定 2026-10-18T09:00:00.000Z）

**用户**：确认 + 输入支付密码（888888）

**Agent**：已创建定时转账，将在后天早上 9:00 自动执行（演示模式约 20 秒后）。

### 3. 等待约 20 秒

定时动作触发，流水新增一笔转账记录，余额变动，前端收到 `bank-updated` 事件。

### 4. 查看定时动作

**用户**：看看我的定时转账

**Agent**：调 `bank_list_scheduled({})` → 显示列表

### 5. 取消定时转账（另一笔）

**用户**：取消刚才那笔定时转账

**Agent**：调 `bank_cancel_scheduled({ actionId: 'sch_xxx' })` → 确认卡 → 取消成功

### 6. 叠加卡片管理（现成工具，零开发）

**用户**：帮我锁一下卡

**Agent**：调 `bank_list_cards({})` → `bank_set_card_lock({ cardId, locked: true })` → 确认卡 → 锁卡成功

## 验收清单

- [ ] 别名「我妈」正确解析为陈嘉禾
- [ ] 确认卡含双时间行（原定 + 演示）
- [ ] 支付密码验证通过后创建定时动作
- [ ] 约 20 秒后定时动作触发，流水落账
- [ ] 「看看我的定时转账」返回可读列表
- [ ] 取消定时转账成功
- [ ] 卡片管理工具正常（现成的）
- [ ] `node tools/check-challenge.mjs` 全绿
- [ ] `node framework/scripts/check-bank-tool-policy.mjs` 通过

## 两个核心场景覆盖

| 场景 | 状态 |
|---|---|
| 智能转账 | 定时转账 + 别名解析（Phase 1 新增） |
| 卡片管理 | 锁卡/解锁/申请/换卡/设置（现成，零开发） |
