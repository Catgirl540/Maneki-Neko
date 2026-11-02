# 本地安全核查执行记录

日期：2026-11-02；Node v22.22.1。运行环境删除业务数据库与模型凭据配置。第一次受沙箱回环监听限制的结果不纳入以下复跑统计。

顶层文件数：59；Node 用例：215，通过176、失败1、跳过38。插件46项与探针5项单独记录，合并266项、通过227、失败1、跳过38。

## 可复现入口

```bash
python3 docs/submission/security-evidence/run-local-tests.py
node framework/packages/consent/tests/consent.test.mjs
node framework/packages/hardening/tests/hardening.test.mjs
node docs/submission/security-evidence/security-probes.mjs
node --import ./tools/ts-resolve-hook.mjs tools/check-markdown.mjs
node tools/check-budgets.mjs
npm --prefix app run check:account-model
node framework/scripts/check-bank-tool-policy.mjs
```

复跑器逐文件执行，以保留子测试结果；会在 /tmp/maneki-security-audit 写临时记录。未提供专用数据库时，相应用例按既定开关跳过。不要将真实业务库配置注入该脚本。

## 各文件结果

| 测试文件 | 总数 | 通过 | 失败 | 跳过 |
| --- | --- | --- | --- | --- |
| framework/bridge/agent-services.test.mjs | 3 | 3 | 0 | 0 |
| framework/bridge/assistant-query.test.mjs | 1 | 1 | 0 | 0 |
| framework/bridge/autodebit-analysis.test.mjs | 5 | 5 | 0 | 0 |
| framework/bridge/bank-reminder-agent.test.mjs | 1 | 1 | 0 | 0 |
| framework/bridge/bank-reminders.test.mjs | 9 | 9 | 0 | 0 |
| framework/bridge/clef-reviewer.test.mjs | 5 | 5 | 0 | 0 |
| framework/bridge/credential-guard.test.mjs | 5 | 5 | 0 | 0 |
| framework/bridge/demo-server-persistence.test.mjs | 4 | 4 | 0 | 0 |
| framework/bridge/extended-bank-agent.test.mjs | 1 | 1 | 0 | 0 |
| framework/bridge/im-availability.test.mjs | 1 | 1 | 0 | 0 |
| framework/bridge/im-customer-qr.test.mjs | 3 | 3 | 0 | 0 |
| framework/bridge/im-local.test.mjs | 2 | 2 | 0 | 0 |
| framework/bridge/im-query.test.mjs | 1 | 1 | 0 | 0 |
| framework/bridge/im.test.mjs | 10 | 8 | 0 | 2 |
| framework/bridge/invest-plan-agent.test.mjs | 1 | 1 | 0 | 0 |
| framework/bridge/model-retry.test.mjs | 3 | 3 | 0 | 0 |
| framework/bridge/ops-gate.test.mjs | 6 | 6 | 0 | 0 |
| framework/bridge/sdk-session-resume.test.mjs | 1 | 1 | 0 | 0 |
| framework/bridge/session-memory.test.mjs | 3 | 3 | 0 | 0 |
| framework/bridge/session-store.test.mjs | 4 | 3 | 0 | 1 |
| framework/bridge/split-collection-schema.test.mjs | 1 | 1 | 0 | 0 |
| framework/bridge/split-collection.test.mjs | 5 | 4 | 1 | 0 |
| framework/bridge/staff-agent.test.mjs | 1 | 0 | 0 | 1 |
| framework/bridge/staff-im-worker.test.mjs | 6 | 6 | 0 | 0 |
| framework/bridge/staff-im.test.mjs | 2 | 2 | 0 | 0 |
| framework/bridge/tool-result.test.mjs | 2 | 2 | 0 | 0 |
| framework/bridge/transaction-review.test.mjs | 5 | 5 | 0 | 0 |
| framework/bridge/transfer-recall.test.mjs | 2 | 1 | 0 | 1 |
| framework/bridge/wealth-compare.test.mjs | 4 | 4 | 0 | 0 |
| server/aa-payments-http.test.mjs | 3 | 0 | 0 | 3 |
| server/aa-payments.test.mjs | 4 | 4 | 0 | 0 |
| server/account-security.test.mjs | 3 | 2 | 0 | 1 |
| server/bank-connect.test.mjs | 6 | 4 | 0 | 2 |
| server/banking-http.test.mjs | 4 | 0 | 0 | 4 |
| server/billing-reports.test.mjs | 3 | 3 | 0 | 0 |
| server/card-state.test.mjs | 1 | 0 | 0 | 1 |
| server/export-store.test.mjs | 1 | 1 | 0 | 0 |
| server/extended-banking.test.mjs | 3 | 0 | 0 | 3 |
| server/idempotency-resolution.test.mjs | 1 | 0 | 0 | 1 |
| server/invest-plan.test.mjs | 3 | 3 | 0 | 0 |
| server/linked-plans.test.mjs | 6 | 6 | 0 | 0 |
| server/maintenance-passwords.test.mjs | 6 | 6 | 0 | 0 |
| server/operations.test.mjs | 1 | 1 | 0 | 0 |
| server/ops-terminal.test.mjs | 4 | 4 | 0 | 0 |
| server/passwords.test.mjs | 4 | 4 | 0 | 0 |
| server/payment-plans.test.mjs | 8 | 8 | 0 | 0 |
| server/pg-auth-support.test.mjs | 5 | 4 | 0 | 1 |
| server/pg-staff.test.mjs | 5 | 5 | 0 | 0 |
| server/postgres-database.test.mjs | 13 | 0 | 0 | 13 |
| server/profile-recovery.test.mjs | 3 | 3 | 0 | 0 |
| server/spend-subscription.test.mjs | 1 | 0 | 0 | 1 |
| server/staff-im.test.mjs | 2 | 1 | 0 | 1 |
| server/staff-unfreeze.test.mjs | 11 | 11 | 0 | 0 |
| server/statistics.test.mjs | 3 | 3 | 0 | 0 |
| server/subscriptions.test.mjs | 3 | 3 | 0 | 0 |
| server/support-guidance.test.mjs | 3 | 2 | 0 | 1 |
| server/transfer-hold-currency.test.mjs | 1 | 0 | 0 | 1 |
| server/wealth-redemption.test.mjs | 4 | 4 | 0 | 0 |
| shared/reference-queries.test.mjs | 3 | 3 | 0 | 0 |

## 跳过的测试名称

- real installed DSH 0.2.1 runtime answers a bound IM session through a local model protocol # SKIP
- browser: bind a private chat, inspect bank confirmation, correct a password, receive the result and manage bots # SKIP
- PostgreSQL AI sessions preserve ownership, encrypted events, interrupted turns and offline migration # SKIP
- 员工工具在独立 PostgreSQL HTTP 后端验证权限、确认与真实业务 # SKIP
- real local bank Agent transfers and recalls USD only after exact consent and rejects stale or foreign recalls # SKIP
- merged AA allocation verifies computed phone amounts, preserves details across restart and cancels inbox requests # SKIP
- AA phone notifications persist, isolate members, require PIN, preserve remarks and settle exactly once # SKIP
- AA cancellation reaches member inbox; large payments use existing held-transfer approvals and recall can be retried # SKIP
- HTTP payment freeze persists across rejected transactions, simultaneous attempts, sessions and restart # SKIP BANK_HTTP_TEST_DATABASE_URL is not configured; PostgreSQL persistence and native HTTP checks require a disposable test database
- partner custody PostgreSQL state machine requires verified bank authorization and settlement # SKIP
- PostgreSQL accounting policy, posting and day close preserve immutable exact balances # SKIP
- investment plans preserve budgets, isolate customers, deduplicate retries and enforce versioned lifecycle # SKIP
- bank HTTP transactions and security preserve customer budgets and balanced accounting # SKIP
- single funding HTTP migration, currency transfers and fees remain atomic and idempotent # SKIP
- explicit live mode in an isolated production fixture rejects unavailable SMS and identity providers # SKIP
- HTTP applied pending card cannot bypass activation; formal loss recovery preserves status, ownership and funds # SKIP
- scoped restart preserves an existing seeded customer history when another customer is current # SKIP
- extended HTTP tasks persist, restart, execute once, retain recall approval and roll back injected settlement faults # SKIP
- production live mode rejects every new banking API method before demo state or background tasks can change # SKIP
- resolution seals absent keys or returns a committed result atomically, scoped to the customer # SKIP
- PostgreSQL auth, one-use challenges and concurrent support/idempotency retries # SKIP
- PostgreSQL round trip encrypts customer domains and uses safe exact integers # SKIP
- repeated snapshots keep sequence identity and post balance deltas once # SKIP
- scoped projection loads only requested customers and preserves unrelated bindings and historical rows # SKIP
- scoped projection rolls back financial identity changes and refreshes after cross-process locking # SKIP
- scoped recovery keeps the cross-process lock and persists only the security event # SKIP
- full recovery keeps the cross-process lock and persists only the security event # SKIP
- single funding migration preserves frozen money, original transaction identity and retired ledger history across restart # SKIP
- unit of work commits audit SQL and final profile together and rolls both back # SKIP
- two processes refresh after the PostgreSQL advisory lock without lost updates # SKIP
- invalid money and references roll back a complete multi-customer flush # SKIP
- SQL guards reject unbalanced postings, changed history and posted appends # SKIP
- commit constraints reject balance tampering and unposted journals; runtime refuses DDL # SKIP
- one-time SQLite import retains balances, journal ids, encrypted data and audit rows # SKIP
- subscription purchase persists its mandate atomically and rejects duplicates and cross-owner cards # SKIP
- staff IM PostgreSQL: transactional events, routing, revocation, leases and role checks # SKIP
- fallback HTTP replies authenticate the customer, disclose static scope and cannot change bank funds # SKIP
- foreign currency transfer holds release the exact partition, preserve other holds and settle atomically # SKIP

## 失败详情

framework/bridge/split-collection.test.mjs 中的 AA agent review and submitted request use the same per-activity calculation：本人份额 CNY 200.00 展示断言未满足。其余四项该文件测试通过。未修改业务实现或删除失败断言。

## 补充检查

- 授权插件29项、加固插件17项全部通过。
- 合成探针5项全部达到预期；CSV与下载探针是风险特征确认，不代表已修复。
- Markdown检查23项、日预算18项、单账户断言6项通过。
- 客户两份 profile 各100项工具检查通过；员工 profile 21项通过。
- 运维 profile 由 bootstrap-staff.mjs 生成；本轮读取生成逻辑，没有运行 bootstrap 或读取现有运行目录。不能将源模板目录缺少生成文件当作部署故障。
- 未访问公网、SSH、业务数据库、现有会话或密钥文件。

## 修复后复跑

修复后 62 个顶层文件：223项、185通过、0失败、38跳过。授权与加固插件46项以及更新后的探针5项通过，合计274项、236通过、0失败、38跳过。探针脚本现已从风险特征断言改为修复后行为断言，修复前观察保留于本记录与原始证据索引。网页及工作人员构建通过。

完整逐文件结果见 test-summary-after-fix.json。修复中未执行发布、业务迁移或真实数据操作。
