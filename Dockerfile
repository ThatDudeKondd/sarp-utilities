# Build context must be the repo root (../), not this directory -- sarp-utilities
# is an npm workspace member and depends on the sibling djsko package.
# e.g. docker build -f sarp-utilities/Dockerfile . (from /opt/sarp-project)
FROM node:22-alpine AS builder
WORKDIR /app

COPY package.json package-lock.json ./
COPY djsko djsko
COPY sarp-utilities sarp-utilities
RUN npm ci

RUN npm run build:djsko
RUN npm run db:gen --workspace=sarp-utilities
RUN npm run build --workspace=sarp-utilities

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production

COPY --from=builder /app /app

WORKDIR /app/sarp-utilities
CMD ["npx", "pm2-runtime", "ecosystem.config.cjs"]
