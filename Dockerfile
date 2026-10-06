FROM docker.io/library/node:22-bookworm-slim AS runtime
WORKDIR /app
# HTTPS avoids HTTP proxy/login pages being returned as Debian repository metadata.
# Bootstrap APT trust from Node's bundled public roots if the slim image has no CA file.
RUN node -e "const fs=require('node:fs'); const source='/etc/apt/sources.list.d/debian.sources'; fs.writeFileSync(source,fs.readFileSync(source,'utf8').replaceAll('http://deb.debian.org','https://deb.debian.org')); const ca='/etc/ssl/certs/ca-certificates.crt'; if(!fs.existsSync(ca)){fs.mkdirSync('/etc/ssl/certs',{recursive:true}); fs.writeFileSync(ca,require('node:tls').rootCertificates.join('\n')+'\n');}" \
    && apt-get update && apt-get install -y --no-install-recommends ca-certificates python3 make g++ \
    && rm -rf /var/lib/apt/lists/*
LABEL io.raazi.runtime="1"
COPY package.json package-lock.json ./
# Seed Linux dependencies once, including TypeScript/Vite and native build tools.
RUN npm ci --include=dev && sha256sum package.json package-lock.json > node_modules/.raazi-dependencies \
    && mkdir -p dist data /home/node/.npm \
    && chown -R node:node node_modules dist data /home/node/.npm
ENV NODE_ENV=production
USER node
EXPOSE 8080
CMD ["sh", "deploy/start-runtime.sh"]
