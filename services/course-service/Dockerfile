# Build stage
FROM node:18-alpine AS builder

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci

COPY . .
RUN npm run build

# Runtime stage
FROM node:18-alpine

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci --only=production && npm install -g prisma

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/prisma ./prisma

RUN addgroup -g 1001 -S nodejs && adduser -S nodejs -u 1001
USER nodejs

HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD node -e "require('http').get('http://localhost:${PORT:-3003}/api/courses/health', (r) => {if (r.statusCode !== 200) throw new Error('Health check failed')})"

EXPOSE ${PORT:-3003}

CMD ["node", "dist/index.js"]
