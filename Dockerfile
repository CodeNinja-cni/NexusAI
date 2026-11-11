# syntax=docker/dockerfile:1.7

ARG NODE_VERSION=26.13.0

FROM node:${NODE_VERSION}-bookworm-slim AS dependencies
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY package.json package-lock.json prisma7.config.ts ./
COPY prisma ./prisma
RUN npm ci

FROM dependencies AS builder
COPY . .
RUN npm run build
RUN npm run deploy:scan-client

FROM dependencies AS production-dependencies
RUN npm prune --omit=dev

FROM node:${NODE_VERSION}-bookworm-slim AS web
ARG RELEASE_VERSION=development
LABEL org.opencontainers.image.revision=${RELEASE_VERSION}
WORKDIR /app
ENV HOSTNAME=0.0.0.0
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
RUN groupadd --system --gid 1001 nodejs && useradd --system --uid 1001 --gid nodejs nextjs
COPY --from=builder --chown=nextjs:nodejs /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
USER nextjs
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:3000/api/v1/health/live').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"]
CMD ["node", "server.js"]

FROM node:${NODE_VERSION}-bookworm-slim AS worker
ARG RELEASE_VERSION=development
LABEL org.opencontainers.image.revision=${RELEASE_VERSION}
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
RUN groupadd --system --gid 1001 nodejs && useradd --system --uid 1001 --gid nodejs nexus
COPY --from=production-dependencies --chown=nexus:nodejs /app/node_modules ./node_modules
COPY --chown=nexus:nodejs package.json tsconfig.json prisma7.config.ts ./
COPY --chown=nexus:nodejs prisma ./prisma
COPY --chown=nexus:nodejs scripts ./scripts
COPY --chown=nexus:nodejs src ./src
COPY --from=dependencies --chown=nexus:nodejs /app/src/generated ./src/generated
COPY --chown=nexus:nodejs workers ./workers
USER nexus
CMD ["npm", "run", "worker:documents"]

FROM dependencies AS migrate
ARG RELEASE_VERSION=development
LABEL org.opencontainers.image.revision=${RELEASE_VERSION}
WORKDIR /app
ENV NODE_ENV=production
CMD ["npm", "run", "db:deploy"]
