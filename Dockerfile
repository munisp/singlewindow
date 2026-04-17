# ─── TradeGateway NGSWTP — Production Dockerfile ─────────────────────────────
# Multi-stage build: builder → production
# Final image: ~200MB (node:22-alpine base)
# ─────────────────────────────────────────────────────────────────────────────

# ── Stage 1: Dependencies ─────────────────────────────────────────────────────
FROM node:22-alpine AS deps
WORKDIR /app

# Install pnpm
RUN corepack enable && corepack prepare pnpm@latest --activate

# Copy package files
COPY package.json pnpm-lock.yaml ./

# Install production dependencies only
RUN pnpm install --frozen-lockfile --prod

# ── Stage 2: Builder ──────────────────────────────────────────────────────────
FROM node:22-alpine AS builder
WORKDIR /app

# Install pnpm
RUN corepack enable && corepack prepare pnpm@latest --activate

# Copy package files and install ALL dependencies (including dev)
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

# Copy source code
COPY . .

# Build the application
RUN pnpm build

# ── Stage 3: Production ───────────────────────────────────────────────────────
FROM node:22-alpine AS production
WORKDIR /app

# Install dumb-init for proper signal handling
RUN apk add --no-cache dumb-init

# Create non-root user
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 tradegateway

# Copy production dependencies
COPY --from=deps --chown=tradegateway:nodejs /app/node_modules ./node_modules

# Copy built application
COPY --from=builder --chown=tradegateway:nodejs /app/dist ./dist
COPY --from=builder --chown=tradegateway:nodejs /app/package.json ./package.json
COPY --from=builder --chown=tradegateway:nodejs /app/drizzle ./drizzle
COPY --from=builder --chown=tradegateway:nodejs /app/shared ./shared

# Switch to non-root user
USER tradegateway

# Expose port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/api/health/live', (r) => process.exit(r.statusCode === 200 ? 0 : 1)).on('error', () => process.exit(1))"

# Labels
LABEL org.opencontainers.image.title="TradeGateway NGSWTP"
LABEL org.opencontainers.image.description="Next-Generation Single Window Trade Platform"
LABEL org.opencontainers.image.version="1.0.0"
LABEL org.opencontainers.image.source="https://github.com/tradegateway/ngswtp"

# Start with dumb-init for proper PID 1 handling
ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "dist/index.js"]
