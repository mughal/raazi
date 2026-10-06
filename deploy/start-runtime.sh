#!/bin/sh
set -eu
cd /app
sh deploy/check-runtime.sh
echo 'Compiling mounted Raazi code with cached dependencies...'
npm run build
exec node dist/server/index.js
