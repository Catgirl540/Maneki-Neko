# 登录密码与账号冻结

2026-10-28。适用于银行 HTTP 后端、网页模拟业务与安全设置。账户关系遵循 [单资金账户约束](../product/account-model.md)。

## 登录密码

注册 `POST /api/auth/register` 与修改 `POST /api/security/password` 在服务端共同校验：至少 8 个 Unicode 字符，必须包含 ASCII 大写字母、小写字母，以及至少一个标点或符号（例如 `!@#`）；空格不能充当特殊字符，数字不是必需。保留密码散列的 1024 字节上限。校验失败返回 `400 WEAK_PASSWORD`，不保存新密码。

网页注册和修改界面采用同一规则。已有登录密码仍可验证，修改时必须满足新规则；不能通过收紧登录检查把已有客户锁在登录页外。

## 支付错误与冻结

支付密码仍为 6 位数字。按客户档案累计连续验证失败次数，与设备、登录会话及具体付款入口无关：前 4 次返回 `401 BAD_PAY_PASSWORD` 并提示剩余次数，第 5 次返回 `423 ACCOUNT_FROZEN`。未被冻结时，一次正确支付验证清零连续错误次数。

冻结状态从持久化的 `payPasswordFailures >= 5` 派生；拒绝业务请求时仍单独持久化错误计数，业务变更回滚。正确支付验证后的计数清零也会保留，即使随后的业务校验失败；失败的业务修改不会保存。重新登录、退出登录、进程重启、修改或人脸重置支付密码都不能解除冻结。冻结后保持登录、普通只读查询和联系客服，禁止支付、敏感卡信息查询及账户敏感修改，也覆盖原本不要求支付密码的业务入口和原生银行支付 `POST /api/bank-payments`。

`GET /api/security/overview` 和工作人员客户资料的 `accountSecurity` 返回：

| 字段 | 含义 |
| --- | --- |
| `frozen` | 是否因支付密码错误冻结 |
| `failedAttempts` | 连续错误次数，最多 5 |
| `maxAttempts` | 固定为 5 |
| `reason` | 冻结说明；未冻结时为 `null` |

这是客户级操作限制，不扣减余额、不调整已有在途转账预留，不拆分币种余额或创建新资金账户。银行卡锁定/挂失与此冻结分别管理；解锁一张卡不能解除账号冻结。

业务校验失败时使用事务保存点撤销业务变更，同时保留跨进程锁，仅提交本次验密的安全计数及审计。冻结期间暂停待执行的定时转账、生日预留和在途转账自动放行，解冻后恢复原指令处理。

## 工作人员解冻

工作人员通过代客办理调用 `POST /staff-api/customers/:customerId/actions/unfreezeAccount`，沿用 `CustomerActionRequest`：必须关联该客户正在受理的工单，填写事由、身份核验方式 `phone | sms | face`，并标记核验通过。客服需为工单负责人或工单尚未分配；主管可处理。运维角色、客户登录令牌及 Agent 令牌不能执行此操作。

成功后仅清除支付错误次数，保持原支付密码、卡片状态、余额、资金预留和流水不变。审计保存员工身份、目标客户、工单、事由及操作结果。客户 API 不提供自行解冻入口。

工作人员可从“客户查询 → 完整资料 → 办理账号解冻”进入表单。live 模式也可读取客户基本身份和 `accountSecurity` 并解冻；未接入的资金资料返回空列表及 `financialDataAvailable=false`，不展示历史演示资金。

统一环境实现使用 `/staff/login` 登录，工作人员不再选择办理环境。官网客户、工作人员 API 及工作人员/运维 Agent 共用现有 `maneki_bank_demo`；标准 `/staff-api/` 与旧 `/staff-demo-api/` 兼容入口连接同一后端，旧 `?bank=demo`、`?bank=live` 链接不再选择其他数据源。客户、客服、主管与运维的鉴权和角色权限保持独立，运维仍不能代客解冻；重启银行后工作人员须重新登录。连接、历史数据保全及线上验收状态见 [统一银行环境说明](../unified-bank-environment.md)。

## 回归

```bash
node --test server/account-security.test.mjs
node --import ./tools/ts-resolve-hook.mjs tools/check-account-security.mjs
npm --prefix app run check:account-model
```

HTTP 用例需要显式配置可丢弃的 `BANK_HTTP_TEST_DATABASE_URL`，缺少配置时会标记跳过，不代表持久化集成验证通过。HTTP 用例覆盖连续错误、并发请求、事务回滚、客户隔离、登录与服务重启保持冻结、工作人员核验解冻及资金不变；内存用例验证服务端与浏览器模拟遵守同一规则。

## 2026-11-02 安全修复约束

资金与敏感状态变更中列入 `IDEMPOTENT_METHODS` 的接口必须携带 `Idempotency-Key`，缺少时返回 400 `IDEMPOTENCY_KEY_REQUIRED`。网页只在 sessionStorage 保存随机操作编号和请求摘要，不保存请求正文或密码；网络错误保留编号，同请求重试复用编号，变更参数前先核查或封存旧编号。Agent 写请求统一采用会话、调用及工具绑定的编号。

一次性导出下载同时验证当前客户与票据归属；其他客户访问不消费票据。助手链接通过网页携带 Bearer 下载，不再把裸链接视为授权。CSV 的不可信文本单元格对公式前缀加文本标记，金额等数值仍按数值导出。

助手 HTTP 与事件错误统一隐藏内部异常；跨域默认仅允许当前来源，开发时用 `LUCKYCAT_ALLOWED_ORIGINS` 明确列出合法来源。客户、员工及运维文字入口均执行凭据预检，图片和语音功能保留。运维 Shell、写入、网络及进程终止操作即使获模型低风险判断也必须人工确认；Harness 子进程不再继承银行或会话数据库凭据。

回归：`shared/security-fixes.test.mjs`、`server/security-required-key.test.mjs`、`server/export-store.test.mjs`、`framework/bridge/security-fixes.test.mjs` 及既有 AA 确认测试。宿主读权限/网络隔离和多模态本地凭据识别仍需独立补强，不能将本次代码加固当作已完成线上部署。

远端凭据决策仅接收已隐藏不透明数字/字母串的消息表示，保留上下文与值的长度/形态；不应把这层处理解释为图片/音频识别或业务模型上下文的全面匿名化。
