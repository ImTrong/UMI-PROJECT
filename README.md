# E-Learning Platform - Microservices Architecture

A production-ready, high-concurrency (C10K-ready) microservices-based e-learning platform designed as an academic project for "Advanced Technologies in IT Application Development" course, intended to evolve into a Graduation Thesis.

## 🏗️ Architecture Overview

This project implements a **pure microservices architecture** with the following principles:

### Core Design Patterns

- **Share-Nothing Architecture**: Each service is completely independent and stateless
- **Database-per-Service Pattern**: Each microservice has its own logical MongoDB database on a shared MongoDB container
- **API Gateway Pattern**: Nginx acts as a reverse proxy and API gateway (Port 8080)
- **Service Discovery**: Services communicate via HTTP REST through Nginx
- **Horizontal Scalability**: All services are stateless and can be scaled independently
- **C10K Ready**: Designed to handle 10,000+ concurrent connections

### Technology Stack

| Layer | Technology |
|-------|-----------|
| **Frontend** | React 18 + Vite + Tailwind CSS |
| **Admin Frontend** | React + Vite |
| **API Gateway** | Nginx (Reverse Proxy) |
| **Backend** | Node.js 18 + Express + TypeScript |
| **ORM** | Prisma |
| **Database** | MongoDB (Shared container, separate logical DBs, Replica Set enabled) |
| **Storage** | MinIO (S3-compatible Object Storage) |
| **Containerization** | Docker & Docker Compose |
| **Payment Integration** | Stripe (Sandbox stub) |

---

## 📁 Project Structure

```
UMI-PROJECT/
├── docker-compose.yml              # Orchestrate all services
├── nginx/
│   └── nginx.conf                  # API Gateway configuration
├── scripts/                        # Utility scripts
├── services/
│   ├── auth-service/               # Authentication (Port 3001)
│   ├── user-service/               # User profiles (Port 3002)
│   ├── course-service/             # Course management (Port 3003)
│   ├── order-service/              # Order & cart (Port 3004)
│   ├── payment-service/            # Payment processing (Port 3005)
│   └── learning-service/           # Progress & certificates (Port 3006)
├── shared/                          # Shared libraries and types
├── frontend/                        # React + Vite frontend (Port 3000)
├── admin-frontend/                  # React admin frontend (Port 4000)
└── README.md                        # This file
```

---

## 🚀 Quick Start

### Prerequisites

- Docker & Docker Compose
- Node.js 18+ (for local development)
- npm or pnpm

### Option 1: Docker Compose (Recommended)

```bash
# Clone the repository
cd UMI-PROJECT

# Start all services
docker-compose up -d

# Check service status
docker-compose ps

# View logs
docker-compose logs -f

# Access the frontend
# Open browser: http://localhost:3000

# API Gateway
# Base URL: http://localhost:8080
```

### Option 2: Local Development

#### 1. Start Infrastructure (MongoDB & MinIO)

```bash
# It is strongly recommended to use docker-compose for infrastructure 
# as MongoDB requires replica set initialization for Prisma transactions,
# and MinIO needs bucket initialization.
docker-compose up -d mongodb minio minio-init
```

#### 2. Start Each Service

```bash
# Terminal 1: Auth Service
cd services/auth-service
npm install
npm run dev    # Runs on localhost:3001

# Terminal 2: User Service
cd services/user-service
npm install
npm run dev    # Runs on localhost:3002

# Terminal 3: Course Service
cd services/course-service
npm install
npm run dev    # Runs on localhost:3003

# Terminal 4: Order Service
cd services/order-service
npm install
npm run dev    # Runs on localhost:3004

# Terminal 5: Payment Service
cd services/payment-service
npm install
npm run dev    # Runs on localhost:3005

# Terminal 6: Learning Service
cd services/learning-service
npm install
npm run dev    # Runs on localhost:3006

# Terminal 7: Frontend
cd frontend
npm install
npm run dev    # Runs on localhost:3000

# Terminal 8: Admin Frontend
cd admin-frontend
npm install
npm run dev    # Runs on localhost:4000
```

---

## 🎯 Microservices

### 1. **Auth Service** (Port 3001)
Database: `auth_db`

Handles user authentication, JWT token issuance, and token verification.

**Key Endpoints:**
```
POST   /api/auth/register          # Register new user
POST   /api/auth/login             # Login user
POST   /api/auth/verify-token      # Verify JWT token
POST   /api/auth/refresh-token     # Refresh JWT token
POST   /api/auth/logout            # Logout user
GET    /api/auth/health            # Health check
```

**Models:**
- User (email, password, fullName, emailVerified, lastLogin)
- RefreshToken (token, userId, expiresAt)
- LoginAttempt (email, success, ipAddress, userAgent)

---

### 2. **User Service** (Port 3002)
Database: `user_db`

Manages user profiles, bios, education background, and work experience.

**Key Endpoints:**
```
GET    /api/users                  # Get all users (paginated)
POST   /api/users                  # Create user profile
GET    /api/users/:userId          # Get user by ID
PUT    /api/users/:userId          # Update user profile
DELETE /api/users/:userId          # Delete user
GET    /api/users/health           # Health check
```

**Models:**
- UserProfile (email, fullName, bio, role, badges, preferences)
- EducationBackground (institution, degree, fieldOfStudy)
- WorkExperience (company, position, startDate, endDate)

---

### 3. **Course Service** (Port 3003)
Database: `course_db`

Manages course catalog, course details, lessons, and reviews.

**Key Endpoints:**
```
GET    /api/courses                # Get all courses (paginated)
POST   /api/courses                # Create course
GET    /api/courses/:courseId      # Get course details
PUT    /api/courses/:courseId      # Update course
DELETE /api/courses/:courseId      # Delete course
GET    /api/courses/health         # Health check
```

**Models:**
- Course (title, description, instructor, price, rating, enrolledCount)
- Lesson (courseId, title, videoUrl, duration, resources)
- Review (courseId, userId, rating, comment)
- Category (name, slug, description)

---

### 4. **Order Service** (Port 3004)
Database: `order_db`

Manages shopping carts and course orders.

**Key Endpoints:**
```
GET    /api/orders                 # Get all orders
POST   /api/orders                 # Create order
GET    /api/orders/:orderId        # Get order details
PATCH  /api/orders/:orderId/status # Update order status
GET    /api/orders/health          # Health check
```

**Models:**
- Order (userId, courseIds, totalPrice, status, paymentStatus)
- Cart (userId, courseIds, totalPrice)
- OrderItem (orderId, courseId, price, discount)

---

### 5. **Payment Service** (Port 3005)
Database: `payment_db`

Handles payment processing and refunds (Stripe integration - STUB).

**Key Endpoints:**
```
POST   /api/payments/intents       # Create payment intent
POST   /api/payments/confirm       # Confirm payment
GET    /api/payments/:paymentId    # Get payment details
POST   /api/payments/:paymentId/refund # Process refund
GET    /api/payments/health        # Health check
```

**Models:**
- Payment (orderId, userId, amount, currency, status, stripePaymentIntentId)
- Refund (paymentId, orderId, amount, reason, status)
- StripeEvent (stripeEventId, type, data, processed)

---

### 6. **Learning Service** (Port 3006)
Database: `learning_db`

Tracks user learning progress, badges, and certificate generation.

**Key Endpoints:**
```
GET    /api/learning/progress/:userId                  # Get user progress
GET    /api/learning/progress/:userId/:courseId        # Get course progress
POST   /api/learning/progress/:userId/:courseId/:lessonId/complete # Mark lesson complete
POST   /api/learning/certificates/:userId/:courseId    # Generate certificate
GET    /api/learning/certificates/:userId              # Get user certificates
POST   /api/learning/activity/:userId                  # Track activity
GET    /api/learning/health                            # Health check
```

**Models:**
- UserProgress (userId, coursesEnrolled, coursesCompleted, streakDays)
- CourseProgress (userId, courseId, progressPercentage, timeSpentSeconds)
- LessonProgress (userId, courseId, lessonId, completed, timeSpentSeconds)
- Certificate (userId, courseId, certificateUrl, issuedAt, expiresAt)
- Badge (userId, badgeName, awardedAt)
- ActivityLog (userId, courseId, lessonId, action, durationSeconds)

---

## 🔌 API Gateway (Nginx)

The Nginx API Gateway routes requests to backend services and handles:

- **Reverse Proxy**: Routes `/api/auth/*` → auth-service:3001, etc.
- **Rate Limiting**: Limits auth requests (10 req/s), general requests (100 req/s)
- **Load Balancing**: Upstream configuration with health checks
- **Compression**: Gzip compression for responses
- **CORS**: Configurable CORS headers
- **Security**: Keepalive connections, timeouts, body size limits

### Rate Limiting Configuration

```nginx
limit_req_zone $binary_remote_addr zone=auth:10m rate=10r/s;
limit_req_zone $binary_remote_addr zone=general:10m rate=100r/s;
```

---

## 📊 Database Strategy: Database-per-Service

### Architecture

```
┌─────────────────────────────────────────────────────┐
│              MongoDB Container                      │
├─────────────────────────────────────────────────────┤
│                                                     │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────┐ │
│  │  auth_db     │  │  user_db     │  │course_db │ │
│  │              │  │              │  │          │ │
│  │ - User       │  │ - UserProfile│  │- Course  │ │
│  │ - RefreshBtn │  │ - Education  │  │- Lesson  │ │
│  │ - LoginAtmpt │  │ - WorkExp    │  │- Review  │ │
│  └──────────────┘  └──────────────┘  └──────────┘ │
│                                                     │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────┐ │
│  │  order_db    │  │ payment_db   │  │learning_ │ │
│  │              │  │              │  │ db       │ │
│  │ - Order      │  │ - Payment    │  │- Progress│ │
│  │ - Cart       │  │ - Refund     │  │- Cert    │ │
│  │ - OrderItem  │  │ - StripeEvent│  │- Badge   │ │
│  └──────────────┘  └──────────────┘  └──────────┘ │
│                                                     │
└─────────────────────────────────────────────────────┘
```

### Benefits

1. **Data Isolation**: Each service owns its data schema
2. **Independent Scaling**: Services can scale DB independently
3. **Technology Flexibility**: Easy to swap databases per service
4. **Team Autonomy**: Each team controls their own data
5. **Resource Efficiency**: Single MongoDB container for development

### Service-to-Db Mapping

| Service | Database | Connection String |
|---------|----------|-------------------|
| auth | auth_db | mongodb://admin:password@mongo:27017/auth_db?authSource=admin |
| user | user_db | mongodb://admin:password@mongo:27017/user_db?authSource=admin |
| course | course_db | mongodb://admin:password@mongo:27017/course_db?authSource=admin |
| order | order_db | mongodb://admin:password@mongo:27017/order_db?authSource=admin |
| payment | payment_db | mongodb://admin:password@mongo:27017/payment_db?authSource=admin |
| learning | learning_db | mongodb://admin:password@mongo:27017/learning_db?authSource=admin |

---

## 🎨 Frontend Applications

### 1. Main Frontend (Port 3000)
The React frontend for students provides:
1. **Course Browsing & Enrollment**: Explore and purchase courses
2. **Learning Progress**: Track learning activities
3. **User Profile**: Manage account settings

**Access**: http://localhost:3000

### 2. Admin Frontend (Port 4000)
The React frontend for administrators provides:
1. **Real-time Service Health Monitoring**: Displays status of all 6 microservices
2. **System Architecture**: Visual explanation of the system
3. **Data Management**: Manage users, courses, and orders (WIP)

**Access**: http://localhost:4000

---

## 🔍 Health Checks

All services expose `/health` endpoints:

```bash
# Auth Service
curl http://localhost:3001/api/auth/health

# User Service
curl http://localhost:3002/api/users/health

# Course Service
curl http://localhost:3003/api/courses/health

# Order Service
curl http://localhost:3004/api/orders/health

# Payment Service
curl http://localhost:3005/api/payments/health

# Learning Service
curl http://localhost:3006/api/learning/health

# Nginx Gateway
curl http://localhost:8080/health
```

Response Format:
```json
{
  "service": "auth-service",
  "status": "active",
  "timestamp": "2024-02-06T12:00:00.000Z",
  "uptime": 3600,
  "database": "connected"
}
```

---

## 📦 Docker Compose Services

### MongoDB
- **Image**: mongo:7.0-jammy
- **Port**: 27017 (internal), exposed to host
- **Credentials**: admin / securepassword123
- **Configuration**: Replica Set (`rs0`) initialized for Prisma transactions
- **Volume**: mongo-data (persistent)

### MinIO (Object Storage)
- **Image**: minio/minio:latest
- **Ports**: 9000 (API), 9001 (Console)
- **Credentials**: minioadmin / minioadmin123
- **Buckets**: assignments, quiz-attachments, courses (public)
- **Volume**: minio-data (persistent)

### Nginx Gateway
- **Image**: nginx:alpine
- **Port**: 8080 (exposed to host)
- **Routes**: All `/api/*` requests to microservices

### Backend Services
- **Image**: Built from `./services/{service-name}/Dockerfile`
- **Node**: 18-alpine (multi-stage build)
- **Health Checks**: HTTP GET `/{service_path}/health`

### Frontend Apps
- **Main Frontend**: Built from `./frontend/Dockerfile` (Port 3000)
- **Admin Frontend**: Built from `./admin-frontend/Dockerfile` (Port 4000)
- **Framework**: React + Vite

---

## 🛠️ Development Workflow

### Adding a New Service

1. **Create service directory**:
   ```bash
   mkdir services/new-service
   ```

2. **Copy template files** from existing service:
   - package.json
   - tsconfig.json
   - Dockerfile
   - src/ directory structure

3. **Update docker-compose.yml**:
   ```yaml
   new-service:
     build:
       context: ./services/new-service
       dockerfile: Dockerfile
     container_name: elearning-new-service
     ports:
       - "300X:300X"
     environment:
       DATABASE_URL: "mongodb://admin:password@mongodb:27017/new_db?authSource=admin"
       AUTH_SERVICE_URL: "http://auth-service:3001"
     depends_on:
       mongodb:
         condition: service_healthy
     networks:
       - elearning-network
   ```

4. **Add Nginx routing**:
   ```nginx
   location /api/new-endpoint/ {
       proxy_pass http://new-service:300X;
       # ... proxy configuration
   }
   ```

5. **Initialize Prisma**:
   ```bash
   cd services/new-service
   npm run prisma:generate
   ```

---

## 📈 Scaling Considerations

### Horizontal Scaling

All services are stateless and can be scaled using Docker Compose:

```yaml
# Scale course-service to 3 instances
course-service:
  deploy:
    replicas: 3
```

Then use Nginx load balancing:

```nginx
upstream course_service {
  server course-service:3003;
  server course-service-2:3003;
  server course-service-3:3003;
}
```

### Performance Tuning

1. **Nginx Worker Connections**: Configured for 10,000 concurrent connections
2. **Keepalive Connections**: Enabled between Nginx and backend services
3. **Connection Pooling**: MongoDB connection pooling via Prisma
4. **Request Timeouts**: Configured per service (60s connect, 60s send/read)

---

## 🔐 Security Considerations

### Current Implementation (Development)

- CORS: Accepts all origins in development
- Auth: JWT tokens (STUB implementation)
- Database: MongoDB authentication enabled
- HTTPS: Ready for production (configure in nginx.conf)

### Production Hardening

1. **Update CORS origins** in docker-compose.yml
2. **Enable SSL/TLS** in nginx.conf
3. **Implement actual JWT verification** in services
4. **Use environment-specific secrets** (don't hardcode)
5. **Add rate limiting** per IP/user
6. **Implement API key authentication** for inter-service communication
7. **Use MongoDB replica sets** for high availability
8. **Add request validation** middleware

---

## 📝 Service Implementation Notes

### STUB Implementation

All services currently return mock/stub data to demonstrate:
- HTTP 200 responses
- Proper JSON formatting
- API contract structure
- Service-to-service routing through Nginx

**In production, replace STUB responses with actual:**
- Database operations (Prisma queries)
- Business logic
- External API calls
- Error handling

### Example: Converting Stub to Real Auth Service

```typescript
// STUB: Current
export const login = async (req: Request, res: Response) => {
  const token = `token_${Date.now()}`;
  res.status(200).json({ token, expiresIn: '7d' });
};

// REAL: Production
export const login = async (req: Request, res: Response) => {
  const { email, password } = req.body;

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user || !await bcrypt.compare(password, user.password)) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: '7d' });
  res.status(200).json({ token, expiresIn: '7d' });
};
```

---

## 📚 Technologies Deep Dive

### Prisma ORM

```
services/*/prisma/schema.prisma    # Data model definitions
services/*/src/app.ts              # Using PrismaClient
```

Benefits:
- Type-safe database access
- Automatic migrations
- Intuitive API
- Built-in validation

### TypeScript

- **Strict Mode**: Enabled in all services
- **Target**: ES2020
- **Module**: CommonJS (for Node.js)
- **Source Maps**: Enabled for debugging

### Express.js

- **Middleware**: CORS, JSON body parser, error handler
- **Routes**: Modular route definitions
- **Controllers**: STUB implementations
- **Error Handling**: Centralized error handler

---

## 🐛 Troubleshooting

### Services not connecting to MongoDB

```bash
# Check MongoDB is running
docker-compose logs mongodb

# Verify connection string in service logs
docker-compose logs auth-service

# Test connection directly
docker-compose exec mongodb mongosh -u admin -p secretpassword123
```

### Nginx gateway not routing requests

```bash
# Check Nginx configuration
docker-compose exec nginx-gateway cat /etc/nginx/nginx.conf

# Check upstream health
docker-compose exec nginx-gateway curl http://auth-service:3001/health
```

### Port conflicts

```bash
# List all exposed ports
docker-compose ps

# Change ports in docker-compose.yml and rebuild
docker-compose down
docker-compose up -d
```

---

## 📖 Documentation Structure

For Graduation Thesis, structure your dissertation as:

1. **Introduction**
   - Problem statement
   - Motivation for microservices
   - C10K challenge

2. **Architecture Design**
   - System design philosophy
   - Service decomposition strategy
   - API Gateway pattern
   - Database-per-service rationale

3. **Implementation**
   - Technology stack justification
   - Service development patterns
   - Docker containerization
   - Orchestration with Docker Compose

4. **Performance Evaluation**
   - Load testing (Apache Bench, hey, vegeta)
   - Concurrent connection handling
   - Service scalability metrics
   - Latency analysis

5. **Lessons Learned**
   - Challenges encountered
   - Trade-offs made
   - Production readiness gaps
   - Future improvements

---

## 🎓 Course Integration

This project maps to "Advanced Technologies in IT Application Development" by covering:

- **Cloud-native architecture**: Microservices, Docker, containerization
- **Modern backend**: Node.js, TypeScript, Express
- **Database design**: MongoDB, Prisma ORM
- **API gateway patterns**: Nginx, routing, load balancing
- **DevOps practices**: Docker Compose, health checks
- **Frontend frameworks**: React, Vite, Tailwind CSS
- **System design**: Scalability, performance, reliability

---

## 📄 License

Academic project - adjust as needed for your institution.

---

## 🤝 Contributing

For thesis development:

1. Fork or clone this repository
2. Create feature branches for each service
3. Test locally with `docker-compose up`
4. Document changes and architectural decisions
5. Include test coverage in production implementation

---

## 📞 Support

For issues or questions:
- Check the troubleshooting section
- Review Docker logs: `docker-compose logs [service-name]`
- Verify all services are healthy: `http://localhost:3000` (dashboard)

---

**Built with ❤️ for Advanced Technologies in IT Application Development**

**Last Updated**: February 2025
