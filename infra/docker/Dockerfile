# syntax=docker/dockerfile:1.7
# AdapterPay — imagem multi-stage para web (Next.js), api (NestJS), worker (BullMQ) e migrate (Prisma).
# Build: docker compose -f docker-compose.prod.yml build

ARG NODE_IMAGE=node:22-bookworm-slim

FROM ${NODE_IMAGE} AS base
ENV PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH \
    NEXT_TELEMETRY_DISABLED=1 \
    CI=true
RUN corepack enable && corepack prepare pnpm@10.13.1 --activate \
 && apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /repo

# ---------------------------------------------------------------- dependências
FROM base AS deps
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/api/package.json apps/api/
COPY apps/worker/package.json apps/worker/
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
COPY packages/database/package.json packages/database/
COPY packages/core/package.json packages/core/
COPY packages/ui/package.json packages/ui/
COPY packages/database/prisma packages/database/prisma
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store pnpm install --frozen-lockfile

# ---------------------------------------------------------------- build
FROM deps AS build
COPY . .
RUN pnpm build:packages \
 && pnpm --filter @adapterpay/api build \
 && pnpm --filter @adapterpay/worker build \
 && pnpm --filter @adapterpay/web build
# Pacotes de produção isolados (apenas dependências prod + dist).
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm --filter @adapterpay/api deploy --legacy --prod /out/api \
 && pnpm --filter @adapterpay/worker deploy --legacy --prod /out/worker \
 && pnpm --filter @adapterpay/database deploy --legacy --prod /out/migrate
# Gera o Prisma Client dentro de cada pacote implantado (engine para Debian/OpenSSL 3).
RUN cd /out/api && node /repo/infra/docker/prisma-generate.cjs \
 && cd /out/worker && node /repo/infra/docker/prisma-generate.cjs \
 && cd /out/migrate && ./node_modules/.bin/prisma generate --schema prisma/schema.prisma

# ---------------------------------------------------------------- runtime base
FROM ${NODE_IMAGE} AS runtime
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates tini \
 && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production TZ=UTC
WORKDIR /app
USER node
ENTRYPOINT ["/usr/bin/tini", "--"]

# ---------------------------------------------------------------- migrate (job)
FROM runtime AS migrate
COPY --from=build --chown=node:node /out/migrate /app
# Falha de migração encerra com código != 0 e impede o release (depends_on: service_completed_successfully).
CMD ["sh", "-c", "./node_modules/.bin/prisma migrate deploy --schema prisma/schema.prisma && node dist-seed/seed.js"]

# ---------------------------------------------------------------- api
FROM runtime AS api
COPY --from=build --chown=node:node /out/api /app
EXPOSE 4000
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:4000/api/v1/health/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/main.js"]

# ---------------------------------------------------------------- worker
FROM runtime AS worker
COPY --from=build --chown=node:node /out/worker /app
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 CMD ["node", "dist/healthcheck.js"]
CMD ["node", "dist/main.js"]

# ---------------------------------------------------------------- web
FROM runtime AS web
COPY --from=build --chown=node:node /repo/apps/web/.next/standalone /app
COPY --from=build --chown=node:node /repo/apps/web/.next/static /app/apps/web/.next/static
COPY --from=build --chown=node:node /repo/apps/web/public /app/apps/web/public
ENV PORT=3000 HOSTNAME=0.0.0.0
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/').then(r=>process.exit(r.status<500?0:1)).catch(()=>process.exit(1))"
CMD ["node", "apps/web/server.js"]
