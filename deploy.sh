#!/usr/bin/env bash

pnpm install \
  --prod \
  --dir . \
  --modules-dir out/node_modules \
  --virtual-store-dir out/node_modules/.pnpm \
  --frozen-lockfile # drop if lockfile needs refresh
