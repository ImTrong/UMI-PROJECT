# Stage 1: Build shared module and service
FROM node:18-alpine AS builder

WORKDIR /app

# Copy root package files (if workspace)
COPY package*.json ./

# Copy shared module
COPY shared/file-storage ./shared/file-storage

# Build shared module
WORKDIR /app/shared/file-storage
RUN npm install && npm run build

# Copy service code
WORKDIR /app
COPY services/order-service ./services/order-service

# Install service dependencies
WORKDIR /app/services/order-service
RUN apk add --no-cache openssl libc6-compat
RUN if [ -f package-lock.json ]; then npm ci; else npm install; fi
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
