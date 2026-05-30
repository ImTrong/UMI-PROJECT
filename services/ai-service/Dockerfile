# Stage 1: Build
FROM node:18-alpine AS builder

WORKDIR /app/services/ai-service

# Cache dependencies
COPY services/ai-service/package*.json ./
RUN apk add --no-cache openssl libc6-compat
RUN --mount=type=cache,id=npm-ai-service,target=/root/.npm npm install

# Copy source code
COPY services/ai-service/ ./

# Generate Prisma client
RUN npx prisma generate

# Build TypeScript
RUN npm run build

# Stage 2: Production
FROM node:18-alpine

WORKDIR /app/services/ai-service
RUN apk add --no-cache openssl libc6-compat

# Copy built files
COPY --from=builder /app/services/ai-service/package*.json ./
COPY --from=builder /app/services/ai-service/node_modules ./node_modules
COPY --from=builder /app/services/ai-service/dist ./dist
COPY --from=builder /app/services/ai-service/prisma ./prisma

EXPOSE 3007

CMD ["node", "dist/index.js"]
