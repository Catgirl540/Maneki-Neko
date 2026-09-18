#!/usr/bin/env bash
# 从 templates 生成仓库内隔离的 DSH_HOME，绝不碰用户的 ~/.dsh。
#
#   DSH_HOME   = $LUCKYCAT_DSH_HOME（默认 $ROOT/.dsh-home，必须是仓库内路径）
#   profile 目录 = $DSH_HOME/profiles/luckycat
#
# 这里做占位符替换（@LUCKYCAT_HELLO_PLUGIN@ 等 → 真实绝对路径），
# 因为补丁里的模块路径必须是绝对的（patch 不改变 loader 的模块解析根）。
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/_home.sh"

SRC="$LUCKYCAT_ROOT/profiles/luckycat"
DEST="$DSH_HOME/profiles/luckycat"

mkdir -p "$DEST"

# cordis.yml 与 package.json 原样复制。
cp "$SRC/cordis.yml" "$DEST/cordis.yml"
cp "$SRC/package.json" "$DEST/package.json"

# cordis.patch.yml 逐条替换占位符。
sed \
  -e "s|@LUCKYCAT_HELLO_PLUGIN@|$LUCKYCAT_ROOT/packages/hello/lib/index.js|g" \
  -e "s|@LUCKYCAT_EMBEDDING_PLUGIN@|$LUCKYCAT_ROOT/packages/embedding/lib/index.js|g" \
  "$SRC/cordis.patch.yml" > "$DEST/cordis.patch.yml"

# doctor.patch.yml 只在 --patch 时挂载（框架自检），不进生产树。
sed \
  -e "s|@LUCKYCAT_PROBE_PLUGIN@|$LUCKYCAT_ROOT/packages/probe/lib/index.js|g" \
  "$SRC/doctor.patch.yml" > "$DEST/doctor.patch.yml"

echo "bootstrap: DSH_HOME=$DSH_HOME"
echo "bootstrap: profile=$DEST"