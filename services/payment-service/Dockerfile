# Stage 1: Build shared module and service
FROM node:18-alpine AS builder

WORKDIR /app

# 1. Cache shared module dependencies
COPY shared/file-storage/package*.json ./shared/file-storage/
WORKDIR /app/shared/file-storage
RUN --mount=type=cache,id=npm-shared-payment-service,target=/root/.npm npm install

# 2. Cache service dependencies
WORKDIR /app/services/payment-service
COPY services/payment-service/package*.json ./
RUN apk add --no-cache openssl libc6-compat
RUN --mount=type=cache,id=npm-payment-service,target=/root/.npm if [ -f package-lock.json ]; then npm ci; else npm install; fi

# 3. Build shared module
WORKDIR /app
COPY shared/file-storage ./shared/file-storage
WORKDIR /app/shared/file-storage
RUN npm run build

# 4. Copy service code
WORKDIR /app
COPY services/payment-service ./services/payment-service
WORKDIR /app/services/payment-service

RUN npx prisma generate

# Build service
RUN npm run build

# Stage 2: Production
FROM node:18-alpine

WORKDIR /app
RUN apk add --no-cache openssl libc6-compat

# Copy shared module built
COPY --from=builder /app/shared/file-storage ./shared/file-storage
COPY --from=builder /app/services/payment-service/package*.json ./services/payment-service/
COPY --from=builder /app/services/payment-service/node_modules ./services/payment-service/node_modules
COPY --from=builder /app/services/payment-service/dist ./services/payment-service/dist
COPY --from=builder /app/services/payment-service/prisma ./services/payment-service/prisma

WORKDIR /app/services/payment-service

EXPOSE 3005

CMD ["node", "dist/index.js"]
