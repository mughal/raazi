FROM docker.io/library/node:22-bookworm-slim AS build
WORKDIR /app
# HTTPS avoids HTTP proxy/login pages being returned as Debian repository metadata.
# Bootstrap APT trust from Node's bundled public roots if the slim image has no CA file.
RUN node -e "const fs=require('node:fs'); const source='/etc/apt/sources.list.d/debian.sources'; fs.writeFileSync(source,fs.readFileSync(source,'utf8').replaceAll('http://deb.debian.org','https://deb.debian.org')); const ca='/etc/ssl/certs/ca-certificates.crt'; if(!fs.existsSync(ca)){fs.mkdirSync('/etc/ssl/certs',{recursive:true}); fs.writeFileSync(ca,require('node:tls').rootCertificates.join('\n')+'\n');}" \
    && apt-get update && apt-get install -y --no-install-recommends ca-certificates python3 make g++ \
    && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build && npm prune --omit=dev

FROM docker.io/library/node:22-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build --chown=node:node /app/package.json /app/package-lock.json ./
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --from=build --chown=node:node /app/server/schema.sql /app/server/uploads-schema.sql ./server/
RUN mkdir -p /app/data && chown node:node /app/data
USER node
EXPOSE 8080
CMD ["node", "dist/server/index.js"]
