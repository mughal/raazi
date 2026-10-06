#!/bin/sh
set -eu
cd /app
# This explicit preparation step may download packages; normal startup never does.
npm ci --include=dev
sha256sum package.json package-lock.json > node_modules/.raazi-dependencies
echo 'Dependency preparation complete. Services were not started.'
