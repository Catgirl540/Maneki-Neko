# 可共享的演示数据库

> 这是可迁移的历史演示快照，不是当前产品模型依据。加载后须遵循 [单资金账户约束](../docs/product/account-model.md) 并完成档案迁移；不要据快照中的多行账户恢复按卡建户。

`bank.sqlite` 是一份虚拟银行演示状态的 SQLite 快照，供队友复现账户、虚拟银行卡、余额和流水。它包含完整的**虚构**卡号、演示安全码和演示用户资料，不能放入真实客户或真实银行卡数据。

这里只提交单个快照文件。运行时数据库仍保存在被 `.gitignore` 排除的 `server/data/` 中；不要直接让服务修改此目录里的版本化快照。

## 队友使用

在仓库根目录停止后端服务后，先备份自己现有的 `server/data/` 数据，再执行以下 PowerShell 命令：

```powershell
New-Item -ItemType Directory -Force server/data | Out-Null
Remove-Item server/data/bank.sqlite-wal,server/data/bank.sqlite-shm -ErrorAction SilentlyContinue
Copy-Item demo-database/bank.sqlite server/data/bank.sqlite -Force
node server/index.mjs
```

网页启动方式见 [`server/README.md`](../server/README.md)。服务使用默认的 `server/data/bank.sqlite`，因此不需要另设 `BANK_DB_FILE`。演示登录和支付密码也写在该说明中。

## 更新快照

在仓库根目录运行：

```powershell
python tools/export-demo-database.py
```

脚本使用 SQLite 备份接口，因此可以把主数据库及 WAL 中已提交的变更合成一致的单文件快照。若数据库位于别处，可传入 `--source`；快照更新后再提交 `demo-database/bank.sqlite`。不要直接复制正在使用的 `.sqlite` 文件，也不要提交 `-wal` 或 `-shm` 文件。
