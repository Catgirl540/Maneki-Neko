#!/usr/bin/env bash
# 构建 luckycat 插件包到各自的 lib/。
# npm 安装的 @deepseek-ai/dsh 不带 tsx，只能加载编译后的 JS，所以每次改完必须 build。
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TSC="$ROOT/node_modules/.bin/tsc"

packages=("$@")
if [ ${#packages[@]} -eq 0 ]; then
  packages=(hello)
fi

for pkg in "${packages[@]}"; do
  dir="$ROOT/packages/$pkg"
  if [ ! -f "$dir/tsconfig.json" ]; then
    echo "build: 跳过 $pkg（没有 tsconfig.json）" >&2
    continue
  fi
  echo "build: $pkg"
  "$TSC" -p "$dir/tsconfig.json"
done
echo "build: 完成"