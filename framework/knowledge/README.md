# 网页知识库维护

## 内容与来源

本目录的 8 篇 Markdown 是生产知识源，README 不参与检索。只覆盖网页客户端；规则以银行接口、业务校验及实际页面为准。`app/src/api/mock/` 的业务实现同时被服务器复用，固定客服话术和旧交接文档不能直接作为依据。

每篇头部填写 `id`、`title`、`navigation`、`routes`、`keywords`、`sources`。路由使用应用相对路径，不含域名或 `/bank` 部署前缀；依据使用仓库相对文件路径。一级入口只能是账户、理财、助手、我的。

## 修改步骤

1. 核对依据文件与页面。先写结论，再写必要步骤和限制；分清网页支持与助手可直接办理。
2. 每个问题使用 `## 问题 {#稳定标识}`。正文连同标题最多 450 字，条件和例外放在同一问答内；不要改已有 ID，也不要添加维护笔记到正文。
3. 通用规则可以写入；个人余额、实际费用、限额、汇率、净值、交易状态必须查询。无法查询或不能办理时明确引导页面，不能承诺结果。
4. 同一提交更新 `packages/rag/tests/questions.json` 的对应问题及 `tools/check-knowledge-rules.mjs` 的规则断言。

## 生成与验证

在 `framework` 下运行 `npm run knowledge`，结果为 `.generated/knowledge/corpus.json`（不提交）。`scripts/build.sh` 与 `scripts/bootstrap.sh` 会自动调用同一生成器。版本由知识内容和依据文件摘要决定，不含生成时间。

构建检索插件后运行 `npm run test:knowledge`。固定问题不少于 40 道，关键词模式下前三命中率须 ≥95%，费用、额度、能力边界必须全部命中。在仓库根使用 Node 24 运行 `node --import ./tools/ts-resolve-hook.mjs tools/check-knowledge-rules.mjs`，核对临时银行数据。联网模型回归使用 `framework/scripts/e2e-bank.sh`，只在已配置服务密钥的环境执行。

## 发布与回滚

同时发布知识源、生成语料、检索插件编译产物和已替换路径的 profile；语料在插件启动时加载，因此只重启 Agent 服务。不要重启银行服务或覆盖数据库。发布前备份这些文件，失败时恢复并重启 Agent。抽查费用、丢卡、理财开户、助手能力边界，保留流式与确认卡验证。旧示例仅在 `packages/rag/tests/fixtures/legacy-corpus.json`，不可重新作为生产配置。
