/** Stop retired SQLite integration runners before they create any child process. */
process.stderr.write(
  'LEGACY_SQLITE_FIXTURE_DISABLED: 此检查入口依赖已停用的 SQLite 临时库，不能启动现版 PostgreSQL 后端。\n' +
  '请为专用隔离测试库配置 BANK_TEST_DATABASE_URL，然后在 server 目录执行 npm run test:postgres。\n' +
  '不得使用生产数据库连接运行测试。\n',
)
process.exit(2)
