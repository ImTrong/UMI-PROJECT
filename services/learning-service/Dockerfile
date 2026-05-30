# Stage 1: Build shared module and service
FROM node:18-alpine AS builder

WORKDIR /app

# 1. Cache shared module dependencies
COPY shared/file-storage/package*.json ./shared/file-storage/
WORKDIR /app/shared/file-storage
RUN --mount=type=cache,id=npm-shared-learning-service,target=/root/.npm npm install

# 2. Cache service dependencies
WORKDIR /app/services/learning-service
COPY services/learning-service/package*.json ./
RUN apk add --no-cache openssl libc6-compat ffmpeg
RUN --mount=type=cache,id=npm-learning-service,target=/root/.npm if [ -f package-lock.json ]; then npm ci; else npm install; fi

# 3. Build shared module
WORKDIR /app
COPY shared/file-storage ./shared/file-storage
WORKDIR /app/shared/file-storage
RUN npm run build

# 4. Copy service code
WORKDIR /app
COPY services/learning-service ./services/learning-service
WORKDIR /app/services/learning-service

# Fix symlink for shared module due to npm ci unpacking an unbuilt file dependency
RUN rm -rf node_modules/@umi/file-storage && ln -s /app/shared/file-storage node_modules/@umi/file-storage

RUN npx prisma generate

# Build service
RUN npm run build

# Stage 2: Production
FROM node:18-alpine

WORKDIR /app
RUN apk add --no-cache cairo pango libjpeg-turbo giflib openssl libc6-compat ffmpeg

# Copy shared module built
COPY --from=builder /app/shared/file-storage ./shared/file-storage
COPY --from=builder /app/services/learning-service/package*.json ./services/learning-service/
COPY --from=builder /app/services/learning-service/node_modules ./services/learning-service/node_modules
COPY --from=builder /app/services/learning-service/dist ./services/learning-service/dist
COPY --from=builder /app/services/learning-service/prisma ./services/learning-service/prisma
COPY --from=builder /app/services/learning-service/dist-seed ./services/learning-service/dist-seed
COPY --from=builder /app/services/learning-service/assets ./services/learning-service/assets

WORKDIR /app/services/learning-service

EXPOSE 3006

CMD ["node", "dist/index.js"]
