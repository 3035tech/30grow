# ── Stage 1: deps ────────────────────────────────────────────────────────────
FROM docker.io/library/node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN if [ -f package-lock.json ]; then npm ci; else npm install; fi

# ── Stage 2: builder ─────────────────────────────────────────────────────────
FROM docker.io/library/node:22-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ARG NEXT_PUBLIC_APP_URL=https://app.30grow.com
ENV NEXT_PUBLIC_APP_URL=$NEXT_PUBLIC_APP_URL
ARG NEXT_PUBLIC_SITE_URL=https://30grow.com
ENV NEXT_PUBLIC_SITE_URL=$NEXT_PUBLIC_SITE_URL
ENV NODE_OPTIONS=--max-old-space-size=6144
RUN mkdir -p public
RUN npm run test:security
RUN npm run build

# ── Stage 3: runner ──────────────────────────────────────────────────────────
FROM docker.io/library/node:22-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000

RUN addgroup --system --gid 1001 nodejs
RUN adduser  --system --uid 1001 nextjs

COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=deps /app/node_modules ./node_modules
COPY --from=builder /app/lib ./lib

USER nextjs
EXPOSE 3000

CMD ["node", "server.js"]
