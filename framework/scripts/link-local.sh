#!/usr/bin/env bash
# 把 packages/* 链接进 node_modules/@luckycat/*，让包之间能用**包名**互相 import。
#
# 为什么需要：`@luckycat/dsh-bank-demo` 依赖 `@luckycat/dsh-consent`，
# 编译期要能解析到它（走对方的 package.json `types` 字段，即 lib/*.d.ts）。
# 用 tsconfig `paths` 直接指到对方的 src 会把别人的源文件拉进本包的 program，
# tsc 会因为 rootDir 越界报错（实测踩到）。链接成 node_modules 才是 npm 的正常语义。
#
# 幂等：已经指向正确位置就跳过。node_modules 是 gitignore 的，所以每次 bootstrap 都会补。
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/_home.sh"

scope="$LUCKYCAT_ROOT/node_modules/@luckycat"
mkdir -p "$scope"

for dir in "$LUCKYCAT_ROOT"/packages/*/; do
  [ -f "$dir/package.json" ] || continue
  name="$(python3 -c "import json,sys;print(json.load(open(sys.argv[1]))['name'])" "$dir/package.json")"
  base="${name#@luckycat/}"
  target="$scope/$base"
  source_path="${dir%/}"
  if [ -L "$target" ] && [ "$(readlink "$target")" = "$source_path" ]; then
    continue
  fi
  rm -rf "$target"
  ln -s "$source_path" "$target"
  echo "link-local: $name -> $source_path"
done
