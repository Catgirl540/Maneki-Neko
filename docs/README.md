# 文档索引

仓库文档按「读的人要做什么」分组。改代码前先看第一组；其余按需查阅。

## 先读这三份

| 文档 | 用途 |
| --- | --- |
| [CLIENTS.md](../CLIENTS.md) | 客户端版本核对：当前网页在 `app/`，安卓在 `android-app/`，`archive/` 不参与开发 |
| [README-START.md](../README-START.md) | 本地起前端、PostgreSQL 后端和演示登录 |
| [product/account-model.md](product/account-model.md) | **账户模型约束**：一个资金账户、多币种余额、多张卡；改账户/卡/流水/换汇前必读 |

## 契约与产品

| 目录 / 文档 | 内容 |
| --- | --- |
| [api/](api/README.md) | HTTP 接口契约：端点、错误码、请求响应类型（**接口的单一事实源**） |
| [product/](product/) | 产品规则：账户模型、会员、理财产品、卡与权益、财富工作区 |
| [bank-database-design.md](bank-database-design.md) | 数据表与索引设计 |
| [bank-postgresql-operations.md](bank-postgresql-operations.md) | PostgreSQL 运维手册（当前生产口径） |
| [bank-ai-session-postgresql.md](bank-ai-session-postgresql.md) | AI 会话库的独立角色与迁移 |
| [unified-bank-environment.md](unified-bank-environment.md) | 官网、工作人员与运维现行统一数据源、历史保全和部署验收 |
| [operations-maintenance.md](operations-maintenance.md) | 日常运维与备份 |

## 设计依据

| 目录 | 内容 |
| --- | --- |
| [design/](design/README.md) | 当前网页视觉依据、品牌资源、验证截图 |
| [design/mobile-ui/](design/mobile-ui/index.md) | 安卓客户端界面规范 |

## 验收与历史

| 目录 / 文档 | 内容 |
| --- | --- |
| [testing/](testing/) | 功能修复与验收记录（按日期） |
| [deployments/](deployments/README.md) | 每次上线的发布记录（JSON） |
| [notes/](notes/) | 临时笔记，不作为规范 |
| [agent-workbench.md](agent-workbench.md) | 助手工作台与 IM 接入的演进记录 |
| [backend-memory-20261022.md](backend-memory-20261022.md) | 后端内存治理结论 |
| [staff-im-development-20261021.md](staff-im-development-20261021.md) | 工作人员端 IM 开发记录 |
| [overnight-20261020.md](overnight-20261020.md) / [delivery](overnight-20261020-delivery.md) | 2026-10-20 通宵开发与交付 |

历史归档（旧客户端、旧网页、已迁移文档）在 [archive/](../archive/README.md)，默认不搜索、不修改。
