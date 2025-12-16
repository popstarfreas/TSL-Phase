#!/usr/bin/env bash

pnpm install \
  --prod \
  --workspace-dir "$PWD" \
  --dir "$PWD" \
  --modules-dir "$(realpath out/node_modules)" \
  --virtual-store-dir "$(realpath out/node_modules/.pnpm) \
  --frozen-lockfile # drop if lockfile needs refresh
