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
COPY services/auth-service ./services/auth-service

# Install service dependencies
WORKDIR /app/services/auth-service
RUN apk add --no-cache openssl libc6-compat
RUN if [ -f package-lock.json ]; then npm ci; else npm install; fi
RUN npx prisma generate

# Build service (creates both dist/ and dist-seed/)
RUN npm run build

# Stage 2: Production
FROM node:18-alpine

WORKDIR /app
RUN apk add --no-cache openssl libc6-compat

# Copy shared module built
COPY --from=builder /app/shared/file-storage ./shared/file-storage
COPY --from=builder /app/services/auth-service/package*.json ./services/auth-service/
COPY --from=builder /app/services/auth-service/node_modules ./services/auth-service/node_modules
COPY --from=builder /app/services/auth-service/dist ./services/auth-service/dist
COPY --from=builder /app/services/auth-service/dist-seed ./services/auth-service/dist-seed
COPY --from=builder /app/services/auth-service/prisma ./services/auth-service/prisma

WORKDIR /app/services/auth-service

EXPOSE 3001

CMD ["node", "dist/src/index.js"]