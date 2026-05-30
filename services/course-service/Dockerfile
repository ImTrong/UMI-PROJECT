# Stage 1: Build shared module and service
FROM node:18-alpine AS builder

WORKDIR /app

# 1. Cache shared module dependencies
COPY shared/file-storage/package*.json ./shared/file-storage/
WORKDIR /app/shared/file-storage
RUN --mount=type=cache,id=npm-shared-course-service,target=/root/.npm npm install

# 2. Cache service dependencies
WORKDIR /app/services/course-service
COPY services/course-service/package*.json ./
RUN apk add --no-cache openssl libc6-compat
RUN --mount=type=cache,id=npm-course-service,target=/root/.npm if [ -f package-lock.json ]; then npm ci; else npm install; fi

# 3. Build shared module
WORKDIR /app
COPY shared/file-storage ./shared/file-storage
WORKDIR /app/shared/file-storage
RUN npm run build

# 4. Copy service code
WORKDIR /app
COPY services/course-service ./services/course-service
WORKDIR /app/services/course-service

# Fix symlink for shared module due to npm ci unpacking an unbuilt file dependency
RUN rm -rf node_modules/@umi/file-storage && ln -s /app/shared/file-storage node_modules/@umi/file-storage

RUN npx prisma generate

# Build service
RUN npm run build

# Stage 2: Production
FROM node:18-alpine

WORKDIR /app
RUN apk add --no-cache openssl libc6-compat

# Copy shared module built
COPY --from=builder /app/shared/file-storage ./shared/file-storage
COPY --from=builder /app/services/course-service/package*.json ./services/course-service/
COPY --from=builder /app/services/course-service/node_modules ./services/course-service/node_modules
COPY --from=builder /app/services/course-service/dist ./services/course-service/dist
COPY --from=builder /app/services/course-service/dist-seed ./services/course-service/dist-seed
COPY --from=builder /app/services/course-service/prisma ./services/course-service/prisma

WORKDIR /app/services/course-service

EXPOSE 3003

CMD ["node", "dist/index.js"]
