#!/bin/sh
set -eu
cd /app
expected=$(sha256sum package.json package-lock.json)
stored=$(cat node_modules/.raazi-dependencies 2>/dev/null || true)
if [ "$expected" != "$stored" ] || [ ! -f node_modules/typescript/bin/tsc ]; then
  echo 'Dependencies changed or are missing. Stop Raazi, run bash raazictl prepare deps, then start it.' >&2
  exit 1
fi
if ! node -e "const Database=require('better-sqlite3'); const db=new Database(':memory:'); db.close(); require('sharp');"; then
  echo 'Native dependencies do not match this runtime. Stop Raazi, run bash raazictl prepare deps, then start it.' >&2
  exit 1
fi
