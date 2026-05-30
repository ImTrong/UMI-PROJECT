# Stage 1: Build shared module and service
FROM node:18-alpine AS builder

WORKDIR /app

# 1. Cache shared module dependencies
COPY shared/file-storage/package*.json ./shared/file-storage/
WORKDIR /app/shared/file-storage
RUN --mount=type=cache,id=npm-shared-user-service,target=/root/.npm npm install

# 2. Cache service dependencies
WORKDIR /app/services/user-service
COPY services/user-service/package*.json ./
RUN apk add --no-cache openssl libc6-compat
RUN --mount=type=cache,id=npm-user-service,target=/root/.npm if [ -f package-lock.json ]; then npm ci; else npm install; fi

# 3. Build shared module
WORKDIR /app
COPY shared/file-storage ./shared/file-storage
WORKDIR /app/shared/file-storage
RUN npm run build

# 4. Copy service code
WORKDIR /app
COPY services/user-service ./services/user-service
WORKDIR /app/services/user-service

RUN npx prisma generate

# Build service (creates both dist/ and dist-seed/)
RUN npm run build

# Stage 2: Production
FROM node:18-alpine

WORKDIR /app
RUN apk add --no-cache openssl libc6-compat

# Copy shared module built
COPY --from=builder /app/shared/file-storage ./shared/file-storage
COPY --from=builder /app/services/user-service/package*.json ./services/user-service/
COPY --from=builder /app/services/user-service/node_modules ./services/user-service/node_modules
COPY --from=builder /app/services/user-service/dist ./services/user-service/dist
COPY --from=builder /app/services/user-service/dist-seed ./services/user-service/dist-seed
COPY --from=builder /app/services/user-service/prisma ./services/user-service/prisma

WORKDIR /app/services/user-service

EXPOSE 3002

CMD ["node", "dist/src/index.js"]
