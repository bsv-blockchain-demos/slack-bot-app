# Build stage — compile native modules (sqlite3 via @bsv/wallet-toolbox)
FROM node:22-alpine AS builder

WORKDIR /app

COPY package*.json ./

RUN apk add --no-cache python3 make g++ && \
    npm ci --omit=dev

# Runtime stage — clean Alpine, no build tools
FROM node:22-alpine

WORKDIR /app

# Upgrade all packages to pick up latest security patches (e.g. zlib CVE-2026-22184)
# then add libstdc++ required at runtime by compiled native modules
RUN apk upgrade --no-cache && \
    apk add --no-cache libstdc++

COPY --from=builder /app/node_modules ./node_modules
COPY . .

EXPOSE 3000

CMD ["node", "index.js"]
