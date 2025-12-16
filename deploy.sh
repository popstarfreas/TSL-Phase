#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
cd "$SCRIPT_DIR"

PNPM=(pnpm)
if ! command -v pnpm >/dev/null 2>&1; then
  PNPM=(corepack pnpm)
fi

"${PNPM[@]}" install \
  --ignore-workspace \
  --prod \
  --dir . \
  --modules-dir out/node_modules \
  --virtual-store-dir out/node_modules/.pnpm \
  --frozen-lockfile # drop if lockfile needs refresh
