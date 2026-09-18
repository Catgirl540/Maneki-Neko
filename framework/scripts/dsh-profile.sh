#!/usr/bin/env bash
# 用仓库内隔离的 DSH_HOME 启动 luckycat profile。
#
#   scripts/dsh-profile.sh --dump-config
#   scripts/dsh-profile.sh "你的问题"
#
# 安装的是钉死版本的 @deepseek-ai/dsh（见 package.json），不是源码态。
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/_home.sh"

if [ ! -x "$LUCKYCAT_ROOT/node_modules/.bin/dsh" ]; then
  echo "dsh-profile: 缺少 $LUCKYCAT_ROOT/node_modules/.bin/dsh，先跑 npm install" >&2
  exit 1
fi

exec "$LUCKYCAT_ROOT/node_modules/.bin/dsh" --profile luckycat "$@"