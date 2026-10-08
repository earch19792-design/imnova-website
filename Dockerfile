# syntax=docker/dockerfile:1.7

FROM node:24.17.0-bookworm-slim AS dependencies
WORKDIR /app

ENV NEXT_TELEMETRY_DISABLED=1

COPY package.json package-lock.json ./
COPY services/seller-os-mcp/package.json ./services/seller-os-mcp/package.json
RUN npm ci

FROM node:24.17.0-bookworm-slim AS builder
WORKDIR /app

ENV NEXT_TELEMETRY_DISABLED=1

COPY --from=dependencies /app/node_modules ./node_modules
COPY . .

# The application needs NEXT_PUBLIC_* values while compiling. The complete
# local environment is mounted only for this build step and is not copied into
# an image layer or the final image.
RUN --mount=type=secret,id=app_env,target=/app/.env.local,required=true \
    npm run build

FROM node:24.17.0-bookworm-slim AS runtime
WORKDIR /app

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    HOSTNAME=0.0.0.0 \
    PORT=3000

RUN groupadd --system --gid 1001 nodejs \
    && useradd --system --uid 1001 --gid nodejs nextjs

COPY --from=builder --chown=nextjs:nodejs /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/tools/selfhost-scheduler.mjs ./tools/selfhost-scheduler.mjs

USER nextjs
EXPOSE 3000

CMD ["node", "server.js"]
