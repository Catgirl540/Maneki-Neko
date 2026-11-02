#!/usr/bin/env bash
# macOS / Linux launcher for the Maneki-Neko local stack TUI.
# Windows users run start.cmd instead; both end up in tools/start-tui.mjs.
set -euo pipefail
cd "$(dirname "$0")"

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js 24 or newer is required, but 'node' is not in PATH."
  echo "Install it from https://nodejs.org/ and run this script again."
  exit 1
fi

# "$@" matters: --check and --help must reach the launcher
exec node tools/start-tui.mjs "$@"
