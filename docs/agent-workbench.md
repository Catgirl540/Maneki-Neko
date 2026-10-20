# 独立个人工作台

项目本地安装 `@dely0/dsh-personal-workbench@1.17.0`，用于单用户日历、任务与到期提醒。它通过官方 DSH Web 运行，独立页面仍为单用户；银行客户通过隔离的提醒适配层接入已有微信私聊。

## 使用

在仓库根执行：

```powershell
npm --prefix framework ci
npm --prefix framework run workbench:setup
npm --prefix framework run workbench:start
```

默认监听 `127.0.0.1:8792`。首次访问使用终端打印的带启动令牌链接，浏览器换取本地登录 Cookie 后使用普通地址；重启后从终端获取新链接。按 Ctrl+C 停止服务，任务和提醒不会因此删除。

进入官方页面的「工作台」，创建任务并设置截止时间和提醒；在设置中开启提醒。页内提醒需要页面运行，系统通知需要浏览器授权。宿主服务停机时不执行提醒扫描。自然语言创建、拆解等 AI 功能需要另行配置模型；本次安装验证未调用模型。

## 隔离与兼容

- 独立 DSH_HOME：`framework/.generated/personal-workbench/dsh-home`；私有工作台数据在同目录下 `private/.dsh/workbench`，工作目录在 `workspace`。
- 显式设置插件的 `home` 与 `dataDir`，不使用当前用户真实的 `~/.dsh/workbench`，不复用银行资金库、AI 会话库或微信凭据。
- 工作台采用上游自身的 SQLite 任务库，仅保存个人任务资料；银行仍使用 PostgreSQL。它是单用户工具，不能把这一份任务库直接发布给多个银行客户共用。
- 插件的 npm peer 范围未列入 `0.2.1` 预发布元组，普通 npm 安装会选出 `0.2.0-rc.2` 并冲突。仅对该插件的五项 DSH peer 显式 override 为项目已有 `0.2.1-rc.2`；不使用全局 `--force` 或 `--legacy-peer-deps`，不修改上游包。依赖锁中没有新增第二套 DSH。
- 独立 profile 采用官方 base/web-app 加工作台 bundle；不加载银行业务 bundle。启动不继承银行连接、支付口令或模型 API 密钥。Shell、文件工具、子代理及外部搜索工具未开放；个人任务编辑通过插件自身页面完成。

## 银行微信提醒

银行提醒使用同一上游任务/提醒库，任务库按银行客户隔离；通过既有 IM 控制器投递，不启动第二个微信轮询器。客户在银行 IM 页面登录后可预览、确认创建、查询及取消一次性提醒，也可让 Agent 发起确认卡。提醒只发送本人确认的文字，不查询账户或执行交易。

启用配置、持久化、接口、状态和故障处理见 [银行提醒说明](api/im-reminders.md)。独立工作台的官方单用户 Web 页面不作为银行多客户入口，不开放到公网。独立页面的微信通道仍未配置，其设置与银行适配层分开。

## 验证

```powershell
npm --prefix framework run check:dsh
npm --prefix framework run test:workbench
npm --prefix framework run bootstrap:customer
```

工作台验收使用独立可丢弃目录和临时端口，通过真实官方 DSH Web 加载插件，验证网页模块、任务与提醒创建、重启持久化、确认后的停止重复，以及未配置微信通道的真实状态。Windows 首次创建项目内目录链接可能需要允许正常的本地进程权限。

2026-10-20 本地结果：独立官方工作台验收 ALL PASS；提醒 API/Agent/真实上游 SQLite 测试通过；提醒真实浏览器闭环 ALL PASS；原有 IM 浏览器回归 10/10，无跳过；IM 单元回归 11 通过、2 项显式模式跳过。以上全部使用隔离夹具，没有发送真实微信或调用付费模型。实际部署和单条真实连接验收另记录结果，不用本地夹具冒充送达。

新增回归：`npm --prefix framework run test:reminders`、设置 `CHROME_PATH` 后 `node tools/check-im-reminders-ui.mjs`。

## 服务器验收

2026-10-20 已部署银行提醒适配层，版本 `e9f2c9e`。原微信凭据失效（-14）后，用户重新扫码，并明确授权将指定银行账户的旧绑定迁到新机器人；先核验新旧配置的微信所有者与原私聊接收标识完全一致，再备份并迁移。没有恢复或伪造银行内存登录，也没有修改资金。旧测试在投递前离线检查耗尽后失败，确认未发送；替代的一条授权测试于北京时间 **10:48:39** 获得渠道确认，发送次数 1，原生出站记录也只找到 1 条。渠道确认不代表用户已读。

原银行与其他五项服务保持原进程，提醒 SQLite 已通过在线备份保存，绑定和迁移前状态另有受限备份。已失效的旧机器人配置保留，当前接收私聊使用新连接。真实结果与限制见 [部署记录](bank-reminders-deployment-20261020.json)。创建后续提醒可在银行 IM 页面登录后操作；银行查询仍遵守登录与归属验证。
