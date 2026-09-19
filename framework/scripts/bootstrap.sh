#!/usr/bin/env bash
# 生成仓库内隔离的 DSH_HOME 与 luckycat profile，并把 luckycat 插件作为
# **bundle** 装进该 profile。绝不碰用户的 ~/.dsh。
#
#   DSH_HOME = $LUCKYCAT_DSH_HOME（默认 $ROOT/.dsh-home，必须是仓库内路径）
#   profile 目录 = $DSH_HOME/profiles/luckycat
#
# 职责划分（这是框架的扩展故事）：
#   - **装哪些插件** → profile 的 dsh.profile.bundles（由 `dsh plugin add/remove` 维护）
#   - **怎么配置它们** → profiles/luckycat/cordis.patch.yml（本项目里是唯一模板）
# 所以本脚本只生成配置文件 + 幂等安装插件；已装状态不会被覆盖。
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/_home.sh"

SRC="$LUCKYCAT_ROOT/profiles/luckycat"
DEST="$DSH_HOME/profiles/luckycat"

mkdir -p "$DEST"

# cordis.yml 是空 root（组合全靠 patch 层），每次重建都是确定性的。
cp "$SRC/cordis.yml" "$DEST/cordis.yml"

# profile 的补丁层：模板是唯一事实来源，占位符在这里替换。
sed \
  -e "s|@LUCKYCAT_CORPUS@|$LUCKYCAT_ROOT/examples/bank/corpus.json|g" \
  -e "s|@LUCKYCAT_DEMO_DATA@|$LUCKYCAT_ROOT/packages/bank-demo/demo-data.json|g" \
  "$SRC/cordis.patch.yml" > "$DEST/cordis.patch.yml"

# 自检 overlay：探针（进白名单 / 不进白名单两种）。
sed \
  -e "s|@LUCKYCAT_PROBE_PLUGIN@|$LUCKYCAT_ROOT/packages/probe/lib/index.js|g" \
  "$SRC/doctor.patch.yml" > "$DEST/doctor.patch.yml"
sed \
  -e "s|@LUCKYCAT_PROBE_PLUGIN@|$LUCKYCAT_ROOT/packages/probe/lib/index.js|g" \
  "$SRC/probe-denied.patch.yml" > "$DEST/probe-denied.patch.yml"

# 端到端自检用的 overlay（压短确认超时），同样只通过 --patch 挂载。
cp "$SRC/consent-fast-timeout.patch.yml" "$DEST/consent-fast-timeout.patch.yml"

# profile 清单只在首次生成：`dsh plugin` 会把已装 bundle 写在这里，
# 不能每次覆盖掉。
if [ ! -f "$DEST/package.json" ]; then
  cp "$SRC/package.json" "$DEST/package.json"
fi

echo "bootstrap: DSH_HOME=$DSH_HOME"
echo "bootstrap: profile=$DEST"

# 先把包之间互相引用的链接建好（bank-demo 依赖 consent）。
# 必须在 build 之前，否则 bank-demo 编译期解析不到 @luckycat/dsh-consent。
bash "$LUCKYCAT_ROOT/scripts/link-local.sh"

# 幂等安装插件包：装了带 dsh.bundle.patch 的包 → 自动选中该 bundle。
if [ "${LUCKYCAT_SKIP_PLUGIN_INSTALL:-0}" = "1" ]; then
  echo "bootstrap: 跳过插件安装（LUCKYCAT_SKIP_PLUGIN_INSTALL=1）"
  exit 0
fi

manifest="$DEST/package.json"
# 顺序有讲究：consent 是通用层，bank-demo 是它的消费者，先装 consent。
for pkg in hello embedding rag hardening consent bank-demo; do
  name="$(python3 -c "import json,sys;print(json.load(open(sys.argv[1]))['name'])" "$LUCKYCAT_ROOT/packages/$pkg/package.json")"
  if grep -q "\"$name\"" "$manifest"; then
    echo "bootstrap: 已装 $name"
    continue
  fi
  echo "bootstrap: 安装 $name"
  if ! bash "$LUCKYCAT_ROOT/scripts/plugin.sh" add "$LUCKYCAT_ROOT/packages/$pkg" >"$DSH_HOME/plugin-install.log" 2>&1; then
    echo "bootstrap: 安装 $name 失败，日志尾部：" >&2
    tail -12 "$DSH_HOME/plugin-install.log" >&2
    exit 1
  fi
done
echo "bootstrap: 插件就绪"