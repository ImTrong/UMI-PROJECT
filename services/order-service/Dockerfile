# Stage 1: Build shared module and service
FROM node:18-alpine AS builder

WORKDIR /app

# 1. Cache shared module dependencies
COPY shared/file-storage/package*.json ./shared/file-storage/
WORKDIR /app/shared/file-storage
RUN --mount=type=cache,id=npm-shared-order-service,target=/root/.npm npm install

# 2. Cache service dependencies
WORKDIR /app/services/order-service
COPY services/order-service/package*.json ./
RUN apk add --no-cache openssl libc6-compat
RUN --mount=type=cache,id=npm-order-service,target=/root/.npm if [ -f package-lock.json ]; then npm ci; else npm install; fi

# 3. Build shared module
WORKDIR /app
COPY shared/file-storage ./shared/file-storage
WORKDIR /app/shared/file-storage
RUN npm run build

# 4. Copy service code
WORKDIR /app
COPY services/order-service ./services/order-service
WORKDIR /app/services/order-service

RUN npx prisma generate

# Build service
RUN npm run build

# Stage 2: Production
FROM node:18-alpine

WORKDIR /app
RUN apk add --no-cache openssl libc6-compat

# Copy shared module built
COPY --from=builder /app/shared/file-storage ./shared/file-storage
COPY --from=builder /app/services/order-service/package*.json ./services/order-service/
COPY --from=builder /app/services/order-service/node_modules ./services/order-service/node_modules
COPY --from=builder /app/services/order-service/dist ./services/order-service/dist
COPY --from=builder /app/services/order-service/prisma ./services/order-service/prisma

WORKDIR /app/services/order-service

EXPOSE 3004

CMD ["node", "dist/index.js"]
