#!/usr/bin/env bash
# 管理 profile 的插件包（包装 `dsh plugin --profile luckycat …`）。
#
#   scripts/plugin.sh add    <包路径|registry 名|git|tarball>
#   scripts/plugin.sh remove <包名>
#   scripts/plugin.sh ls
#
# 装了带 dsh.bundle.patch 的包 → 自动选中该 bundle（它的行进树）；
# 卸载 → 取消选中。这就是"不改内核、增删插件"的官方机制。
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/_home.sh"

if [ ! -x "$LUCKYCAT_ROOT/node_modules/.bin/dsh" ]; then
  echo "plugin: 缺少 dsh，先跑 npm install" >&2
  exit 1
fi

# 不带子命令时，直接把参数交给 dsh plugin（例如 `install`/`update`）。
exec "$LUCKYCAT_ROOT/node_modules/.bin/dsh" plugin --profile luckycat "$@"