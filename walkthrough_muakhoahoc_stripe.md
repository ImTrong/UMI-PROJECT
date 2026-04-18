# Walkthrough: Hoàn thiện chức năng Mua khóa học (Stripe Payment)

## Tổng quan

Chức năng thanh toán Stripe trước đây **không hoạt động** do 5 vấn đề nghiêm trọng. Tất cả đã được sửa.

## Luồng thanh toán mới (đã sửa)

```mermaid
sequenceDiagram
    participant U as User (Browser)
    participant F as Frontend
    participant OS as Order Service
    participant PS as Payment Service
    participant S as Stripe API

    U->>F: Nhấn "Đặt hàng" từ Cart
    F->>OS: POST /api/orders (items, notes)
    OS->>PS: POST /api/payments/internal/create-intent (orderId, amount, userId)
    PS->>S: stripe.paymentIntents.create()
    S-->>PS: PaymentIntent (clientSecret)
    PS-->>OS: { id, clientSecret, amount }
    OS-->>F: { order, paymentIntent }
    F->>F: Redirect → /checkout/:orderId

    U->>F: Vào trang Checkout
    F->>PS: GET /api/payments/order/:orderId
    PS-->>F: { clientSecret, stripePaymentIntentId }
    F->>F: Render StripePaymentForm với clientSecret

    U->>F: Nhập thẻ → Submit
    F->>S: stripe.confirmCardPayment(clientSecret)
    S-->>F: PaymentIntent { status: 'succeeded' }
    F->>PS: POST /api/payments/confirm (paymentIntentId, paymentMethodId)
    PS->>S: stripe.paymentIntents.retrieve() (verify chỉ, không confirm lại)
    PS->>OS: POST /api/orders/webhook/payment { orderId, status: 'PAID' }
    OS->>OS: Update order COMPLETED + Enroll user in courses
    PS-->>F: Payment confirmed
    F->>F: Redirect → /orders/:orderId (hiển thị thành công)
```

## Các file đã thay đổi

### 1. Config & Environment (3 files)

| File | Thay đổi |
|------|----------|
| [frontend/.env](file:///d:/HK/HK8/Cong_nghe_moi/UMI-PROJECT/frontend/.env) | Thay Stripe publishable key placeholder bằng key thật |
| [payment-service/.env](file:///d:/HK/HK8/Cong_nghe_moi/UMI-PROJECT/services/payment-service/.env) | Thay secret key + publishable key placeholder bằng key thật |
| [docker-compose.yml](file:///d:/HK/HK8/Cong_nghe_moi/UMI-PROJECT/docker-compose.yml) | Thêm `PAYMENT_SERVICE_URL` + `LEARNING_SERVICE_URL` cho order-service, cập nhật Stripe key |

```diff:docker-compose.yml

services:
  # ============================================
  # MongoDB - Container Database dùng chung
  # Mỗi service kết nối đến database logic riêng
  # ============================================
  mongodb:
    image: mongo:7.0-jammy # Đã thay đổi từ mongo:7.0-alpine (không tồn tại)
    container_name: elearning-mongo
    ports:
      - "27017:27017"
    entrypoint:
      - bash
      - -c
      - |
        echo "elearningreplicakey1234567890base64safeA" > /tmp/mongo-keyfile
        chmod 400 /tmp/mongo-keyfile
        chown 999:999 /tmp/mongo-keyfile
        exec docker-entrypoint.sh mongod --replSet rs0 --keyFile /tmp/mongo-keyfile
    environment:
      MONGO_INITDB_ROOT_USERNAME: admin
      MONGO_INITDB_ROOT_PASSWORD: securepassword123
    volumes:
      - mongo-data:/data/db
    networks:
      - elearning-network
    healthcheck:
      test: >
        mongosh -u admin -p securepassword123 --authenticationDatabase admin --quiet --eval "try { rs.status().ok } catch (e) { rs.initiate({ _id: 'rs0', members: [{ _id: 0, host: 'mongodb:27017' }] }); }"
      interval: 10s
      timeout: 5s
      retries: 5

  # ============================================
  # Cổng API Nginx (Port 8080)
  # Reverse proxy cho tất cả microservices
  # ============================================
  nginx-gateway:
    image: nginx:alpine
    container_name: elearning-nginx-gateway
    ports:
      - "8080:8080"
      - "8443:443"  # HTTPS port (optional)
    volumes:
      - ./nginx/nginx.conf:/etc/nginx/nginx.conf:ro
      - ./nginx/conf.d:/etc/nginx/conf.d:ro
      - ./nginx/ssl:/etc/nginx/ssl:ro  # SSL certificates (optional)
    depends_on:
      - auth-service
      - user-service
      - course-service
      - order-service
      - payment-service
      - learning-service
      - frontend
    networks:
      - elearning-network
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:8080/health"]
      interval: 30s
      timeout: 10s
      retries: 3

  # ============================================
  # Frontend Service (Placeholder)
  # Port: 3000
  # ============================================
  frontend:
    build:
      context: ./frontend
      dockerfile: Dockerfile
    container_name: elearning-frontend
    ports:
      - "3000:80"
    networks:
      - elearning-network
    # Note: Ensure you have a Dockerfile in ./frontend

  # ============================================
  # Microservice 1: Authentication Service
  # Port: 3001
  # Database: auth_db
  # ============================================
  auth-service:
    build:
      context: .
      dockerfile: ./services/auth-service/Dockerfile
    container_name: elearning-auth-service
    ports:
      - "3001:3001"
    environment:
      PORT: 3001
      NODE_ENV: development
      DATABASE_URL: "mongodb://admin:securepassword123@mongodb:27017/auth_db?authSource=admin"
      JWT_SECRET: "your-super-secret-jwt-key-change-in-production"
      JWT_REFRESH_SECRET: "your-super-secret-refresh-token-key-change-in-production"
      JWT_EXPIRES_IN: "1h"
      JWT_REFRESH_EXPIRES_IN: "7d"
      ADMIN_EMAIL: "admin@elearning.local"
      ADMIN_PASSWORD: "Admin123456"
      AUTO_SEED_ADMIN: "true"
    depends_on:
      mongodb:
        condition: service_healthy
    networks:
      - elearning-network
    command: sh -c "npx prisma db push && node dist-seed/prisma/seed.js && node dist/src/index.js"
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:3001/api/auth/health"]
      interval: 10s
      timeout: 5s
      retries: 3

  # ============================================
  # Microservice 2: User Service
  # Port: 3002
  # Database: user_db
  # ============================================
  user-service:
    build:
      context: .
      dockerfile: ./services/user-service/Dockerfile
    container_name: elearning-user-service
    ports:
      - "3002:3002"
    environment:
      PORT: 3002
      NODE_ENV: development
      DATABASE_URL: "mongodb://admin:securepassword123@mongodb:27017/user_db?authSource=admin"
      JWT_SECRET: "your-super-secret-jwt-key-change-in-production"
      AUTH_SERVICE_URL: "http://auth-service:3001"
      AUTO_SEED: "true"
    depends_on:
      mongodb:
        condition: service_healthy
      auth-service:
        condition: service_started
    networks:
      - elearning-network
    command: sh -c "sleep 5 && npx prisma db push && node dist-seed/prisma/seed.js && node dist/src/index.js"
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:3002/api/users/health"]
      interval: 10s
      timeout: 5s
      retries: 3

  # ============================================
  # Microservice 3: Course Service
  # Port: 3003
  # Database: course_db
  # ============================================
  course-service:
    build:
      context: .
      dockerfile: ./services/course-service/Dockerfile
    container_name: elearning-course-service
    ports:
      - "3003:3003"
    environment:
      PORT: 3003
      NODE_ENV: development
      DATABASE_URL: "mongodb://admin:securepassword123@mongodb:27017/course_db?authSource=admin"
      AUTH_SERVICE_URL: "http://auth-service:3001"
      USER_SERVICE_URL: "http://user-service:3002"
      MINIO_ENDPOINT: minio
      MINIO_PORT: "9000"
      MINIO_ACCESS_KEY: minioadmin
      MINIO_SECRET_KEY: minioadmin123
      MINIO_PUBLIC_URL: "http://127.0.0.1:9000"
    depends_on:
      mongodb:
        condition: service_healthy
    networks:
      - elearning-network
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:3003/api/courses/health"]
      interval: 10s
      timeout: 5s
      retries: 3

  # ============================================
  # Microservice 4: Order Service
  # Port: 3004
  # Database: order_db
  # ============================================
  order-service:
    build:
      context: .
      dockerfile: ./services/order-service/Dockerfile
    container_name: elearning-order-service
    ports:
      - "3004:3004"
    environment:
      PORT: 3004
      NODE_ENV: development
      DATABASE_URL: "mongodb://admin:securepassword123@mongodb:27017/order_db?authSource=admin"
      AUTH_SERVICE_URL: "http://auth-service:3001"
      USER_SERVICE_URL: "http://user-service:3002"
      COURSE_SERVICE_URL: "http://course-service:3003"
    depends_on:
      mongodb:
        condition: service_healthy
    networks:
      - elearning-network
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:3004/api/orders/health"]
      interval: 10s
      timeout: 5s
      retries: 3

  # ============================================
  # Microservice 5: Payment Service
  # Port: 3005
  # Database: payment_db
  # ============================================
  payment-service:
    build:
      context: .
      dockerfile: ./services/payment-service/Dockerfile
    container_name: elearning-payment-service
    ports:
      - "3005:3005"
    environment:
      PORT: 3005
      NODE_ENV: development
      DATABASE_URL: "mongodb://admin:securepassword123@mongodb:27017/payment_db?authSource=admin"
      STRIPE_SECRET_KEY: "sk_test_fake_key_for_development"
      AUTH_SERVICE_URL: "http://auth-service:3001"
      USER_SERVICE_URL: "http://user-service:3002"
      ORDER_SERVICE_URL: "http://order-service:3004"
    depends_on:
      mongodb:
        condition: service_healthy
    networks:
      - elearning-network
    command: sh -c "npx prisma db push && node dist/index.js"
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:3005/api/payments/health"]
      interval: 10s
      timeout: 5s
      retries: 3

  # ============================================
  # Microservice 6: Learning Service
  # Port: 3006
  # Database: learning_db
  # ============================================
  learning-service:
    build:
      context: .
      dockerfile: ./services/learning-service/Dockerfile
    container_name: elearning-learning-service
    ports:
      - "3006:3006"
    environment:
      PORT: 3006
      NODE_ENV: development
      DATABASE_URL: "mongodb://admin:securepassword123@mongodb:27017/learning_db?authSource=admin"
      AUTH_SERVICE_URL: "http://auth-service:3001"
      USER_SERVICE_URL: "http://user-service:3002"
      COURSE_SERVICE_URL: "http://course-service:3003"
      MINIO_ENDPOINT: minio
      MINIO_PORT: "9000"
      MINIO_ACCESS_KEY: minioadmin
      MINIO_SECRET_KEY: minioadmin123
      MINIO_PUBLIC_URL: "http://localhost:9000"
    depends_on:
      mongodb:
        condition: service_healthy
    networks:
      - elearning-network
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:3006/api/learning/health"]
      interval: 10s
      timeout: 5s
      retries: 3

  # ============================================
  # MinIO File Storage Service
  # ============================================
  minio:
    image: minio/minio:latest
    container_name: elearning-minio
    ports:
      - "9000:9000"   # S3 API port
      - "9001:9001"   # Web Console
    environment:
      MINIO_ROOT_USER: minioadmin
      MINIO_ROOT_PASSWORD: minioadmin123
      MINIO_DEFAULT_BUCKETS: assignments:public,quiz-attachments:public,courses:public
      MINIO_API_CORS_ALLOW_ORIGIN: "*"
    volumes:
      - minio-data:/data
    command: server /data --console-address ":9001"
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:9000/minio/health/live"]
      interval: 30s
      timeout: 20s
      retries: 3
    networks:
      - elearning-network
    restart: unless-stopped

  # ============================================
  # MinIO Client - Initialize buckets
  # ============================================
  minio-init:
    image: minio/mc:latest
    container_name: elearning-minio-init
    depends_on:
      - minio
    entrypoint: >
      /bin/sh -c "
      sleep 5;
      mc alias set myminio http://minio:9000 minioadmin minioadmin123;
      mc mb myminio/assignments --ignore-existing;
      mc mb myminio/quiz-attachments --ignore-existing;
      mc mb myminio/courses --ignore-existing;
      mc anonymous set download myminio/assignments;
      mc anonymous set download myminio/quiz-attachments;
      mc anonymous set download myminio/courses;
      echo 'MinIO buckets initialized';
      exit 0;
      "
    networks:
      - elearning-network

# ============================================
# Networks
# ============================================
networks:
  elearning-network:
    driver: bridge

# ============================================
# Volumes
# ============================================
volumes:
  mongo-data:
    driver: local
  minio-data:
    driver: local
===

services:
  # ============================================
  # MongoDB - Container Database dùng chung
  # Mỗi service kết nối đến database logic riêng
  # ============================================
  mongodb:
    image: mongo:7.0-jammy # Đã thay đổi từ mongo:7.0-alpine (không tồn tại)
    container_name: elearning-mongo
    ports:
      - "27017:27017"
    entrypoint:
      - bash
      - -c
      - |
        echo "elearningreplicakey1234567890base64safeA" > /tmp/mongo-keyfile
        chmod 400 /tmp/mongo-keyfile
        chown 999:999 /tmp/mongo-keyfile
        exec docker-entrypoint.sh mongod --replSet rs0 --keyFile /tmp/mongo-keyfile
    environment:
      MONGO_INITDB_ROOT_USERNAME: admin
      MONGO_INITDB_ROOT_PASSWORD: securepassword123
    volumes:
      - mongo-data:/data/db
    networks:
      - elearning-network
    healthcheck:
      test: >
        mongosh -u admin -p securepassword123 --authenticationDatabase admin --quiet --eval "try { rs.status().ok } catch (e) { rs.initiate({ _id: 'rs0', members: [{ _id: 0, host: 'mongodb:27017' }] }); }"
      interval: 10s
      timeout: 5s
      retries: 5

  # ============================================
  # Cổng API Nginx (Port 8080)
  # Reverse proxy cho tất cả microservices
  # ============================================
  nginx-gateway:
    image: nginx:alpine
    container_name: elearning-nginx-gateway
    ports:
      - "8080:8080"
      - "8443:443"  # HTTPS port (optional)
    volumes:
      - ./nginx/nginx.conf:/etc/nginx/nginx.conf:ro
      - ./nginx/conf.d:/etc/nginx/conf.d:ro
      - ./nginx/ssl:/etc/nginx/ssl:ro  # SSL certificates (optional)
    depends_on:
      - auth-service
      - user-service
      - course-service
      - order-service
      - payment-service
      - learning-service
      - frontend
    networks:
      - elearning-network
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:8080/health"]
      interval: 30s
      timeout: 10s
      retries: 3

  # ============================================
  # Frontend Service (Placeholder)
  # Port: 3000
  # ============================================
  frontend:
    build:
      context: ./frontend
      dockerfile: Dockerfile
    container_name: elearning-frontend
    ports:
      - "3000:80"
    networks:
      - elearning-network
    # Note: Ensure you have a Dockerfile in ./frontend

  # ============================================
  # Microservice 1: Authentication Service
  # Port: 3001
  # Database: auth_db
  # ============================================
  auth-service:
    build:
      context: .
      dockerfile: ./services/auth-service/Dockerfile
    container_name: elearning-auth-service
    ports:
      - "3001:3001"
    environment:
      PORT: 3001
      NODE_ENV: development
      DATABASE_URL: "mongodb://admin:securepassword123@mongodb:27017/auth_db?authSource=admin"
      JWT_SECRET: "your-super-secret-jwt-key-change-in-production"
      JWT_REFRESH_SECRET: "your-super-secret-refresh-token-key-change-in-production"
      JWT_EXPIRES_IN: "1h"
      JWT_REFRESH_EXPIRES_IN: "7d"
      ADMIN_EMAIL: "admin@elearning.local"
      ADMIN_PASSWORD: "Admin123456"
      AUTO_SEED_ADMIN: "true"
    depends_on:
      mongodb:
        condition: service_healthy
    networks:
      - elearning-network
    command: sh -c "npx prisma db push && node dist-seed/prisma/seed.js && node dist/src/index.js"
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:3001/api/auth/health"]
      interval: 10s
      timeout: 5s
      retries: 3

  # ============================================
  # Microservice 2: User Service
  # Port: 3002
  # Database: user_db
  # ============================================
  user-service:
    build:
      context: .
      dockerfile: ./services/user-service/Dockerfile
    container_name: elearning-user-service
    ports:
      - "3002:3002"
    environment:
      PORT: 3002
      NODE_ENV: development
      DATABASE_URL: "mongodb://admin:securepassword123@mongodb:27017/user_db?authSource=admin"
      JWT_SECRET: "your-super-secret-jwt-key-change-in-production"
      AUTH_SERVICE_URL: "http://auth-service:3001"
      AUTO_SEED: "true"
    depends_on:
      mongodb:
        condition: service_healthy
      auth-service:
        condition: service_started
    networks:
      - elearning-network
    command: sh -c "sleep 5 && npx prisma db push && node dist-seed/prisma/seed.js && node dist/src/index.js"
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:3002/api/users/health"]
      interval: 10s
      timeout: 5s
      retries: 3

  # ============================================
  # Microservice 3: Course Service
  # Port: 3003
  # Database: course_db
  # ============================================
  course-service:
    build:
      context: .
      dockerfile: ./services/course-service/Dockerfile
    container_name: elearning-course-service
    ports:
      - "3003:3003"
    environment:
      PORT: 3003
      NODE_ENV: development
      DATABASE_URL: "mongodb://admin:securepassword123@mongodb:27017/course_db?authSource=admin"
      AUTH_SERVICE_URL: "http://auth-service:3001"
      USER_SERVICE_URL: "http://user-service:3002"
      MINIO_ENDPOINT: minio
      MINIO_PORT: "9000"
      MINIO_ACCESS_KEY: minioadmin
      MINIO_SECRET_KEY: minioadmin123
      MINIO_PUBLIC_URL: "http://127.0.0.1:9000"
    depends_on:
      mongodb:
        condition: service_healthy
    networks:
      - elearning-network
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:3003/api/courses/health"]
      interval: 10s
      timeout: 5s
      retries: 3

  # ============================================
  # Microservice 4: Order Service
  # Port: 3004
  # Database: order_db
  # ============================================
  order-service:
    build:
      context: .
      dockerfile: ./services/order-service/Dockerfile
    container_name: elearning-order-service
    ports:
      - "3004:3004"
    environment:
      PORT: 3004
      NODE_ENV: development
      DATABASE_URL: "mongodb://admin:securepassword123@mongodb:27017/order_db?authSource=admin"
      AUTH_SERVICE_URL: "http://auth-service:3001"
      USER_SERVICE_URL: "http://user-service:3002"
      COURSE_SERVICE_URL: "http://course-service:3003"
      PAYMENT_SERVICE_URL: "http://payment-service:3005"
      LEARNING_SERVICE_URL: "http://learning-service:3006"
    depends_on:
      mongodb:
        condition: service_healthy
    networks:
      - elearning-network
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:3004/api/orders/health"]
      interval: 10s
      timeout: 5s
      retries: 3

  # ============================================
  # Microservice 5: Payment Service
  # Port: 3005
  # Database: payment_db
  # ============================================
  payment-service:
    build:
      context: .
      dockerfile: ./services/payment-service/Dockerfile
    container_name: elearning-payment-service
    ports:
      - "3005:3005"
    environment:
      PORT: 3005
      NODE_ENV: development
      DATABASE_URL: "mongodb://admin:securepassword123@mongodb:27017/payment_db?authSource=admin"
      STRIPE_SECRET_KEY: "${STRIPE_SECRET_KEY:-sk_test_your_stripe_secret_key_here}"
      AUTH_SERVICE_URL: "http://auth-service:3001"
      USER_SERVICE_URL: "http://user-service:3002"
      ORDER_SERVICE_URL: "http://order-service:3004"
    depends_on:
      mongodb:
        condition: service_healthy
    networks:
      - elearning-network
    command: sh -c "npx prisma db push && node dist/index.js"
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:3005/api/payments/health"]
      interval: 10s
      timeout: 5s
      retries: 3

  # ============================================
  # Microservice 6: Learning Service
  # Port: 3006
  # Database: learning_db
  # ============================================
  learning-service:
    build:
      context: .
      dockerfile: ./services/learning-service/Dockerfile
    container_name: elearning-learning-service
    ports:
      - "3006:3006"
    environment:
      PORT: 3006
      NODE_ENV: development
      DATABASE_URL: "mongodb://admin:securepassword123@mongodb:27017/learning_db?authSource=admin"
      AUTH_SERVICE_URL: "http://auth-service:3001"
      USER_SERVICE_URL: "http://user-service:3002"
      COURSE_SERVICE_URL: "http://course-service:3003"
      MINIO_ENDPOINT: minio
      MINIO_PORT: "9000"
      MINIO_ACCESS_KEY: minioadmin
      MINIO_SECRET_KEY: minioadmin123
      MINIO_PUBLIC_URL: "http://localhost:9000"
    depends_on:
      mongodb:
        condition: service_healthy
    networks:
      - elearning-network
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:3006/api/learning/health"]
      interval: 10s
      timeout: 5s
      retries: 3

  # ============================================
  # MinIO File Storage Service
  # ============================================
  minio:
    image: minio/minio:latest
    container_name: elearning-minio
    ports:
      - "9000:9000"   # S3 API port
      - "9001:9001"   # Web Console
    environment:
      MINIO_ROOT_USER: minioadmin
      MINIO_ROOT_PASSWORD: minioadmin123
      MINIO_DEFAULT_BUCKETS: assignments:public,quiz-attachments:public,courses:public
      MINIO_API_CORS_ALLOW_ORIGIN: "*"
    volumes:
      - minio-data:/data
    command: server /data --console-address ":9001"
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:9000/minio/health/live"]
      interval: 30s
      timeout: 20s
      retries: 3
    networks:
      - elearning-network
    restart: unless-stopped

  # ============================================
  # MinIO Client - Initialize buckets
  # ============================================
  minio-init:
    image: minio/mc:latest
    container_name: elearning-minio-init
    depends_on:
      - minio
    entrypoint: >
      /bin/sh -c "
      sleep 5;
      mc alias set myminio http://minio:9000 minioadmin minioadmin123;
      mc mb myminio/assignments --ignore-existing;
      mc mb myminio/quiz-attachments --ignore-existing;
      mc mb myminio/courses --ignore-existing;
      mc anonymous set download myminio/assignments;
      mc anonymous set download myminio/quiz-attachments;
      mc anonymous set download myminio/courses;
      echo 'MinIO buckets initialized';
      exit 0;
      "
    networks:
      - elearning-network

# ============================================
# Networks
# ============================================
networks:
  elearning-network:
    driver: bridge

# ============================================
# Volumes
# ============================================
volumes:
  mongo-data:
    driver: local
  minio-data:
    driver: local
```

### 2. Backend — Payment Service (4 files)

| File | Thay đổi |
|------|----------|
| [payment.service.ts](file:///d:/HK/HK8/Cong_nghe_moi/UMI-PROJECT/services/payment-service/src/services/payment.service.ts) | Sửa `confirmPayment()` dùng `getPaymentIntent` thay vì `confirmPayment` Stripe; Thêm `getPaymentByOrder()` |
| [payment.controller.ts](file:///d:/HK/HK8/Cong_nghe_moi/UMI-PROJECT/services/payment-service/src/controllers/payment.controller.ts) | Thêm `getPaymentByOrder` + `createPaymentIntentInternal` controllers |
| [app.ts](file:///d:/HK/HK8/Cong_nghe_moi/UMI-PROJECT/services/payment-service/src/app.ts) | Thêm route `GET /order/:orderId` + `POST /internal/create-intent` |

```diff:payment.service.ts
import { PrismaClient, PaymentStatus, RefundStatus } from '@prisma/client';
import axios from 'axios';
import { StripeService } from './stripe.service';
import { ERROR_MESSAGES } from '../utils/constants';
import logger from '../utils/logger';
import Stripe from 'stripe';

const prisma = new PrismaClient();

export interface CreatePaymentData {
  orderId?: string;
  orderNumber?: string;
  userId: string;
  amount: number;
  currency?: string;
  type?: string; // New field
  metadata?: Record<string, string>;
}

export interface ConfirmPaymentData {
  paymentIntentId: string;
  paymentMethodId: string;
}

export class PaymentService {
  static async createPaymentIntent(data: CreatePaymentData) {
    const { orderId, orderNumber, userId, amount, currency = 'usd', type = 'COURSE_PURCHASE', metadata = {} } = data;

    // Validation for course purchase
    if (type === 'COURSE_PURCHASE' && (!orderId || !orderNumber)) {
      throw new Error('orderId and orderNumber are required for course purchase');
    }

    // Check if payment already exists
    const where: any = {
      userId,
      status: { in: [PaymentStatus.PENDING, PaymentStatus.PROCESSING, PaymentStatus.SUCCEEDED] },
      type: type as any,
    };
    if (orderId) where.orderId = orderId;

    const existingPayment = await prisma.payment.findFirst({
      where,
    });

    if (existingPayment) {
      throw new Error(ERROR_MESSAGES.PAYMENT_ALREADY_PROCESSED);
    }

    // Create Stripe payment intent
    const stripePaymentIntent = await StripeService.createPaymentIntent({
      amount,
      currency,
      metadata: {
        orderId: orderId ?? '',
        orderNumber: orderNumber ?? '',
        userId,
        type,
        ...metadata,
      },
    });

    // Create payment record in database
    const payment = await prisma.payment.create({
      data: {
        orderId: (orderId || undefined) as any,
        orderNumber: (orderNumber || undefined) as any,
        userId,
        amount,
        currency,
        type: type as any,
        status: PaymentStatus.PENDING,
        stripePaymentIntentId: stripePaymentIntent.id,
        clientSecret: stripePaymentIntent.clientSecret,
        metadata: metadata as any,
      },
    });

    logger.info(`Payment intent created: ${stripePaymentIntent.id} for ${type}`);

    return {
      id: payment.id,
      stripePaymentIntentId: stripePaymentIntent.id,
      clientSecret: stripePaymentIntent.clientSecret,
      amount: payment.amount,
      currency: payment.currency,
      status: payment.status,
    };
  }

  static async confirmPayment(data: ConfirmPaymentData) {
    const { paymentIntentId, paymentMethodId } = data;

    // Find payment in database
    const payment = await prisma.payment.findFirst({
      where: { stripePaymentIntentId: paymentIntentId },
    });

    if (!payment) {
      throw new Error(ERROR_MESSAGES.PAYMENT_NOT_FOUND);
    }

    if (payment.status !== PaymentStatus.PENDING) {
      throw new Error(ERROR_MESSAGES.PAYMENT_ALREADY_PROCESSED);
    }

    // Update status to processing
    await prisma.payment.update({
      where: { id: payment.id },
      data: { status: PaymentStatus.PROCESSING },
    });

    try {
      // Confirm with Stripe
      const stripePayment = await StripeService.confirmPayment(paymentIntentId, paymentMethodId);

      let newStatus: PaymentStatus;
      let completedAt = null;

      if (stripePayment.status === 'succeeded') {
        newStatus = PaymentStatus.SUCCEEDED;
        completedAt = new Date();

        // Notify services based on payment type
        if ((payment as any).type === 'COURSE_PURCHASE' && payment.orderId) {
          await this.notifyOrderService(payment.orderId, 'PAID');
        } else if ((payment as any).type === ('INSTRUCTOR_REGISTRATION' as any)) {
          await this.notifyUserService(payment.userId, 'INSTRUCTOR_REGISTRATION_SUCCESS');
        }
      } else if (stripePayment.status === 'requires_payment_method') {
        newStatus = PaymentStatus.FAILED;
      } else {
        newStatus = PaymentStatus.PENDING;
      }

      // Update payment record
      const updatedPayment = await prisma.payment.update({
        where: { id: payment.id },
        data: {
          status: newStatus,
          paymentMethodId,
          completedAt,
        },
      });

      logger.info(`Payment confirmed: ${paymentIntentId}, status: ${newStatus}`);

      return updatedPayment;
    } catch (error: any) {
      // Update payment as failed
      await prisma.payment.update({
        where: { id: payment.id },
        data: {
          status: PaymentStatus.FAILED,
          errorMessage: error.message,
        },
      });

      // Notify services about failure
      if ((payment as any).type === 'COURSE_PURCHASE' && payment.orderId) {
        await this.notifyOrderService(payment.orderId, 'FAILED');
      }

      throw error;
    }
  }

  static async getPaymentById(paymentId: string, userId: string, isAdmin: boolean = false) {
    const where: any = { id: paymentId };
    if (!isAdmin) {
      where.userId = userId;
    }

    const payment = await prisma.payment.findUnique({
      where,
      include: {
        refunds: true,
      },
    });

    if (!payment) {
      throw new Error(ERROR_MESSAGES.PAYMENT_NOT_FOUND);
    }

    // Get latest status from Stripe
    if (payment.stripePaymentIntentId) {
      try {
        const stripePayment = await StripeService.getPaymentIntent(payment.stripePaymentIntentId);
        if (stripePayment.status !== payment.status.toLowerCase()) {
          // Update status if changed
          await prisma.payment.update({
            where: { id: payment.id },
            data: { status: stripePayment.status.toUpperCase() as PaymentStatus },
          });
          payment.status = stripePayment.status.toUpperCase() as PaymentStatus;
        }
      } catch (error) {
        logger.error('Failed to sync payment status from Stripe:', error);
      }
    }

    return payment;
  }

  static async getPaymentByStripeId(stripePaymentIntentId: string) {
    const payment = await prisma.payment.findFirst({
      where: { stripePaymentIntentId },
      include: {
        refunds: true,
      },
    });

    if (!payment) {
      throw new Error(ERROR_MESSAGES.PAYMENT_NOT_FOUND);
    }

    return payment;
  }

  static async getUserPayments(userId: string, page: number = 1, limit: number = 10) {
    const skip = (page - 1) * limit;

    const [payments, total] = await Promise.all([
      prisma.payment.findMany({
        where: { userId },
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
      prisma.payment.count({ where: { userId } }),
    ]);

    return {
      payments,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  static async refundPayment(
    paymentId: string,
    userId: string,
    amount?: number,
    reason?: string,
    isAdmin: boolean = false
  ) {
    const payment = await prisma.payment.findUnique({
      where: { id: paymentId },
    });

    if (!payment) {
      throw new Error(ERROR_MESSAGES.PAYMENT_NOT_FOUND);
    }

    if (!isAdmin && payment.userId !== userId) {
      throw new Error(ERROR_MESSAGES.FORBIDDEN);
    }

    if (payment.status !== PaymentStatus.SUCCEEDED) {
      throw new Error(ERROR_MESSAGES.PAYMENT_ALREADY_PROCESSED);
    }

    // Check if refund already exists
    const existingRefund = await prisma.refund.findFirst({
      where: { paymentId, status: RefundStatus.SUCCEEDED },
    });

    if (existingRefund) {
      throw new Error(ERROR_MESSAGES.REFUND_ALREADY_PROCESSED);
    }

    const refundAmount = amount || payment.amount;

    if (refundAmount > payment.amount) {
      throw new Error(ERROR_MESSAGES.INSUFFICIENT_PAYMENT_AMOUNT);
    }

    try {
      // Process refund with Stripe
      const stripeRefund = await StripeService.refundPayment(
        payment.stripePaymentIntentId!,
        refundAmount,
        reason
      );

      // Create refund record
      const refund = await prisma.refund.create({
        data: {
          paymentId: payment.id,
          orderId: payment.orderId,
          orderNumber: payment.orderNumber,
          userId: payment.userId,
          amount: refundAmount,
          currency: payment.currency,
          reason,
          status: stripeRefund.status === 'succeeded' ? RefundStatus.SUCCEEDED : RefundStatus.PENDING,
          stripeRefundId: stripeRefund.id,
          completedAt: stripeRefund.status === 'succeeded' ? new Date() : undefined,
        },
      });

      // Update payment status if fully refunded
      if (refundAmount === payment.amount) {
        await prisma.payment.update({
          where: { id: payment.id },
          data: { status: PaymentStatus.REFUNDED },
        });
      }

      // Notify order service
      if (payment.orderId) {
        await this.notifyOrderService(payment.orderId, 'REFUNDED');
      }

      logger.info(`Refund processed: ${stripeRefund.id} for payment ${payment.stripePaymentIntentId}`);

      return refund;
    } catch (error: any) {
      // Create failed refund record
      await prisma.refund.create({
        data: {
          paymentId: payment.id,
          orderId: payment.orderId,
          orderNumber: payment.orderNumber,
          userId: payment.userId,
          amount: refundAmount,
          currency: payment.currency,
          reason,
          status: RefundStatus.FAILED,
          errorMessage: error.message,
        },
      });

      throw error;
    }
  }

  static async handleStripeWebhook(event: any) {
    const { type, data } = event;

    // Save webhook event
    await prisma.stripeEvent.create({
      data: {
        stripeEventId: event.id,
        type,
        data,
        processed: false,
      },
    });

    let processed = false;
    let error = null;

    try {
      switch (type) {
        case 'payment_intent.succeeded':
          await this.handlePaymentIntentSucceeded(data.object);
          processed = true;
          break;

        case 'payment_intent.payment_failed':
          await this.handlePaymentIntentFailed(data.object);
          processed = true;
          break;

        case 'payment_intent.canceled':
          await this.handlePaymentIntentCanceled(data.object);
          processed = true;
          break;

        case 'charge.refunded':
          await this.handleChargeRefunded(data.object);
          processed = true;
          break;

        case 'charge.refund.updated':
          await this.handleRefundUpdated(data.object);
          processed = true;
          break;

        default:
          logger.info(`Unhandled webhook event type: ${type}`);
          processed = true;
      }
    } catch (err: any) {
      error = err.message;
      logger.error(`Error processing webhook event ${type}:`, err);
    }

    // Update webhook event
    await prisma.stripeEvent.update({
      where: { stripeEventId: event.id },
      data: {
        processed,
        processedAt: processed ? new Date() : undefined,
        error,
      },
    });
  }

  private static async handlePaymentIntentSucceeded(paymentIntent: any) {
    const payment = await prisma.payment.findFirst({
      where: { stripePaymentIntentId: paymentIntent.id },
    });

    if (payment && payment.status !== PaymentStatus.SUCCEEDED) {
      await prisma.payment.update({
        where: { id: payment.id },
        data: {
          status: PaymentStatus.SUCCEEDED,
          completedAt: new Date(),
        },
      });

      if ((payment as any).type === 'COURSE_PURCHASE' && payment.orderId) {
        await this.notifyOrderService(payment.orderId, 'PAID');
      } else if ((payment as any).type === ('INSTRUCTOR_REGISTRATION' as any)) {
        await this.notifyUserService(payment.userId, 'INSTRUCTOR_REGISTRATION_SUCCESS');
      }

      logger.info(`Payment succeeded: ${paymentIntent.id}`);
    }
  }

  private static async handlePaymentIntentFailed(paymentIntent: any) {
    const payment = await prisma.payment.findFirst({
      where: { stripePaymentIntentId: paymentIntent.id },
    });

    if (payment && payment.status !== PaymentStatus.FAILED) {
      await prisma.payment.update({
        where: { id: payment.id },
        data: {
          status: PaymentStatus.FAILED,
          errorMessage: paymentIntent.last_payment_error?.message,
        },
      });

      if (payment.orderId) {
        await this.notifyOrderService(payment.orderId, 'FAILED');
      }
      logger.info(`Payment failed: ${paymentIntent.id}`);
    }
  }

  private static async handleChargeRefunded(charge: any) {
    const payment = await prisma.payment.findFirst({
      where: { stripePaymentIntentId: charge.payment_intent },
    });

    if (payment) {
      // Update refund records if exists
      const refund = await prisma.refund.findFirst({
        where: { paymentId: payment.id, status: RefundStatus.PENDING },
      });

      if (refund) {
        await prisma.refund.update({
          where: { id: refund.id },
          data: { status: RefundStatus.SUCCEEDED, completedAt: new Date() },
        });
      }

      await prisma.payment.update({
        where: { id: payment.id },
        data: { status: PaymentStatus.REFUNDED },
      });

      if (payment.orderId) {
        await this.notifyOrderService(payment.orderId, 'REFUNDED');
      }
      logger.info(`Payment refunded: ${charge.payment_intent}`);
    }
  }

  private static async handlePaymentIntentCanceled(paymentIntent: any) {
    const payment = await prisma.payment.findFirst({
      where: { stripePaymentIntentId: paymentIntent.id },
    });

    if (payment && payment.status !== PaymentStatus.CANCELLED) {
      await prisma.payment.update({
        where: { id: payment.id },
        data: {
          status: PaymentStatus.CANCELLED,
          completedAt: new Date(),
        },
      });

      if (payment.orderId) {
        await this.notifyOrderService(payment.orderId, 'CANCELLED');
      }
      logger.info(`Payment cancelled via webhook: ${paymentIntent.id}`);
    }
  }

  private static async handleRefundUpdated(refundObject: any) {
    // Find the related refund record by stripe refund id
    const refund = await prisma.refund.findFirst({
      where: { stripeRefundId: refundObject.id },
    });

    if (refund) {
      let newStatus: RefundStatus;
      if (refundObject.status === 'succeeded') {
        newStatus = RefundStatus.SUCCEEDED;
      } else if (refundObject.status === 'failed') {
        newStatus = RefundStatus.FAILED;
      } else {
        newStatus = RefundStatus.PENDING;
      }

      await prisma.refund.update({
        where: { id: refund.id },
        data: {
          status: newStatus,
          completedAt: newStatus === RefundStatus.SUCCEEDED ? new Date() : undefined,
          errorMessage: refundObject.failure_reason || undefined,
        },
      });

      logger.info(`Refund updated: ${refundObject.id}, status: ${newStatus}`);
    }
  }

  private static async notifyOrderService(orderId: string, status: string) {
    try {
      const orderServiceUrl = process.env.ORDER_SERVICE_URL || 'http://localhost:3004';
      await axios.post(`${orderServiceUrl}/api/orders/webhook/payment`, {
        orderId,
        status,
      });
      logger.info(`Notified order service about payment ${status} for order ${orderId}`);
    } catch (error) {
      logger.error(`Failed to notify order service:`, error);
    }
  }

  private static async notifyUserService(userId: string, status: string) {
    try {
      const userServiceUrl = process.env.USER_SERVICE_URL || 'http://localhost:3002';
      await axios.post(`${userServiceUrl}/api/users/become-instructor/confirm`, {
        userId,
        status,
      });
      logger.info(`Notified user service about ${status} for user ${userId}`);
    } catch (error) {
      logger.error(`Failed to notify user service:`, error);
    }
  }

  static async cancelPayment(paymentId: string, userId: string, isAdmin: boolean = false) {
    const payment = await prisma.payment.findUnique({
      where: { id: paymentId },
    });

    if (!payment) {
      throw new Error(ERROR_MESSAGES.PAYMENT_NOT_FOUND);
    }

    if (!isAdmin && payment.userId !== userId) {
      throw new Error(ERROR_MESSAGES.FORBIDDEN);
    }

    if (payment.status !== PaymentStatus.PENDING) {
      throw new Error(ERROR_MESSAGES.PAYMENT_ALREADY_PROCESSED);
    }

    try {
      // Cancel with Stripe
      await StripeService.cancelPaymentIntent(payment.stripePaymentIntentId!);

      // Update payment record
      const updatedPayment = await prisma.payment.update({
        where: { id: payment.id },
        data: {
          status: PaymentStatus.CANCELLED,
          completedAt: new Date(),
        },
      });

      // Notify order service
      if (payment.orderId) {
        await this.notifyOrderService(payment.orderId, 'CANCELLED');
      }

      logger.info(`Payment cancelled: ${payment.stripePaymentIntentId}`);
      return updatedPayment;
    } catch (error: any) {
      logger.error('Failed to cancel payment:', error);
      throw error;
    }
  }

  static async getPaymentStats(userId?: string, fromDate?: Date, toDate?: Date) {
    const where: any = {};
    
    if (userId) {
      where.userId = userId;
    }
    
    if (fromDate || toDate) {
      where.createdAt = {};
      if (fromDate) where.createdAt.gte = fromDate;
      if (toDate) where.createdAt.lte = toDate;
    }

    const stats = await prisma.payment.aggregate({
      where: {
        ...where,
        status: PaymentStatus.SUCCEEDED,
      },
      _sum: {
        amount: true,
      },
      _count: true,
    });

    const byStatus = await prisma.payment.groupBy({
      by: ['status'],
      where,
      _count: true,
      _sum: {
        amount: true,
      },
    });

    return {
      totalRevenue: stats._sum.amount || 0,
      totalTransactions: stats._count,
      byStatus,
    };
  }

  static async getRefundStats(userId?: string) {
    const where: any = {};
    if (userId) {
      where.userId = userId;
    }

    const stats = await prisma.refund.aggregate({
      where: {
        ...where,
        status: RefundStatus.SUCCEEDED,
      },
      _sum: {
        amount: true,
      },
      _count: true,
    });

    const byStatus = await prisma.refund.groupBy({
      by: ['status'],
      where,
      _count: true,
      _sum: {
        amount: true,
      },
    });

    return {
      totalRefunded: stats._sum.amount || 0,
      totalRefunds: stats._count,
      byStatus,
    };
  }

  static async getRefundById(refundId: string, userId: string, isAdmin: boolean = false) {
    const where: any = { id: refundId };
    if (!isAdmin) {
      where.userId = userId;
    }

    const refund = await prisma.refund.findUnique({
      where,
      include: {
        payment: true,
      },
    });

    if (!refund) {
      throw new Error(ERROR_MESSAGES.REFUND_NOT_FOUND);
    }

    return refund;
  }

  static async getUserRefunds(userId: string, page: number = 1, limit: number = 10) {
    const skip = (page - 1) * limit;

    const [refunds, total] = await Promise.all([
      prisma.refund.findMany({
        where: { userId },
        skip,
        take: limit,
        include: {
          payment: {
            select: {
              amount: true,
              currency: true,
              stripePaymentIntentId: true,
            },
          },
        },
        orderBy: { createdAt: 'desc' },
      }),
      prisma.refund.count({ where: { userId } }),
    ]);

    return {
      refunds,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  static async getWebhookEvents(
    page: number = 1,
    limit: number = 10,
    type?: string,
    processed?: boolean
  ) {
    const skip = (page - 1) * limit;

    const where: any = {};
    if (type) where.type = type;
    if (processed !== undefined) where.processed = processed;

    const [events, total] = await Promise.all([
      prisma.stripeEvent.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
      prisma.stripeEvent.count({ where }),
    ]);

    return {
      events,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  static async reprocessWebhookEvent(eventId: string) {
    const event = await prisma.stripeEvent.findUnique({
      where: { id: eventId },
    });

    if (!event) {
      throw new Error('Webhook event not found');
    }

    // Reprocess the event
    await this.handleStripeWebhook({
      id: event.stripeEventId,
      type: event.type,
      data: event.data,
    });

    return { success: true };
  }

  static async createSetupIntent(userId: string, email: string) {
    try {
      // Create or get customer
      let customerId: string;
      
      const existingPayment = await prisma.payment.findFirst({
        where: { userId, stripeCustomerId: { not: null } },
      });

      if (existingPayment?.stripeCustomerId) {
        customerId = existingPayment.stripeCustomerId;
      } else {
        const customer = await StripeService.createCustomer(email, undefined, {
          userId,
        });
        customerId = customer.id;
      }

      // Create setup intent for saving payment method
      const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
        apiVersion: '2023-10-16',
      });

      const setupIntent = await stripe.setupIntents.create({
        customer: customerId,
        payment_method_types: ['card'],
      });

      return {
        clientSecret: setupIntent.client_secret,
        customerId,
      };
    } catch (error: any) {
      logger.error('Failed to create setup intent:', error);
      throw new Error(`Setup intent error: ${error.message}`);
    }
  }

  static async savePaymentMethod(userId: string, paymentMethodId: string) {
    try {
      // Attach payment method to customer
      const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
        apiVersion: '2023-10-16',
      });

      // Get or create customer
      let customerId: string;
      
      const existingPayment = await prisma.payment.findFirst({
        where: { userId, stripeCustomerId: { not: null } },
      });

      if (existingPayment?.stripeCustomerId) {
        customerId = existingPayment.stripeCustomerId;
      } else {
        // Get user email
        const userServiceUrl = process.env.USER_SERVICE_URL || 'http://localhost:3002';
        const userResponse = await axios.get(`${userServiceUrl}/api/users/${userId}`);
        const userEmail = userResponse.data.data.email;

        const customer = await StripeService.createCustomer(userEmail, undefined, {
          userId,
        });
        customerId = customer.id;
      }

      // Attach payment method
      await stripe.paymentMethods.attach(paymentMethodId, {
        customer: customerId,
      });

      // Set as default payment method
      await stripe.customers.update(customerId, {
        invoice_settings: {
          default_payment_method: paymentMethodId,
        },
      });

      logger.info(`Payment method saved for user ${userId}`);

      return {
        success: true,
        customerId,
      };
    } catch (error: any) {
      logger.error('Failed to save payment method:', error);
      throw new Error(`Save payment method error: ${error.message}`);
    }
  }

  static async getPaymentMethods(userId: string) {
    try {
      // Get customer ID
      const payment = await prisma.payment.findFirst({
        where: { userId, stripeCustomerId: { not: null } },
      });

      if (!payment?.stripeCustomerId) {
        return { paymentMethods: [] };
      }

      const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
        apiVersion: '2023-10-16',
      });

      const paymentMethods = await stripe.paymentMethods.list({
        customer: payment.stripeCustomerId,
        type: 'card',
      });

      return {
        paymentMethods: paymentMethods.data.map(pm => ({
          id: pm.id,
          type: pm.type,
          card: {
            brand: pm.card?.brand,
            last4: pm.card?.last4,
            expMonth: pm.card?.exp_month,
            expYear: pm.card?.exp_year,
          },
          isDefault: pm.id === (payment.metadata as any)?.defaultPaymentMethod,
        })),
      };
    } catch (error: any) {
      logger.error('Failed to get payment methods:', error);
      throw new Error(`Get payment methods error: ${error.message}`);
    }
  }

  static async healthCheck() {
    try {
      await prisma.$runCommandRaw({ ping: 1 });
      
      // Check Stripe connection
      let stripeStatus = 'connected';
      try {
        const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
          apiVersion: '2023-10-16',
        });
        await stripe.balance.retrieve();
      } catch (error) {
        stripeStatus = 'disconnected';
      }
      
      return {
        service: 'payment-service',
        status: 'active',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        database: 'connected',
        stripe: stripeStatus,
      };
    } catch (error) {
      return {
        service: 'payment-service',
        status: 'degraded',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        database: 'disconnected',
        stripe: 'unknown',
      };
    }
  }
}
===
import { PrismaClient, PaymentStatus, RefundStatus } from '@prisma/client';
import axios from 'axios';
import { StripeService } from './stripe.service';
import { ERROR_MESSAGES } from '../utils/constants';
import logger from '../utils/logger';
import Stripe from 'stripe';

const prisma = new PrismaClient();

export interface CreatePaymentData {
  orderId?: string;
  orderNumber?: string;
  userId: string;
  amount: number;
  currency?: string;
  type?: string; // New field
  metadata?: Record<string, string>;
}

export interface ConfirmPaymentData {
  paymentIntentId: string;
  paymentMethodId: string;
}

export class PaymentService {
  static async createPaymentIntent(data: CreatePaymentData) {
    const { orderId, orderNumber, userId, amount, currency = 'usd', type = 'COURSE_PURCHASE', metadata = {} } = data;

    // Validation for course purchase
    if (type === 'COURSE_PURCHASE' && (!orderId || !orderNumber)) {
      throw new Error('orderId and orderNumber are required for course purchase');
    }

    // Check if payment already exists
    const where: any = {
      userId,
      status: { in: [PaymentStatus.PENDING, PaymentStatus.PROCESSING, PaymentStatus.SUCCEEDED] },
      type: type as any,
    };
    if (orderId) where.orderId = orderId;

    const existingPayment = await prisma.payment.findFirst({
      where,
    });

    if (existingPayment) {
      throw new Error(ERROR_MESSAGES.PAYMENT_ALREADY_PROCESSED);
    }

    // Create Stripe payment intent
    const stripePaymentIntent = await StripeService.createPaymentIntent({
      amount,
      currency,
      metadata: {
        orderId: orderId ?? '',
        orderNumber: orderNumber ?? '',
        userId,
        type,
        ...metadata,
      },
    });

    // Create payment record in database
    const payment = await prisma.payment.create({
      data: {
        orderId: (orderId || undefined) as any,
        orderNumber: (orderNumber || undefined) as any,
        userId,
        amount,
        currency,
        type: type as any,
        status: PaymentStatus.PENDING,
        stripePaymentIntentId: stripePaymentIntent.id,
        clientSecret: stripePaymentIntent.clientSecret,
        metadata: metadata as any,
      },
    });

    logger.info(`Payment intent created: ${stripePaymentIntent.id} for ${type}`);

    return {
      id: payment.id,
      stripePaymentIntentId: stripePaymentIntent.id,
      clientSecret: stripePaymentIntent.clientSecret,
      amount: payment.amount,
      currency: payment.currency,
      status: payment.status,
    };
  }

  static async confirmPayment(data: ConfirmPaymentData) {
    const { paymentIntentId, paymentMethodId } = data;

    // Find payment in database
    const payment = await prisma.payment.findFirst({
      where: { stripePaymentIntentId: paymentIntentId },
    });

    if (!payment) {
      throw new Error(ERROR_MESSAGES.PAYMENT_NOT_FOUND);
    }

    // If already succeeded, return it directly
    if (payment.status === PaymentStatus.SUCCEEDED) {
      return payment;
    }

    if (payment.status !== PaymentStatus.PENDING && payment.status !== PaymentStatus.PROCESSING) {
      throw new Error(ERROR_MESSAGES.PAYMENT_ALREADY_PROCESSED);
    }

    // Update status to processing
    await prisma.payment.update({
      where: { id: payment.id },
      data: { status: PaymentStatus.PROCESSING },
    });

    try {
      // Verify payment status from Stripe (frontend already confirmed via stripe.confirmCardPayment)
      const stripePayment = await StripeService.getPaymentIntent(paymentIntentId);

      let newStatus: PaymentStatus;
      let completedAt = null;

      if (stripePayment.status === 'succeeded') {
        newStatus = PaymentStatus.SUCCEEDED;
        completedAt = new Date();

        // Notify services based on payment type
        if ((payment as any).type === 'COURSE_PURCHASE' && payment.orderId) {
          await this.notifyOrderService(payment.orderId, 'PAID');
        } else if ((payment as any).type === ('INSTRUCTOR_REGISTRATION' as any)) {
          await this.notifyUserService(payment.userId, 'INSTRUCTOR_REGISTRATION_SUCCESS');
        }
      } else if (stripePayment.status === 'requires_payment_method') {
        newStatus = PaymentStatus.FAILED;
      } else if (stripePayment.status === 'canceled') {
        newStatus = PaymentStatus.CANCELLED;
      } else {
        newStatus = PaymentStatus.PENDING;
      }

      // Update payment record
      const updatedPayment = await prisma.payment.update({
        where: { id: payment.id },
        data: {
          status: newStatus,
          paymentMethodId,
          completedAt,
        },
      });

      logger.info(`Payment confirmed: ${paymentIntentId}, status: ${newStatus}`);

      return updatedPayment;
    } catch (error: any) {
      // Update payment as failed
      await prisma.payment.update({
        where: { id: payment.id },
        data: {
          status: PaymentStatus.FAILED,
          errorMessage: error.message,
        },
      });

      // Notify services about failure
      if ((payment as any).type === 'COURSE_PURCHASE' && payment.orderId) {
        await this.notifyOrderService(payment.orderId, 'FAILED');
      }

      throw error;
    }
  }

  static async getPaymentByOrder(orderId: string, userId: string) {
    const payment = await prisma.payment.findFirst({
      where: {
        orderId,
        userId,
        status: { in: [PaymentStatus.PENDING, PaymentStatus.PROCESSING] },
      },
      orderBy: { createdAt: 'desc' },
    });

    if (!payment) {
      throw new Error(ERROR_MESSAGES.PAYMENT_NOT_FOUND);
    }

    return {
      id: payment.id,
      stripePaymentIntentId: payment.stripePaymentIntentId,
      clientSecret: payment.clientSecret,
      amount: payment.amount,
      currency: payment.currency,
      status: payment.status,
    };
  }

  static async getPaymentById(paymentId: string, userId: string, isAdmin: boolean = false) {
    const where: any = { id: paymentId };
    if (!isAdmin) {
      where.userId = userId;
    }

    const payment = await prisma.payment.findUnique({
      where,
      include: {
        refunds: true,
      },
    });

    if (!payment) {
      throw new Error(ERROR_MESSAGES.PAYMENT_NOT_FOUND);
    }

    // Get latest status from Stripe
    if (payment.stripePaymentIntentId) {
      try {
        const stripePayment = await StripeService.getPaymentIntent(payment.stripePaymentIntentId);
        if (stripePayment.status !== payment.status.toLowerCase()) {
          // Update status if changed
          await prisma.payment.update({
            where: { id: payment.id },
            data: { status: stripePayment.status.toUpperCase() as PaymentStatus },
          });
          payment.status = stripePayment.status.toUpperCase() as PaymentStatus;
        }
      } catch (error) {
        logger.error('Failed to sync payment status from Stripe:', error);
      }
    }

    return payment;
  }

  static async getPaymentByStripeId(stripePaymentIntentId: string) {
    const payment = await prisma.payment.findFirst({
      where: { stripePaymentIntentId },
      include: {
        refunds: true,
      },
    });

    if (!payment) {
      throw new Error(ERROR_MESSAGES.PAYMENT_NOT_FOUND);
    }

    return payment;
  }

  static async getUserPayments(userId: string, page: number = 1, limit: number = 10) {
    const skip = (page - 1) * limit;

    const [payments, total] = await Promise.all([
      prisma.payment.findMany({
        where: { userId },
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
      prisma.payment.count({ where: { userId } }),
    ]);

    return {
      payments,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  static async refundPayment(
    paymentId: string,
    userId: string,
    amount?: number,
    reason?: string,
    isAdmin: boolean = false
  ) {
    const payment = await prisma.payment.findUnique({
      where: { id: paymentId },
    });

    if (!payment) {
      throw new Error(ERROR_MESSAGES.PAYMENT_NOT_FOUND);
    }

    if (!isAdmin && payment.userId !== userId) {
      throw new Error(ERROR_MESSAGES.FORBIDDEN);
    }

    if (payment.status !== PaymentStatus.SUCCEEDED) {
      throw new Error(ERROR_MESSAGES.PAYMENT_ALREADY_PROCESSED);
    }

    // Check if refund already exists
    const existingRefund = await prisma.refund.findFirst({
      where: { paymentId, status: RefundStatus.SUCCEEDED },
    });

    if (existingRefund) {
      throw new Error(ERROR_MESSAGES.REFUND_ALREADY_PROCESSED);
    }

    const refundAmount = amount || payment.amount;

    if (refundAmount > payment.amount) {
      throw new Error(ERROR_MESSAGES.INSUFFICIENT_PAYMENT_AMOUNT);
    }

    try {
      // Process refund with Stripe
      const stripeRefund = await StripeService.refundPayment(
        payment.stripePaymentIntentId!,
        refundAmount,
        reason
      );

      // Create refund record
      const refund = await prisma.refund.create({
        data: {
          paymentId: payment.id,
          orderId: payment.orderId,
          orderNumber: payment.orderNumber,
          userId: payment.userId,
          amount: refundAmount,
          currency: payment.currency,
          reason,
          status: stripeRefund.status === 'succeeded' ? RefundStatus.SUCCEEDED : RefundStatus.PENDING,
          stripeRefundId: stripeRefund.id,
          completedAt: stripeRefund.status === 'succeeded' ? new Date() : undefined,
        },
      });

      // Update payment status if fully refunded
      if (refundAmount === payment.amount) {
        await prisma.payment.update({
          where: { id: payment.id },
          data: { status: PaymentStatus.REFUNDED },
        });
      }

      // Notify order service
      if (payment.orderId) {
        await this.notifyOrderService(payment.orderId, 'REFUNDED');
      }

      logger.info(`Refund processed: ${stripeRefund.id} for payment ${payment.stripePaymentIntentId}`);

      return refund;
    } catch (error: any) {
      // Create failed refund record
      await prisma.refund.create({
        data: {
          paymentId: payment.id,
          orderId: payment.orderId,
          orderNumber: payment.orderNumber,
          userId: payment.userId,
          amount: refundAmount,
          currency: payment.currency,
          reason,
          status: RefundStatus.FAILED,
          errorMessage: error.message,
        },
      });

      throw error;
    }
  }

  static async handleStripeWebhook(event: any) {
    const { type, data } = event;

    // Save webhook event
    await prisma.stripeEvent.create({
      data: {
        stripeEventId: event.id,
        type,
        data,
        processed: false,
      },
    });

    let processed = false;
    let error = null;

    try {
      switch (type) {
        case 'payment_intent.succeeded':
          await this.handlePaymentIntentSucceeded(data.object);
          processed = true;
          break;

        case 'payment_intent.payment_failed':
          await this.handlePaymentIntentFailed(data.object);
          processed = true;
          break;

        case 'payment_intent.canceled':
          await this.handlePaymentIntentCanceled(data.object);
          processed = true;
          break;

        case 'charge.refunded':
          await this.handleChargeRefunded(data.object);
          processed = true;
          break;

        case 'charge.refund.updated':
          await this.handleRefundUpdated(data.object);
          processed = true;
          break;

        default:
          logger.info(`Unhandled webhook event type: ${type}`);
          processed = true;
      }
    } catch (err: any) {
      error = err.message;
      logger.error(`Error processing webhook event ${type}:`, err);
    }

    // Update webhook event
    await prisma.stripeEvent.update({
      where: { stripeEventId: event.id },
      data: {
        processed,
        processedAt: processed ? new Date() : undefined,
        error,
      },
    });
  }

  private static async handlePaymentIntentSucceeded(paymentIntent: any) {
    const payment = await prisma.payment.findFirst({
      where: { stripePaymentIntentId: paymentIntent.id },
    });

    if (payment && payment.status !== PaymentStatus.SUCCEEDED) {
      await prisma.payment.update({
        where: { id: payment.id },
        data: {
          status: PaymentStatus.SUCCEEDED,
          completedAt: new Date(),
        },
      });

      if ((payment as any).type === 'COURSE_PURCHASE' && payment.orderId) {
        await this.notifyOrderService(payment.orderId, 'PAID');
      } else if ((payment as any).type === ('INSTRUCTOR_REGISTRATION' as any)) {
        await this.notifyUserService(payment.userId, 'INSTRUCTOR_REGISTRATION_SUCCESS');
      }

      logger.info(`Payment succeeded: ${paymentIntent.id}`);
    }
  }

  private static async handlePaymentIntentFailed(paymentIntent: any) {
    const payment = await prisma.payment.findFirst({
      where: { stripePaymentIntentId: paymentIntent.id },
    });

    if (payment && payment.status !== PaymentStatus.FAILED) {
      await prisma.payment.update({
        where: { id: payment.id },
        data: {
          status: PaymentStatus.FAILED,
          errorMessage: paymentIntent.last_payment_error?.message,
        },
      });

      if (payment.orderId) {
        await this.notifyOrderService(payment.orderId, 'FAILED');
      }
      logger.info(`Payment failed: ${paymentIntent.id}`);
    }
  }

  private static async handleChargeRefunded(charge: any) {
    const payment = await prisma.payment.findFirst({
      where: { stripePaymentIntentId: charge.payment_intent },
    });

    if (payment) {
      // Update refund records if exists
      const refund = await prisma.refund.findFirst({
        where: { paymentId: payment.id, status: RefundStatus.PENDING },
      });

      if (refund) {
        await prisma.refund.update({
          where: { id: refund.id },
          data: { status: RefundStatus.SUCCEEDED, completedAt: new Date() },
        });
      }

      await prisma.payment.update({
        where: { id: payment.id },
        data: { status: PaymentStatus.REFUNDED },
      });

      if (payment.orderId) {
        await this.notifyOrderService(payment.orderId, 'REFUNDED');
      }
      logger.info(`Payment refunded: ${charge.payment_intent}`);
    }
  }

  private static async handlePaymentIntentCanceled(paymentIntent: any) {
    const payment = await prisma.payment.findFirst({
      where: { stripePaymentIntentId: paymentIntent.id },
    });

    if (payment && payment.status !== PaymentStatus.CANCELLED) {
      await prisma.payment.update({
        where: { id: payment.id },
        data: {
          status: PaymentStatus.CANCELLED,
          completedAt: new Date(),
        },
      });

      if (payment.orderId) {
        await this.notifyOrderService(payment.orderId, 'CANCELLED');
      }
      logger.info(`Payment cancelled via webhook: ${paymentIntent.id}`);
    }
  }

  private static async handleRefundUpdated(refundObject: any) {
    // Find the related refund record by stripe refund id
    const refund = await prisma.refund.findFirst({
      where: { stripeRefundId: refundObject.id },
    });

    if (refund) {
      let newStatus: RefundStatus;
      if (refundObject.status === 'succeeded') {
        newStatus = RefundStatus.SUCCEEDED;
      } else if (refundObject.status === 'failed') {
        newStatus = RefundStatus.FAILED;
      } else {
        newStatus = RefundStatus.PENDING;
      }

      await prisma.refund.update({
        where: { id: refund.id },
        data: {
          status: newStatus,
          completedAt: newStatus === RefundStatus.SUCCEEDED ? new Date() : undefined,
          errorMessage: refundObject.failure_reason || undefined,
        },
      });

      logger.info(`Refund updated: ${refundObject.id}, status: ${newStatus}`);
    }
  }

  private static async notifyOrderService(orderId: string, status: string) {
    try {
      const orderServiceUrl = process.env.ORDER_SERVICE_URL || 'http://localhost:3004';
      await axios.post(`${orderServiceUrl}/api/orders/webhook/payment`, {
        orderId,
        status,
      });
      logger.info(`Notified order service about payment ${status} for order ${orderId}`);
    } catch (error) {
      logger.error(`Failed to notify order service:`, error);
    }
  }

  private static async notifyUserService(userId: string, status: string) {
    try {
      const userServiceUrl = process.env.USER_SERVICE_URL || 'http://localhost:3002';
      await axios.post(`${userServiceUrl}/api/users/become-instructor/confirm`, {
        userId,
        status,
      });
      logger.info(`Notified user service about ${status} for user ${userId}`);
    } catch (error) {
      logger.error(`Failed to notify user service:`, error);
    }
  }

  static async cancelPayment(paymentId: string, userId: string, isAdmin: boolean = false) {
    const payment = await prisma.payment.findUnique({
      where: { id: paymentId },
    });

    if (!payment) {
      throw new Error(ERROR_MESSAGES.PAYMENT_NOT_FOUND);
    }

    if (!isAdmin && payment.userId !== userId) {
      throw new Error(ERROR_MESSAGES.FORBIDDEN);
    }

    if (payment.status !== PaymentStatus.PENDING) {
      throw new Error(ERROR_MESSAGES.PAYMENT_ALREADY_PROCESSED);
    }

    try {
      // Cancel with Stripe
      await StripeService.cancelPaymentIntent(payment.stripePaymentIntentId!);

      // Update payment record
      const updatedPayment = await prisma.payment.update({
        where: { id: payment.id },
        data: {
          status: PaymentStatus.CANCELLED,
          completedAt: new Date(),
        },
      });

      // Notify order service
      if (payment.orderId) {
        await this.notifyOrderService(payment.orderId, 'CANCELLED');
      }

      logger.info(`Payment cancelled: ${payment.stripePaymentIntentId}`);
      return updatedPayment;
    } catch (error: any) {
      logger.error('Failed to cancel payment:', error);
      throw error;
    }
  }

  static async getPaymentStats(userId?: string, fromDate?: Date, toDate?: Date) {
    const where: any = {};
    
    if (userId) {
      where.userId = userId;
    }
    
    if (fromDate || toDate) {
      where.createdAt = {};
      if (fromDate) where.createdAt.gte = fromDate;
      if (toDate) where.createdAt.lte = toDate;
    }

    const stats = await prisma.payment.aggregate({
      where: {
        ...where,
        status: PaymentStatus.SUCCEEDED,
      },
      _sum: {
        amount: true,
      },
      _count: true,
    });

    const byStatus = await prisma.payment.groupBy({
      by: ['status'],
      where,
      _count: true,
      _sum: {
        amount: true,
      },
    });

    return {
      totalRevenue: stats._sum.amount || 0,
      totalTransactions: stats._count,
      byStatus,
    };
  }

  static async getRefundStats(userId?: string) {
    const where: any = {};
    if (userId) {
      where.userId = userId;
    }

    const stats = await prisma.refund.aggregate({
      where: {
        ...where,
        status: RefundStatus.SUCCEEDED,
      },
      _sum: {
        amount: true,
      },
      _count: true,
    });

    const byStatus = await prisma.refund.groupBy({
      by: ['status'],
      where,
      _count: true,
      _sum: {
        amount: true,
      },
    });

    return {
      totalRefunded: stats._sum.amount || 0,
      totalRefunds: stats._count,
      byStatus,
    };
  }

  static async getRefundById(refundId: string, userId: string, isAdmin: boolean = false) {
    const where: any = { id: refundId };
    if (!isAdmin) {
      where.userId = userId;
    }

    const refund = await prisma.refund.findUnique({
      where,
      include: {
        payment: true,
      },
    });

    if (!refund) {
      throw new Error(ERROR_MESSAGES.REFUND_NOT_FOUND);
    }

    return refund;
  }

  static async getUserRefunds(userId: string, page: number = 1, limit: number = 10) {
    const skip = (page - 1) * limit;

    const [refunds, total] = await Promise.all([
      prisma.refund.findMany({
        where: { userId },
        skip,
        take: limit,
        include: {
          payment: {
            select: {
              amount: true,
              currency: true,
              stripePaymentIntentId: true,
            },
          },
        },
        orderBy: { createdAt: 'desc' },
      }),
      prisma.refund.count({ where: { userId } }),
    ]);

    return {
      refunds,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  static async getWebhookEvents(
    page: number = 1,
    limit: number = 10,
    type?: string,
    processed?: boolean
  ) {
    const skip = (page - 1) * limit;

    const where: any = {};
    if (type) where.type = type;
    if (processed !== undefined) where.processed = processed;

    const [events, total] = await Promise.all([
      prisma.stripeEvent.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
      prisma.stripeEvent.count({ where }),
    ]);

    return {
      events,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  static async reprocessWebhookEvent(eventId: string) {
    const event = await prisma.stripeEvent.findUnique({
      where: { id: eventId },
    });

    if (!event) {
      throw new Error('Webhook event not found');
    }

    // Reprocess the event
    await this.handleStripeWebhook({
      id: event.stripeEventId,
      type: event.type,
      data: event.data,
    });

    return { success: true };
  }

  static async createSetupIntent(userId: string, email: string) {
    try {
      // Create or get customer
      let customerId: string;
      
      const existingPayment = await prisma.payment.findFirst({
        where: { userId, stripeCustomerId: { not: null } },
      });

      if (existingPayment?.stripeCustomerId) {
        customerId = existingPayment.stripeCustomerId;
      } else {
        const customer = await StripeService.createCustomer(email, undefined, {
          userId,
        });
        customerId = customer.id;
      }

      // Create setup intent for saving payment method
      const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
        apiVersion: '2023-10-16',
      });

      const setupIntent = await stripe.setupIntents.create({
        customer: customerId,
        payment_method_types: ['card'],
      });

      return {
        clientSecret: setupIntent.client_secret,
        customerId,
      };
    } catch (error: any) {
      logger.error('Failed to create setup intent:', error);
      throw new Error(`Setup intent error: ${error.message}`);
    }
  }

  static async savePaymentMethod(userId: string, paymentMethodId: string) {
    try {
      // Attach payment method to customer
      const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
        apiVersion: '2023-10-16',
      });

      // Get or create customer
      let customerId: string;
      
      const existingPayment = await prisma.payment.findFirst({
        where: { userId, stripeCustomerId: { not: null } },
      });

      if (existingPayment?.stripeCustomerId) {
        customerId = existingPayment.stripeCustomerId;
      } else {
        // Get user email
        const userServiceUrl = process.env.USER_SERVICE_URL || 'http://localhost:3002';
        const userResponse = await axios.get(`${userServiceUrl}/api/users/${userId}`);
        const userEmail = userResponse.data.data.email;

        const customer = await StripeService.createCustomer(userEmail, undefined, {
          userId,
        });
        customerId = customer.id;
      }

      // Attach payment method
      await stripe.paymentMethods.attach(paymentMethodId, {
        customer: customerId,
      });

      // Set as default payment method
      await stripe.customers.update(customerId, {
        invoice_settings: {
          default_payment_method: paymentMethodId,
        },
      });

      logger.info(`Payment method saved for user ${userId}`);

      return {
        success: true,
        customerId,
      };
    } catch (error: any) {
      logger.error('Failed to save payment method:', error);
      throw new Error(`Save payment method error: ${error.message}`);
    }
  }

  static async getPaymentMethods(userId: string) {
    try {
      // Get customer ID
      const payment = await prisma.payment.findFirst({
        where: { userId, stripeCustomerId: { not: null } },
      });

      if (!payment?.stripeCustomerId) {
        return { paymentMethods: [] };
      }

      const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
        apiVersion: '2023-10-16',
      });

      const paymentMethods = await stripe.paymentMethods.list({
        customer: payment.stripeCustomerId,
        type: 'card',
      });

      return {
        paymentMethods: paymentMethods.data.map(pm => ({
          id: pm.id,
          type: pm.type,
          card: {
            brand: pm.card?.brand,
            last4: pm.card?.last4,
            expMonth: pm.card?.exp_month,
            expYear: pm.card?.exp_year,
          },
          isDefault: pm.id === (payment.metadata as any)?.defaultPaymentMethod,
        })),
      };
    } catch (error: any) {
      logger.error('Failed to get payment methods:', error);
      throw new Error(`Get payment methods error: ${error.message}`);
    }
  }

  static async healthCheck() {
    try {
      await prisma.$runCommandRaw({ ping: 1 });
      
      // Check Stripe connection
      let stripeStatus = 'connected';
      try {
        const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
          apiVersion: '2023-10-16',
        });
        await stripe.balance.retrieve();
      } catch (error) {
        stripeStatus = 'disconnected';
      }
      
      return {
        service: 'payment-service',
        status: 'active',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        database: 'connected',
        stripe: stripeStatus,
      };
    } catch (error) {
      return {
        service: 'payment-service',
        status: 'degraded',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        database: 'disconnected',
        stripe: 'unknown',
      };
    }
  }
}
```
```diff:app.ts
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { PaymentController } from './controllers/payment.controller';
import { StripeWebhook } from './webhooks/stripe.webhook';
import { authenticateToken, requireRole } from './middleware/auth.middleware';
import { verifyStripeWebhook } from './middleware/webhook.middleware';
import {
  validateCreatePaymentIntent,
  validateConfirmPayment,
  validateRefundPayment,
  validatePaymentId,
  handleValidationErrors,
} from './middleware/validation.middleware';
import logger from './utils/logger';

const app = express();
app.set('trust proxy', 1);

// Webhook endpoint needs raw body
app.post(
  '/api/payments/webhook',
  express.raw({ type: 'application/json' }),
  verifyStripeWebhook,
  StripeWebhook.handleWebhook
);

// Security middleware for other routes
app.use(helmet());

// CORS configuration
const corsOptions = {
  origin: process.env.CORS_ORIGIN?.split(',') || ['http://localhost:3000', 'http://localhost:5173'],
  credentials: true,
  optionsSuccessStatus: 200,
};
app.use(cors(corsOptions));

// Body parser for non-webhook routes
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Rate limiting
const limiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '900000'),
  max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || '100'),
  message: { error: 'Too many requests, please try again later.' },
});
app.use('/api/payments', limiter);

// Request logging
app.use((req, res, next) => {
  logger.debug(`${req.method} ${req.path}`);
  next();
});

// Health check
app.get('/api/payments/health', PaymentController.healthCheck);

// ==================== Payment Routes ====================

// Protected routes - require authentication
app.post(
  '/api/payments/intents',
  authenticateToken,
  validateCreatePaymentIntent,
  handleValidationErrors,
  PaymentController.createPaymentIntent
);

app.post(
  '/api/payments/create-intent',
  authenticateToken,
  validateCreatePaymentIntent,
  handleValidationErrors,
  PaymentController.createPaymentIntent
);

app.post(
  '/api/payments/confirm',
  authenticateToken,
  validateConfirmPayment,
  handleValidationErrors,
  PaymentController.confirmPayment
);

app.get(
  '/api/payments/me',
  authenticateToken,
  PaymentController.getUserPayments
);

app.get(
  '/api/payments/me/:paymentId',
  authenticateToken,
  validatePaymentId,
  handleValidationErrors,
  PaymentController.getPaymentById
);

app.post(
  '/api/payments/:paymentId/refund',
  authenticateToken,
  validateRefundPayment,
  handleValidationErrors,
  PaymentController.refundPayment
);

app.post(
  '/api/payments/:paymentId/cancel',
  authenticateToken,
  validatePaymentId,
  handleValidationErrors,
  PaymentController.cancelPayment
);

// Payment method management
app.post(
  '/api/payments/setup-intent',
  authenticateToken,
  PaymentController.createSetupIntent
);

app.post(
  '/api/payments/save-method',
  authenticateToken,
  PaymentController.savePaymentMethod
);

app.get(
  '/api/payments/methods',
  authenticateToken,
  PaymentController.getPaymentMethods
);

// Admin routes
app.get(
  '/api/payments/stats',
  authenticateToken,
  requireRole(['ADMIN']),
  PaymentController.getPaymentStats
);

app.get(
  '/api/payments/:paymentId',
  authenticateToken,
  requireRole(['ADMIN']),
  validatePaymentId,
  handleValidationErrors,
  PaymentController.getPaymentById
);

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

// Error handler
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  logger.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

export default app;
===
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { PaymentController } from './controllers/payment.controller';
import { StripeWebhook } from './webhooks/stripe.webhook';
import { authenticateToken, requireRole } from './middleware/auth.middleware';
import { verifyStripeWebhook } from './middleware/webhook.middleware';
import {
  validateCreatePaymentIntent,
  validateConfirmPayment,
  validateRefundPayment,
  validatePaymentId,
  handleValidationErrors,
} from './middleware/validation.middleware';
import logger from './utils/logger';

const app = express();
app.set('trust proxy', 1);

// Webhook endpoint needs raw body
app.post(
  '/api/payments/webhook',
  express.raw({ type: 'application/json' }),
  verifyStripeWebhook,
  StripeWebhook.handleWebhook
);

// Security middleware for other routes
app.use(helmet());

// CORS configuration
const corsOptions = {
  origin: process.env.CORS_ORIGIN?.split(',') || ['http://localhost:3000', 'http://localhost:5173'],
  credentials: true,
  optionsSuccessStatus: 200,
};
app.use(cors(corsOptions));

// Body parser for non-webhook routes
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Rate limiting
const limiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '900000'),
  max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || '100'),
  message: { error: 'Too many requests, please try again later.' },
});
app.use('/api/payments', limiter);

// Request logging
app.use((req, res, next) => {
  logger.debug(`${req.method} ${req.path}`);
  next();
});

// Health check
app.get('/api/payments/health', PaymentController.healthCheck);

// ==================== Payment Routes ====================

// Protected routes - require authentication
app.post(
  '/api/payments/intents',
  authenticateToken,
  validateCreatePaymentIntent,
  handleValidationErrors,
  PaymentController.createPaymentIntent
);

app.post(
  '/api/payments/create-intent',
  authenticateToken,
  validateCreatePaymentIntent,
  handleValidationErrors,
  PaymentController.createPaymentIntent
);

app.post(
  '/api/payments/confirm',
  authenticateToken,
  validateConfirmPayment,
  handleValidationErrors,
  PaymentController.confirmPayment
);

app.get(
  '/api/payments/me',
  authenticateToken,
  PaymentController.getUserPayments
);

// Get payment by orderId (must be before :paymentId routes)
app.get(
  '/api/payments/order/:orderId',
  authenticateToken,
  PaymentController.getPaymentByOrder
);

app.get(
  '/api/payments/me/:paymentId',
  authenticateToken,
  validatePaymentId,
  handleValidationErrors,
  PaymentController.getPaymentById
);

app.post(
  '/api/payments/:paymentId/refund',
  authenticateToken,
  validateRefundPayment,
  handleValidationErrors,
  PaymentController.refundPayment
);

app.post(
  '/api/payments/:paymentId/cancel',
  authenticateToken,
  validatePaymentId,
  handleValidationErrors,
  PaymentController.cancelPayment
);

// Payment method management
app.post(
  '/api/payments/setup-intent',
  authenticateToken,
  PaymentController.createSetupIntent
);

app.post(
  '/api/payments/save-method',
  authenticateToken,
  PaymentController.savePaymentMethod
);

app.get(
  '/api/payments/methods',
  authenticateToken,
  PaymentController.getPaymentMethods
);

// Admin routes
app.get(
  '/api/payments/stats',
  authenticateToken,
  requireRole(['ADMIN']),
  PaymentController.getPaymentStats
);

app.get(
  '/api/payments/:paymentId',
  authenticateToken,
  requireRole(['ADMIN']),
  validatePaymentId,
  handleValidationErrors,
  PaymentController.getPaymentById
);
// ==================== Internal Service-to-Service Routes ====================
// These routes are called by other microservices (no user auth required)

app.post(
  '/api/payments/internal/create-intent',
  validateCreatePaymentIntent,
  handleValidationErrors,
  PaymentController.createPaymentIntentInternal
);

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

// Error handler
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  logger.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

export default app;
```

### 3. Backend — Order Service (2 files)

| File | Thay đổi |
|------|----------|
| [order.service.ts](file:///d:/HK/HK8/Cong_nghe_moi/UMI-PROJECT/services/order-service/src/services/order.service.ts) | Refetch order with items trước khi return |
| [payment.client.ts](file:///d:/HK/HK8/Cong_nghe_moi/UMI-PROJECT/services/order-service/src/services/payment.client.ts) | Đổi endpoint sang `/internal/create-intent` |

```diff:payment.client.ts
import axios from 'axios';
import logger from '../utils/logger';

export interface CreatePaymentIntentRequest {
  orderId: string;
  orderNumber: string;
  userId: string;
  amount: number;
  currency: string;
  description: string;
}

export interface PaymentIntent {
  id: string;
  clientSecret: string;
  amount: number;
  currency: string;
  status: string;
}

export class PaymentClient {
  private static baseUrl = process.env.PAYMENT_SERVICE_URL || 'http://localhost:3005';

  static async createPaymentIntent(data: CreatePaymentIntentRequest): Promise<PaymentIntent> {
    try {
      const response = await axios.post(`${this.baseUrl}/api/payments/intents`, {
        orderId: data.orderId,
        orderNumber: data.orderNumber,
        userId: data.userId,
        amount: data.amount,
        currency: data.currency,
        description: data.description,
      });

      logger.info(`Payment intent created for order ${data.orderNumber}`);
      return response.data.data;
    } catch (error: any) {
      logger.error('Failed to create payment intent:', error.response?.data || error.message);
      throw new Error('Payment service unavailable');
    }
  }

  static async confirmPayment(paymentIntentId: string, paymentMethodId: string) {
    try {
      const response = await axios.post(`${this.baseUrl}/api/payments/confirm`, {
        paymentIntentId,
        paymentMethodId,
      });

      return response.data.data;
    } catch (error: any) {
      logger.error('Failed to confirm payment:', error.response?.data || error.message);
      throw new Error('Payment confirmation failed');
    }
  }

  static async getPaymentStatus(paymentIntentId: string) {
    try {
      const response = await axios.get(`${this.baseUrl}/api/payments/${paymentIntentId}`);
      return response.data.data;
    } catch (error: any) {
      logger.error('Failed to get payment status:', error.response?.data || error.message);
      throw new Error('Payment status check failed');
    }
  }

  static async refundPayment(paymentIntentId: string, amount?: number, reason?: string) {
    try {
      const response = await axios.post(`${this.baseUrl}/api/payments/${paymentIntentId}/refund`, {
        amount,
        reason,
      });
      return response.data.data;
    } catch (error: any) {
      logger.error('Failed to refund payment:', error.response?.data || error.message);
      throw new Error('Payment refund failed');
    }
  }
}
===
import axios from 'axios';
import logger from '../utils/logger';

export interface CreatePaymentIntentRequest {
  orderId: string;
  orderNumber: string;
  userId: string;
  amount: number;
  currency: string;
  description: string;
}

export interface PaymentIntent {
  id: string;
  clientSecret: string;
  amount: number;
  currency: string;
  status: string;
}

export class PaymentClient {
  private static baseUrl = process.env.PAYMENT_SERVICE_URL || 'http://localhost:3005';

  static async createPaymentIntent(data: CreatePaymentIntentRequest): Promise<PaymentIntent> {
    try {
      const response = await axios.post(`${this.baseUrl}/api/payments/internal/create-intent`, {
        orderId: data.orderId,
        orderNumber: data.orderNumber,
        userId: data.userId,
        amount: data.amount,
        currency: data.currency,
        description: data.description,
      });

      logger.info(`Payment intent created for order ${data.orderNumber}`);
      return response.data.data;
    } catch (error: any) {
      logger.error('Failed to create payment intent:', error.response?.data || error.message);
      throw new Error('Payment service unavailable');
    }
  }

  static async confirmPayment(paymentIntentId: string, paymentMethodId: string) {
    try {
      const response = await axios.post(`${this.baseUrl}/api/payments/confirm`, {
        paymentIntentId,
        paymentMethodId,
      });

      return response.data.data;
    } catch (error: any) {
      logger.error('Failed to confirm payment:', error.response?.data || error.message);
      throw new Error('Payment confirmation failed');
    }
  }

  static async getPaymentStatus(paymentIntentId: string) {
    try {
      const response = await axios.get(`${this.baseUrl}/api/payments/${paymentIntentId}`);
      return response.data.data;
    } catch (error: any) {
      logger.error('Failed to get payment status:', error.response?.data || error.message);
      throw new Error('Payment status check failed');
    }
  }

  static async refundPayment(paymentIntentId: string, amount?: number, reason?: string) {
    try {
      const response = await axios.post(`${this.baseUrl}/api/payments/${paymentIntentId}/refund`, {
        amount,
        reason,
      });
      return response.data.data;
    } catch (error: any) {
      logger.error('Failed to refund payment:', error.response?.data || error.message);
      throw new Error('Payment refund failed');
    }
  }
}
```

### 4. Frontend (5 files)

| File | Thay đổi |
|------|----------|
| [order.service.ts](file:///d:/HK/HK8/Cong_nghe_moi/UMI-PROJECT/frontend/src/services/order.service.ts) | Thêm `CreateOrderResponse` type, sửa `createOrder` return type |
| [payment.service.ts](file:///d:/HK/HK8/Cong_nghe_moi/UMI-PROJECT/frontend/src/services/payment.service.ts) | Thêm `getPaymentByOrder()` method |
| [Cart.tsx](file:///d:/HK/HK8/Cong_nghe_moi/UMI-PROJECT/frontend/src/pages/Cart.tsx) | Đọc `result.order.id` từ response mới |
| [Checkout.tsx](file:///d:/HK/HK8/Cong_nghe_moi/UMI-PROJECT/frontend/src/pages/Checkout.tsx) | **Viết lại hoàn toàn**: Lấy clientSecret từ backend, truyền cho StripePaymentForm, thêm thông tin test card |
| [StripePaymentForm.tsx](file:///d:/HK/HK8/Cong_nghe_moi/UMI-PROJECT/frontend/src/components/payment/StripePaymentForm.tsx) | **Viết lại hoàn toàn**: Nhận clientSecret từ prop, không tạo intent mới, error handling tốt hơn |

```diff:Cart.tsx
import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSelector, useDispatch } from 'react-redux';
import { AppDispatch, RootState } from '../store';
import { orderService } from '../services/order.service';
import { CartItem } from '../components/order/CartItem';
import { CheckoutForm } from '../components/order/CheckoutForm';
import { useAuth } from '../hooks/useAuth';
import toast from 'react-hot-toast';
import { FiShoppingBag, FiArrowLeft } from 'react-icons/fi';
import { fetchCart, removeFromCart } from '../store/cartSlice';

export default function Cart() {
  const navigate = useNavigate();
  const dispatch = useDispatch<AppDispatch>();
  const { isAuthenticated } = useAuth();
  const { items, totalPrice, loading: cartLoading } = useSelector((state: RootState) => state.cart);
  
  const [checkoutLoading, setCheckoutLoading] = useState(false);
  const [showCheckout, setShowCheckout] = useState(false);

  useEffect(() => {
    if (!isAuthenticated) {
      navigate('/login');
      return;
    }
    dispatch(fetchCart());
  }, [isAuthenticated, navigate, dispatch]);

  const handleRemoveFromCart = async (courseId: string) => {
    try {
      await dispatch(removeFromCart(courseId)).unwrap();
    } catch (error) {
      toast.error('Xóa mục thất bại');
    }
  };

  const handleCheckout = async (notes: string) => {
    if (items.length === 0) {
      toast.error('Giỏ hàng của bạn đang trống');
      return;
    }

    setCheckoutLoading(true);
    try {
      const order = await orderService.createOrder({
        items: items.map(item => ({
          courseId: item.courseId,
          courseTitle: item.title,
          price: item.price,
        })),
        notes,
      });
      toast.success('Đặt hàng thành công!');
      navigate(`/orders/${order.id}`);
    } catch (error: any) {
      toast.error(error.response?.data?.error || 'Không thể tạo đơn hàng');
    } finally {
      setCheckoutLoading(false);
    }
  };

  if (cartLoading && items.length === 0) {
    return (
      <div className="flex justify-center items-center min-h-[400px]">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600"></div>
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="max-w-4xl mx-auto px-4 py-16 text-center">
        <FiShoppingBag className="mx-auto text-6xl text-gray-400 mb-4" />
        <h2 className="text-2xl font-bold text-gray-900 mb-2">Giỏ hàng rỗng</h2>
        <p className="text-gray-600 mb-6">Có vẻ như bạn chưa thêm khóa học nào vào giỏ hàng.</p>
        <button
          onClick={() => navigate('/courses')}
          className="btn-primary inline-flex items-center space-x-2"
        >
          <FiArrowLeft />
          <span>Khám phá khóa học</span>
        </button>
      </div>
    );
  }

  if (showCheckout) {
    return (
      <div className="max-w-6xl mx-auto px-4 py-8">
        <button
          onClick={() => setShowCheckout(false)}
          className="mb-4 text-gray-600 hover:text-gray-800 flex items-center space-x-1"
        >
          <FiArrowLeft />
          <span>Quay lại Giỏ hàng</span>
        </button>
        <CheckoutForm
          items={items}
          totalPrice={totalPrice}
          onSubmit={handleCheckout}
          isLoading={checkoutLoading}
        />
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto px-4 py-8">
      <h1 className="text-3xl font-bold text-gray-900 mb-8">Giỏ hàng</h1>

      <div className="grid md:grid-cols-3 gap-8">
        {/* Cart Items */}
        <div className="md:col-span-2">
          <div className="card">
            <div className="space-y-2">
              {items.map((item) => (
                <CartItem
                  key={item.courseId}
                  item={item}
                  onRemove={handleRemoveFromCart}
                />
              ))}
            </div>
          </div>
        </div>

        {/* Order Summary */}
        <div>
          <div className="card sticky top-24">
            <h2 className="text-xl font-semibold mb-4">Tóm tắt đơn hàng</h2>
            <div className="space-y-3 mb-4">
              <div className="flex justify-between">
                <span className="text-gray-600">Tạm tính</span>
                <span>${totalPrice.toFixed(2)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-600">Giảm giá</span>
                <span className="text-green-600">$0.00</span>
              </div>
              <div className="flex justify-between font-bold text-lg pt-3 border-t">
                <span>Tổng cộng</span>
                <span className="text-primary-600">${totalPrice.toFixed(2)}</span>
              </div>
            </div>
            <button
              onClick={() => setShowCheckout(true)}
              className="w-full btn-primary"
            >
              Tiến hành thanh toán
            </button>
            <button
              onClick={() => navigate('/courses')}
              className="w-full mt-3 btn-secondary"
            >
              Tiếp tục mua sắm
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
===
import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSelector, useDispatch } from 'react-redux';
import { AppDispatch, RootState } from '../store';
import { orderService } from '../services/order.service';
import { CartItem } from '../components/order/CartItem';
import { CheckoutForm } from '../components/order/CheckoutForm';
import { useAuth } from '../hooks/useAuth';
import toast from 'react-hot-toast';
import { FiShoppingBag, FiArrowLeft } from 'react-icons/fi';
import { fetchCart, removeFromCart } from '../store/cartSlice';

export default function Cart() {
  const navigate = useNavigate();
  const dispatch = useDispatch<AppDispatch>();
  const { isAuthenticated } = useAuth();
  const { items, totalPrice, loading: cartLoading } = useSelector((state: RootState) => state.cart);
  
  const [checkoutLoading, setCheckoutLoading] = useState(false);
  const [showCheckout, setShowCheckout] = useState(false);

  useEffect(() => {
    if (!isAuthenticated) {
      navigate('/login');
      return;
    }
    dispatch(fetchCart());
  }, [isAuthenticated, navigate, dispatch]);

  const handleRemoveFromCart = async (courseId: string) => {
    try {
      await dispatch(removeFromCart(courseId)).unwrap();
    } catch (error) {
      toast.error('Xóa mục thất bại');
    }
  };

  const handleCheckout = async (notes: string) => {
    if (items.length === 0) {
      toast.error('Giỏ hàng của bạn đang trống');
      return;
    }

    setCheckoutLoading(true);
    try {
      const result = await orderService.createOrder({
        items: items.map(item => ({
          courseId: item.courseId,
          courseTitle: item.title,
          price: item.price,
        })),
        notes,
      });
      toast.success('Tạo đơn hàng thành công! Đang chuyển đến thanh toán...');
      navigate(`/checkout/${result.order.id}`);
    } catch (error: any) {
      toast.error(error.response?.data?.error || 'Không thể tạo đơn hàng');
    } finally {
      setCheckoutLoading(false);
    }
  };

  if (cartLoading && items.length === 0) {
    return (
      <div className="flex justify-center items-center min-h-[400px]">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600"></div>
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="max-w-4xl mx-auto px-4 py-16 text-center">
        <FiShoppingBag className="mx-auto text-6xl text-gray-400 mb-4" />
        <h2 className="text-2xl font-bold text-gray-900 mb-2">Giỏ hàng rỗng</h2>
        <p className="text-gray-600 mb-6">Có vẻ như bạn chưa thêm khóa học nào vào giỏ hàng.</p>
        <button
          onClick={() => navigate('/courses')}
          className="btn-primary inline-flex items-center space-x-2"
        >
          <FiArrowLeft />
          <span>Khám phá khóa học</span>
        </button>
      </div>
    );
  }

  if (showCheckout) {
    return (
      <div className="max-w-6xl mx-auto px-4 py-8">
        <button
          onClick={() => setShowCheckout(false)}
          className="mb-4 text-gray-600 hover:text-gray-800 flex items-center space-x-1"
        >
          <FiArrowLeft />
          <span>Quay lại Giỏ hàng</span>
        </button>
        <CheckoutForm
          items={items}
          totalPrice={totalPrice}
          onSubmit={handleCheckout}
          isLoading={checkoutLoading}
        />
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto px-4 py-8">
      <h1 className="text-3xl font-bold text-gray-900 mb-8">Giỏ hàng</h1>

      <div className="grid md:grid-cols-3 gap-8">
        {/* Cart Items */}
        <div className="md:col-span-2">
          <div className="card">
            <div className="space-y-2">
              {items.map((item) => (
                <CartItem
                  key={item.courseId}
                  item={item}
                  onRemove={handleRemoveFromCart}
                />
              ))}
            </div>
          </div>
        </div>

        {/* Order Summary */}
        <div>
          <div className="card sticky top-24">
            <h2 className="text-xl font-semibold mb-4">Tóm tắt đơn hàng</h2>
            <div className="space-y-3 mb-4">
              <div className="flex justify-between">
                <span className="text-gray-600">Tạm tính</span>
                <span>${totalPrice.toFixed(2)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-600">Giảm giá</span>
                <span className="text-green-600">$0.00</span>
              </div>
              <div className="flex justify-between font-bold text-lg pt-3 border-t">
                <span>Tổng cộng</span>
                <span className="text-primary-600">${totalPrice.toFixed(2)}</span>
              </div>
            </div>
            <button
              onClick={() => setShowCheckout(true)}
              className="w-full btn-primary"
            >
              Tiến hành thanh toán
            </button>
            <button
              onClick={() => navigate('/courses')}
              className="w-full mt-3 btn-secondary"
            >
              Tiếp tục mua sắm
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
```

## Hướng dẫn test

1. **Build lại Docker containers** (nếu dùng Docker):
   ```bash
   docker-compose down
   docker-compose up --build
   ```

2. **Hoặc chạy riêng từng service** (development):
   ```bash
   # Terminal 1: payment-service
   cd services/payment-service && npm run dev
   
   # Terminal 2: order-service  
   cd services/order-service && npm run dev
   
   # Terminal 3: frontend
   cd frontend && npm run dev
   ```

3. **Test thanh toán**:
   - Đăng nhập → Thêm khóa học vào giỏ hàng
   - Cart → Tiến hành thanh toán → Xác nhận đơn hàng
   - Trang Checkout hiện form Stripe
   - Dùng thẻ test: `4242 4242 4242 4242`, hạn `12/34`, CVC `123`
   - Thanh toán thành công → Chuyển sang trang chi tiết đơn hàng
