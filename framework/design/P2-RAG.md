# 网页知识库与检索

生产知识源为 `knowledge/` 的 8 篇 Markdown，覆盖账户、理财、助手、我的。维护流程见 [知识库维护](../knowledge/README.md)。旧示例收费与网点资料已移到 `packages/rag/tests/fixtures/legacy-corpus.json`，只用作测试数据。

## 构建

`scripts/build-knowledge.mjs` 校验必填 YAML 字段、唯一文档和章节 ID、当前应用路由、依据文件及 450 字完整问答长度，按文件名顺序生成 `.generated/knowledge/corpus.json`。版本由文档与依据文件摘要确定；不含时间戳。构建和 bootstrap 共用这一入口，profile 只引用生成语料。

## 检索与回答

`knowledge_lookup` 保留向量与关键词混合检索，向量失败时降级。关键词覆盖正文、问题标题、文档标题和关键词，去除常见口语提问外壳；文档级匹配权重较低，防止同篇所有章节同分。每个问题完整切块，保留条件与例外，超长章节拒绝加载。默认前三条、最低分 0.34、有界上下文 2000 字节。

结果记录稳定 `文档#章节`、页面路由、语料版本、评分和降级原因。来源编号、分数与内部路径只供审计，客户回答不输出这些字段。无命中时明确没有依据；知识内容不替代实时银行数据，不支持的操作只能引导网页，不能声称已执行。

## 验证

`packages/rag/tests/knowledge.test.mjs` 覆盖确定生成、元数据校验、固定问题、预算、无匹配和向量故障。`questions.json` 现有 51 道固定问题；前三命中率要求至少 95%，关键费用/限额/能力边界问题须全通过。原有 RAG 单元测试继续保留。`tools/check-knowledge-rules.mjs` 使用隔离内存银行数据核对真实规则；`scripts/e2e-bank.sh` 验证模型调用与最终回答，尤其区分跨境最低 50 元与费用上限。
