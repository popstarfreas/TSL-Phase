#!/usr/bin/env bash
set -euo pipefail

ROOT="${PNPM_WORKSPACE_DIR:-$PWD}"
MODULES_DIR="$ROOT/out/node_modules"
VSTORE_DIR="$MODULES_DIR/.pnpm"

mkdir -p "$VSTORE_DIR"

# Use corepack to ensure a modern pnpm and pin the workspace to this repo.
PNPM_WORKSPACE_DIR="$ROOT" corepack pnpm install \
  --prod \
  --frozen-lockfile \
  --dir "$ROOT" \
  --modules-dir "$MODULES_DIR" \
  --virtual-store-dir "$VSTORE_DIR"
