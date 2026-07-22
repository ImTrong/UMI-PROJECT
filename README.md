# UMI - E-Learning Platform (Microservices Architecture)

Nền tảng e-learning sử dụng kiến trúc **microservices**, được phát triển cho môn học "Công nghệ mới trong ứng dụng phát triển CNTT" và hướng tới Khóa luận Tốt nghiệp.

## 🏗️ Architecture Overview

### Core Design Patterns

- **Share-Nothing Architecture**: Mỗi service hoàn toàn độc lập và stateless
- **Database-per-Service Pattern**: Mỗi microservice có database logic riêng trên shared MongoDB container
- **API Gateway Pattern**: Nginx hoạt động như reverse proxy và API gateway (Port 8080)
- **Service Discovery**: Giao tiếp qua HTTP REST thông qua Nginx
- **Real-time Communication**: WebSocket (Socket.io) cho chat và notifications
- **AI Integration**: Google Gemini AI cho chatbot và learning insights
- **Horizontal Scalability**: Tất cả services đều stateless, có thể scale độc lập
- **C10K Ready**: Thiết kế xử lý 10,000+ kết nối đồng thời

### Technology Stack

| Layer | Technology |
|-------|-----------|
| **Frontend** | React 18 + Vite + TypeScript + Tailwind CSS |
| **Admin Frontend** | React 18 + Vite + TypeScript + Tailwind CSS |
| **API Gateway** | Nginx (Reverse Proxy + Load Balancing) |
| **Backend** | Node.js 18 + Express.js + TypeScript |
| **ORM** | Prisma |
| **Database** | MongoDB 7.0 (Shared container, separate logical DBs, Replica Set `rs0`) |
| **Object Storage** | MinIO (S3-compatible) |
| **Payment** | Stripe (Real integration - PaymentIntents, Webhooks, Refunds) |
| **AI** | Google Gemini (`gemini-3.1-flash-lite`) |
| **Real-time** | Socket.io (WebSocket) |
| **Video Streaming** | HLS (HTTP Live Streaming) with AES-128 encryption |
| **Containerization** | Docker & Docker Compose |
| **Version Control** | Git |

---

## 📁 Project Structure

```
UMI-PROJECT/
├── docker-compose.yml              # Orchestrate tất cả services (12 containers)
├── .env                             # Environment variables (GEMINI_API_KEY)
├── nginx/
│   ├── nginx.conf                   # API Gateway configuration
│   ├── conf.d/                      # Additional Nginx config
│   └── ssl/                         # SSL certificates (optional)
├── services/
│   ├── auth-service/                # Authentication & Authorization (Port 3001)
│   ├── user-service/                # User profiles, Chat, Notifications (Port 3002)
│   ├── course-service/              # Course management, Lessons, Reviews (Port 3003)
│   ├── order-service/               # Orders & Cart (Port 3004)
│   ├── payment-service/             # Stripe Payment processing (Port 3005)
│   ├── learning-service/            # Progress, Quizzes, Assignments, HLS Video (Port 3006)
│   └── ai-service/                  # AI Chatbot & Learning Insights (Port 3007)
├── shared/
│   └── file-storage/                # Shared MinIO file storage utilities
├── scripts/                         # Utility scripts (SSL, setup, optimization)
├── frontend/                        # React + Vite student frontend (Port 3000)
├── admin-frontend/                  # React + Vite admin frontend (Port 4000)
└── README.md
```

---

## 🚀 Quick Start

### Prerequisites

- Docker & Docker Compose
- Node.js 18+ (for local development)
- npm

### Option 1: Docker Compose (Recommended)

```bash
cd UMI-PROJECT

# Create .env file with your Gemini API key
echo "GEMINI_API_KEY=your-gemini-api-key" > .env

# Start all services
docker-compose up -d

# Check service status
docker-compose ps

# View logs
docker-compose logs -f

# Access the platform
# Frontend:   http://localhost:3000
# Admin:      http://localhost:4000
# API Gateway: http://localhost:8080
# MinIO Console: http://localhost:9001
```

### Option 2: Local Development

#### 1. Start Infrastructure (MongoDB & MinIO)

```bash
# MongoDB requires replica set initialization for Prisma transactions
# MinIO needs bucket initialization
docker-compose up -d mongodb minio minio-init
```

#### 2. Start Each Service

```bash
# Terminal 1: Auth Service
cd services/auth-service && npm install && npm run dev    # Port 3001

# Terminal 2: User Service
cd services/user-service && npm install && npm run dev    # Port 3002

# Terminal 3: Course Service
cd services/course-service && npm install && npm run dev  # Port 3003

# Terminal 4: Order Service
cd services/order-service && npm install && npm run dev   # Port 3004

# Terminal 5: Payment Service
cd services/payment-service && npm install && npm run dev # Port 3005

# Terminal 6: Learning Service
cd services/learning-service && npm install && npm run dev # Port 3006

# Terminal 7: AI Service
cd services/ai-service && npm install && npm run dev      # Port 3007

# Terminal 8: Frontend
cd frontend && npm install && npm run dev                 # Port 3000

# Terminal 9: Admin Frontend
cd admin-frontend && npm install && npm run dev           # Port 4000
```

---

## 🎯 Microservices

### 1. Auth Service (Port 3001) — Database: `auth_db`

Xác thực người dùng, JWT token management, device sessions, và password recovery.

**Key Endpoints:**
```
POST   /api/auth/register           # Đăng ký tài khoản mới
POST   /api/auth/login              # Đăng nhập
POST   /api/auth/verify-token       # Xác thực JWT token
POST   /api/auth/refresh-token      # Làm mới JWT token
POST   /api/auth/logout             # Đăng xuất
POST   /api/auth/change-password    # Đổi mật khẩu (auth required)
POST   /api/auth/forgot-password    # Quên mật khẩu
POST   /api/auth/reset-password     # Đặt lại mật khẩu
POST   /api/auth/verify-email       # Xác thực email
GET    /api/auth/health             # Health check
```

**Models:**
- `User` — email, password, fullName, emailVerified, isActive, lastLogin
- `RefreshToken` — token, userId, expiresAt, revoked
- `DeviceSession` — sessionId, deviceId, userAgent, ipAddress, lastActivity
- `LoginAttempt` — email, success, ipAddress, userAgent
- `BlacklistedToken` — token, expiresAt
- `VerificationToken` — email, token, type (VERIFY_EMAIL | RESET_PASSWORD)

---

### 2. User Service (Port 3002) — Database: `user_db`

Quản lý hồ sơ người dùng, education, work experience, notifications, real-time chat, và analytics.

**Key Endpoints:**
```
# User Profile
GET    /api/users                              # Lấy danh sách users (auth)
GET    /api/users/me                           # Profile của tôi
PUT    /api/users/me                           # Cập nhật profile
DELETE /api/users/me                           # Xóa tài khoản
GET    /api/users/me/stats                     # Thống kê cá nhân
GET    /api/users/profile/avatar/upload-url    # URL upload avatar (MinIO)
POST   /api/users/batch                        # Lấy batch users
GET    /api/users/:userId                      # Profile theo userId
POST   /api/users/become-instructor            # Đăng ký làm giảng viên
POST   /api/users/become-instructor/confirm    # Xác nhận giảng viên

# Education & Work Experience
POST   /api/users/me/education                 # Thêm học vấn
PUT    /api/users/me/education/:id             # Sửa học vấn
DELETE /api/users/me/education/:id             # Xóa học vấn
POST   /api/users/me/work                      # Thêm kinh nghiệm
PUT    /api/users/me/work/:id                  # Sửa kinh nghiệm
DELETE /api/users/me/work/:id                  # Xóa kinh nghiệm

# Notifications
GET    /api/users/me/notifications             # Danh sách thông báo
PUT    /api/users/me/notifications/read-all    # Đánh dấu đã đọc tất cả
PUT    /api/users/me/notifications/:id/read    # Đánh dấu đã đọc
DELETE /api/users/me/notifications/:id         # Xóa thông báo

# Real-time Chat (+ WebSocket via Socket.io)
GET    /api/users/me/conversations                        # Danh sách hội thoại
POST   /api/users/me/conversations                        # Tạo hội thoại
GET    /api/users/me/conversations/:id/messages           # Tin nhắn trong hội thoại
POST   /api/users/me/conversations/:id/messages           # Gửi tin nhắn
PUT    /api/users/me/conversations/:id/read               # Đánh dấu đã đọc
GET    /api/users/me/chat/unread-count                    # Số tin chưa đọc

# Admin
GET    /api/users/analytics                    # Analytics (ADMIN only)
PUT    /api/users/:userId                      # Admin cập nhật user
DELETE /api/users/:userId                      # Admin vô hiệu hóa user
GET    /api/users/health                       # Health check
```

**Models:**
- `UserProfile` — userId, email, fullName, avatar, bio, role (STUDENT|INSTRUCTOR|ADMIN), phoneNumber, address, dateOfBirth, badges, preferences
- `EducationBackground` — institution, degree, fieldOfStudy, startDate, endDate, grade
- `WorkExperience` — company, position, location, startDate, endDate, current
- `Notification` — title, message, type (INFO|SUCCESS|WARNING|ERROR), isRead, link
- `Conversation` — courseId, courseTitle, participants, lastMessage
- `ChatMessage` — conversationId, senderId, senderName, content, messageType (TEXT|IMAGE|FILE|SYSTEM), readBy

---

### 3. Course Service (Port 3003) — Database: `course_db`

Quản lý khóa học, bài giảng, đánh giá, danh mục, và instructor dashboard.

**Key Endpoints:**
```
# Courses
GET    /api/courses                              # Danh sách khóa học (paginated, public)
POST   /api/courses                              # Tạo khóa học (Instructor/Admin)
GET    /api/courses/me                           # Khóa học của tôi (Instructor)
GET    /api/courses/:courseId                     # Chi tiết khóa học
GET    /api/courses/slug/:slug                   # Tìm theo slug
PUT    /api/courses/:courseId                     # Cập nhật khóa học
DELETE /api/courses/:courseId                     # Xóa khóa học
POST   /api/courses/:courseId/publish            # Xuất bản khóa học
POST   /api/courses/batch                        # Lấy batch khóa học
GET    /api/courses/analytics                    # Analytics (ADMIN)
GET    /api/courses/files/download               # Download file từ MinIO

# Course Approval (Admin)
GET    /api/courses/admin/pending                # Khóa học chờ duyệt
POST   /api/courses/:courseId/approve            # Duyệt khóa học
POST   /api/courses/:courseId/reject             # Từ chối khóa học

# Instructor Dashboard
GET    /api/courses/instructor/dashboard                     # Dashboard
GET    /api/courses/instructor/:courseId/students             # Danh sách sinh viên
GET    /api/courses/instructor/:courseId/students/:studentId  # Chi tiết sinh viên

# Lessons
GET    /api/courses/:courseId/lessons             # Danh sách bài giảng
POST   /api/courses/:courseId/lessons             # Tạo bài giảng
GET    /api/courses/:courseId/lessons/:lessonId   # Chi tiết bài giảng
PUT    /api/courses/:courseId/lessons/:lessonId   # Cập nhật bài giảng
DELETE /api/courses/:courseId/lessons/:lessonId   # Xóa bài giảng
POST   /api/courses/:courseId/lessons/reorder     # Sắp xếp lại thứ tự
POST   /api/courses/:courseId/upload-url          # URL upload file (MinIO)

# Reviews
GET    /api/courses/:courseId/reviews             # Đánh giá khóa học
POST   /api/courses/:courseId/reviews             # Viết đánh giá
GET    /api/courses/:courseId/reviews/me          # Đánh giá của tôi
GET    /api/courses/:courseId/reviews/distribution # Phân bố rating
PUT    /api/reviews/:reviewId                     # Sửa đánh giá
DELETE /api/reviews/:reviewId                     # Xóa đánh giá

# Categories
GET    /api/categories                            # Danh sách danh mục
GET    /api/categories/stats                      # Thống kê danh mục
GET    /api/categories/:categoryId                # Chi tiết danh mục
GET    /api/categories/slug/:slug                 # Tìm theo slug
POST   /api/categories                            # Tạo danh mục (ADMIN)
PUT    /api/categories/:categoryId                # Cập nhật danh mục (ADMIN)
DELETE /api/categories/:categoryId                # Xóa danh mục (ADMIN)

# Search
GET    /api/search/courses                        # Tìm kiếm khóa học

GET    /api/courses/health                        # Health check
```

**Models:**
- `Course` — title, slug, description, instructorId, price, thumbnail, categoryId, level (BEGINNER|INTERMEDIATE|ADVANCED), language, whatYouWillLearn, requirements, targetAudience, published, approvalStatus (DRAFT|PENDING_REVIEW|APPROVED|REJECTED), rating, enrolledCount
- `Lesson` — courseId, title, description, videoUrl, duration, order, isPreview, resources
- `Review` — courseId, userId, rating, comment (unique per user per course)
- `Category` — name, slug, description, icon

---

### 4. Order Service (Port 3004) — Database: `order_db`

Quản lý giỏ hàng và đơn hàng với tích hợp payment processing.

**Key Endpoints:**
```
# Cart
GET    /api/cart                                # Xem giỏ hàng
POST   /api/cart                                # Thêm vào giỏ
DELETE /api/cart/:courseId                       # Xóa khỏi giỏ
DELETE /api/cart                                # Xóa toàn bộ giỏ
GET    /api/cart/total                          # Tổng giỏ hàng

# Orders
GET    /api/orders/me                           # Đơn hàng của tôi
GET    /api/orders/me/:orderId                  # Chi tiết đơn hàng
GET    /api/orders/me/number/:orderNumber       # Tìm theo mã đơn
POST   /api/orders                              # Tạo đơn hàng
POST   /api/orders/with-payment                 # Tạo đơn + thanh toán Stripe
POST   /api/orders/:orderId/payment             # Thanh toán đơn hàng
GET    /api/orders/:orderId/payment-status       # Trạng thái thanh toán
POST   /api/orders/:orderId/cancel              # Hủy đơn hàng
POST   /api/orders/webhook/payment              # Webhook từ Payment Service

# Admin
GET    /api/orders                              # Tất cả đơn hàng (ADMIN)
GET    /api/orders/analytics                    # Analytics (ADMIN)
GET    /api/orders/stats                        # Thống kê (ADMIN)
PUT    /api/orders/:orderId/status              # Cập nhật trạng thái (ADMIN)
GET    /api/orders/:orderId                     # Chi tiết đơn (ADMIN)

GET    /api/orders/health                       # Health check
```

**Models:**
- `Cart` — userId, items (JSON), totalPrice
- `Order` — orderNumber, userId, items, subtotal, discount, totalPrice, status (PENDING|PROCESSING|COMPLETED|CANCELLED|FAILED), paymentStatus (UNPAID|PAID|REFUNDED|FAILED), cancelledReason
- `OrderItem` — orderId, courseId, courseTitle, price, discount, finalPrice

---

### 5. Payment Service (Port 3005) — Database: `payment_db`

Xử lý thanh toán qua **Stripe** (real integration): PaymentIntents, Webhooks, Refunds, Payment Methods.

**Key Endpoints:**
```
# Payments
POST   /api/payments/intents                    # Tạo Payment Intent
POST   /api/payments/create-intent              # Tạo Payment Intent (alias)
POST   /api/payments/confirm                    # Xác nhận thanh toán
GET    /api/payments/me                         # Thanh toán của tôi
GET    /api/payments/me/:paymentId              # Chi tiết thanh toán
GET    /api/payments/order/:orderId             # Thanh toán theo đơn hàng
POST   /api/payments/:paymentId/refund          # Yêu cầu hoàn tiền
POST   /api/payments/:paymentId/cancel          # Hủy thanh toán

# Payment Methods
POST   /api/payments/setup-intent               # Tạo Setup Intent
POST   /api/payments/save-method                # Lưu phương thức thanh toán
GET    /api/payments/methods                    # Danh sách phương thức

# Webhook
POST   /api/payments/webhook                    # Stripe Webhook (raw body)

# Admin
GET    /api/payments                            # Tất cả thanh toán (ADMIN)
GET    /api/payments/stats                      # Thống kê (ADMIN)
GET    /api/payments/:paymentId                 # Chi tiết (ADMIN)

GET    /api/payments/health                     # Health check
```

**Models:**
- `Payment` — orderId, orderNumber, userId, amount, currency, status (PENDING|PROCESSING|SUCCEEDED|FAILED|REFUNDED|CANCELLED), type (COURSE_PURCHASE|INSTRUCTOR_REGISTRATION), stripePaymentIntentId, clientSecret
- `Refund` — paymentId, orderId, userId, amount, reason, status (PENDING|SUCCEEDED|FAILED), stripeRefundId
- `StripeEvent` — stripeEventId, type, data, processed

---

### 6. Learning Service (Port 3006) — Database: `learning_db`

Theo dõi tiến độ học tập, quizzes, assignments, badges, certificates, HLS video streaming, learning paths, và analytics.

**Key Endpoints:**
```
# Progress
GET    /api/learning/progress/me                                    # Tiến độ tổng quan
GET    /api/learning/stats                                          # Thống kê học tập
GET    /api/learning/courses/enrolled                               # Khóa học đã đăng ký
GET    /api/learning/progress/course/:courseId                       # Tiến độ khóa học
POST   /api/learning/progress/:courseId/:lessonId/complete           # Hoàn thành bài giảng
POST   /api/learning/courses/:courseId/enroll                        # Đăng ký khóa học
POST   /api/learning/sync-enrollments                                # Đồng bộ enrollments
GET    /api/learning/progress/course/:courseId/students              # Danh sách sinh viên
GET    /api/learning/progress/course/:courseId/students/:userId      # Chi tiết sinh viên

# Certificates
POST   /api/learning/certificates/:courseId/generate                # Tạo chứng chỉ
GET    /api/learning/certificates/me                                # Chứng chỉ của tôi
GET    /api/learning/certificates/verify/:certificateNumber         # Xác minh chứng chỉ
GET    /api/learning/certificates/:certificateId/detail             # Chi tiết chứng chỉ
GET    /api/learning/certificates/:certificateId/download           # Tải chứng chỉ

# Badges
GET    /api/learning/badges/me                                      # Huy hiệu của tôi

# Activity
POST   /api/learning/activity                                       # Ghi nhận hoạt động
GET    /api/learning/activity/me                                    # Lịch sử hoạt động

# Quizzes
POST   /api/learning/quiz/:lessonId                                # Tạo quiz
GET    /api/learning/quiz/lesson/:lessonId                          # Quiz theo bài giảng
PUT    /api/learning/quiz/:quizId                                   # Cập nhật quiz
DELETE /api/learning/quiz/:quizId                                   # Xóa quiz
POST   /api/learning/quiz/:quizId/start                             # Bắt đầu làm quiz
POST   /api/learning/quiz/attempt/:attemptId/submit                 # Nộp bài quiz
GET    /api/learning/quiz/:quizId/attempts/me                       # Lịch sử làm quiz
GET    /api/learning/quiz/:quizId/attempts                          # Tất cả attempts (Instructor)

# Assignments
POST   /api/learning/assignment/:lessonId                           # Tạo assignment
GET    /api/learning/assignment/lesson/:lessonId                    # Assignment theo bài giảng
PUT    /api/learning/assignment/:assignmentId                       # Cập nhật assignment
DELETE /api/learning/assignment/:assignmentId                       # Xóa assignment
POST   /api/learning/assignment/:assignmentId/submit                # Nộp bài tập
POST   /api/learning/assignment/:assignmentId/upload-url            # URL upload file
GET    /api/learning/assignment/:assignmentId/submissions           # Danh sách bài nộp
GET    /api/learning/assignment/:assignmentId/submission/me         # Bài nộp của tôi
PUT    /api/learning/assignment/submission/:submissionId/grade      # Chấm điểm

# Tasks
GET    /api/learning/course/:courseId/tasks                          # Tasks trong khóa học
GET    /api/learning/tasks/pending                                   # Tasks đang chờ
GET    /api/learning/tasks/:taskId/detail                            # Chi tiết task

# HLS Video Streaming
POST   /api/learning/lessons/:lessonId/upload-video                  # Upload video (multipart)
GET    /api/learning/video-jobs/:jobId/status                        # Trạng thái xử lý
GET    /api/learning/lessons/:lessonId/stream                        # Video stream (presigned URL)
GET    /api/learning/lessons/:lessonId/hls                           # HLS master playlist
GET    /api/learning/lessons/:lessonId/hls/playlist                  # Signed playlist
GET    /api/learning/lessons/:lessonId/hls/segment/:segmentFile      # HLS segment
GET    /api/learning/lessons/:lessonId/hls/key                       # AES-128 decryption key
GET    /api/learning/files/download                                  # Download file

# Learning Analytics
GET    /api/learning/analytics/study-patterns                        # Phân tích thói quen
GET    /api/learning/analytics/reminders                              # Nhắc nhở học tập
GET    /api/learning/analytics/heatmap                                # Biểu đồ nhiệt
GET    /api/learning/analytics/weekly-report                          # Báo cáo tuần
GET    /api/learning/analytics/optimal-schedule                       # Lịch học tối ưu
GET    /api/learning/analytics/my-schedule                            # Lịch học của tôi
POST   /api/learning/analytics/my-schedule                            # Lưu lịch học
GET    /api/learning/analytics/content-recommendations                # Gợi ý nội dung

# Learning Paths & Recommendations
GET    /api/learning/recommendations/home                             # Gợi ý trang chủ
GET    /api/learning/recommendations                                  # Gợi ý cá nhân hóa
GET    /api/learning/recommendations/insights                         # Learning insights
GET    /api/learning/recommendations/next-actions                     # Hành động tiếp theo
GET    /api/learning/paths                                            # Danh sách learning paths
GET    /api/learning/paths/my-paths                                   # Paths đã đăng ký
GET    /api/learning/paths/categories                                 # Danh mục paths
GET    /api/learning/paths/:pathId                                    # Chi tiết learning path
POST   /api/learning/paths/:pathId/enroll                             # Đăng ký learning path
DELETE /api/learning/paths/:pathId/enroll                             # Hủy đăng ký

# Admin Learning Paths
GET    /api/learning/admin/paths                                     # Danh sách paths (Admin)
GET    /api/learning/admin/paths/:id                                 # Chi tiết path (Admin)
POST   /api/learning/admin/paths                                     # Tạo learning path
PUT    /api/learning/admin/paths/:id                                 # Cập nhật path
DELETE /api/learning/admin/paths/:id                                 # Xóa path
PUT    /api/learning/admin/paths/:id/status                          # Cập nhật status
POST   /api/learning/admin/paths/:id/duplicate                       # Nhân bản path

GET    /api/learning/health                                          # Health check
```

**Models:**
- `UserProgress` — userId, totalCoursesEnrolled, totalCoursesCompleted, totalLessonsCompleted, totalStudyTime, streakDays
- `CourseProgress` — userId, courseId, courseTitle, progressPercentage, completedLessons, timeSpentSeconds
- `LessonProgress` — userId, courseId, lessonId, lessonTitle, completed, timeSpentSeconds, watchCount
- `Certificate` — certificateNumber, userId, courseId, courseTitle, userName, certificateUrl, verificationUrl
- `Badge` — userId, badgeName, badgeType, description, iconUrl
- `ActivityLog` — userId, courseId, lessonId, action, durationSeconds
- `Quiz` — courseId, lessonId, title, questions (JSON), passingScore, timeLimitMinutes, maxAttempts, shuffleQuestions
- `QuizAttempt` — quizId, userId, answers, score, correctAnswers, passed, status (IN_PROGRESS|SUBMITTED|TIMED_OUT)
- `Assignment` — courseId, lessonId, title, description, instructions, maxScore, dueDate, allowedFileTypes, maxFileSizeMB
- `AssignmentSubmission` — assignmentId, userId, content, fileUrl, fileKey, status (SUBMITTED|GRADING|GRADED|RETURNED), score, feedback
- `VideoProcessingJob` — lessonId, courseId, inputFilePath, status, hlsPath, segmentCount, durationSeconds
- `LearningPath` — title, slug, description, category, difficulty, courseIds, skills, completionRule, status
- `UserPathEnrollment` — userId, learningPathId, status
- `StudySchedule` — userId, slots, weeklyTargetHours, dailyTargetMinutes

---

### 7. AI Service (Port 3007) — Database: `ai_db`

AI Learning Assistant tích hợp **Google Gemini** cho chatbot, phân tích học tập, và gợi ý cá nhân hóa.

**Key Endpoints:**
```
# AI Chat
POST   /api/ai/chat                              # Chat với AI (có context cá nhân hóa)
POST   /api/ai/conversations                     # Tạo cuộc trò chuyện mới
GET    /api/ai/conversations                     # Danh sách cuộc trò chuyện
GET    /api/ai/conversations/:id                 # Chi tiết cuộc trò chuyện
DELETE /api/ai/conversations/:id                 # Xóa cuộc trò chuyện
PATCH  /api/ai/conversations/:id/rename          # Đổi tên cuộc trò chuyện

# AI Insights (calls Google Gemini)
GET    /api/ai/insights                          # Learning insights data (fast, no Gemini)
GET    /api/ai/learning-summary                  # AI-generated learning summary
GET    /api/ai/recommendations                   # AI course recommendations
POST   /api/ai/coach                             # AI Learning Coach advice
GET    /api/ai/recommended-paths                 # AI learning path recommendations

GET    /api/ai/health                            # Health check
```

**Models:**
- `Conversation` — userId, title, messages
- `Message` — conversationId, role (USER|ASSISTANT), content

---

## 🔌 API Gateway (Nginx)

Nginx API Gateway (Port 8080) định tuyến requests đến backend services:

| Route | Service | Rate Limit |
|-------|---------|-----------|
| `/api/auth/*` | auth-service:3001 | 10 req/s (auth_limit) |
| `/api/users/*` | user-service:3002 | 100 req/s (api_limit) |
| `/api/courses/*` | course-service:3003 | 100 req/s (api_limit) |
| `/api/categories/*` | course-service:3003 | 100 req/s (api_limit) |
| `/api/search/*` | course-service:3003 | 100 req/s (api_limit) |
| `/api/orders/*` | order-service:3004 | 100 req/s (api_limit) |
| `/api/cart/*` | order-service:3004 | 100 req/s (api_limit) |
| `/api/payments/*` | payment-service:3005 | 20 req/s (payment_limit) |
| `/api/payments/webhook` | payment-service:3005 | No limit (raw body) |
| `/api/learning/*` | learning-service:3006 | 50 req/s (learning_limit) |
| `/api/learning/lessons/*` | learning-service:3006 | No limit (video uploads, 2GB max) |
| `/api/ai/*` | ai-service:3007 | 100 req/s (api_limit) |
| `/socket.io/*` | user-service:3002 | No limit (WebSocket) |
| `/` | frontend:80 | No limit |

**Features:**
- Reverse Proxy & Load Balancing (upstream keepalive: 32)
- Rate Limiting per endpoint type
- Gzip compression
- CORS headers
- Security headers (X-Frame-Options, X-Content-Type-Options, X-XSS-Protection)
- WebSocket proxy cho Socket.io (timeout: 7 days)
- Extended timeouts cho video upload (600s) và AI responses (120s)

---

## 📊 Database Strategy: Database-per-Service

```
┌────────────────────────────────────────────────────────────────────┐
│                      MongoDB Container (rs0)                       │
├────────────────────────────────────────────────────────────────────┤
│                                                                    │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐            │
│  │   auth_db    │  │   user_db    │  │  course_db   │            │
│  │              │  │              │  │              │            │
│  │ - User       │  │ - UserProfile│  │ - Course     │            │
│  │ - RefreshTkn │  │ - Education  │  │ - Lesson     │            │
│  │ - DeviceSess │  │ - WorkExp    │  │ - Review     │            │
│  │ - LoginAtmpt │  │ - Notifcatn  │  │ - Category   │            │
│  │ - Blacklisted│  │ - Converstn  │  │              │            │
│  │ - VerifyTkn  │  │ - ChatMsg    │  │              │            │
│  └──────────────┘  └──────────────┘  └──────────────┘            │
│                                                                    │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐            │
│  │  order_db    │  │ payment_db   │  │ learning_db  │            │
│  │              │  │              │  │              │            │
│  │ - Cart       │  │ - Payment    │  │ - UserProg   │            │
│  │ - Order      │  │ - Refund     │  │ - CourseProg │            │
│  │ - OrderItem  │  │ - StripeEvnt │  │ - LessonProg │            │
│  └──────────────┘  └──────────────┘  │ - Certificate│            │
│                                       │ - Badge      │            │
│  ┌──────────────┐                    │ - ActivityLog│            │
│  │    ai_db     │                    │ - Quiz/Atmpt │            │
│  │              │                    │ - Assignment │            │
│  │ - Converstn  │                    │ - Submission │            │
│  │ - Message    │                    │ - VideoJob   │            │
│  └──────────────┘                    │ - LrnPath    │            │
│                                       │ - PathEnroll │            │
│                                       │ - StudySched │            │
│                                       └──────────────┘            │
│                                                                    │
└────────────────────────────────────────────────────────────────────┘
```

### Service-to-DB Mapping

| Service | Database | Port |
|---------|----------|------|
| auth-service | auth_db | 3001 |
| user-service | user_db | 3002 |
| course-service | course_db | 3003 |
| order-service | order_db | 3004 |
| payment-service | payment_db | 3005 |
| learning-service | learning_db | 3006 |
| ai-service | ai_db | 3007 |

---

## 📦 Docker Compose Services (12 Containers)

### Infrastructure

| Service | Image | Ports | Notes |
|---------|-------|-------|-------|
| **MongoDB** | mongo:7.0-jammy | 27017 | Replica Set `rs0`, credentials: admin/securepassword123 |
| **MinIO** | minio/minio:latest | 9000 (API), 9001 (Console) | Credentials: minioadmin/minioadmin123 |
| **MinIO Init** | minio/mc:latest | — | Tạo buckets: assignments, quiz-attachments, courses, course-videos |
| **Nginx Gateway** | nginx:alpine | 8080, 8443 (HTTPS) | Reverse proxy, CORS, rate limiting |

### Backend Services (7 Services)

| Service | Port | Startup Command |
|---------|------|----------------|
| auth-service | 3001 | `prisma db push → seed → start` |
| user-service | 3002 | `sleep 5 → prisma db push → seed → start` |
| course-service | 3003 | `prisma db push → seed → start` |
| order-service | 3004 | `start` |
| payment-service | 3005 | `prisma db push → start` |
| learning-service | 3006 | `prisma db push → seed-paths → start` |
| ai-service | 3007 | `prisma db push → start` |

### Frontend Apps

| App | Port | Framework |
|-----|------|-----------|
| **Main Frontend** | 3000 | React 18 + Vite + TypeScript + Tailwind CSS |
| **Admin Frontend** | 4000 | React 18 + Vite + TypeScript + Tailwind CSS |

---

## 🎨 Frontend Applications

### Main Frontend (Port 3000)
Giao diện cho sinh viên và giảng viên:
- **Course Discovery**: Duyệt, tìm kiếm, lọc khóa học theo danh mục
- **Course Enrollment & Payment**: Giỏ hàng, thanh toán Stripe
- **Learning Experience**: Xem video HLS, quiz, assignments
- **Progress Tracking**: Dashboard tiến độ, biểu đồ, streak
- **Certificates & Badges**: Nhận chứng chỉ sau khi hoàn thành
- **AI Chatbot**: Chat với AI assistant (Google Gemini)
- **Real-time Chat**: Nhắn tin giữa sinh viên và giảng viên (Socket.io)
- **Notifications**: Thông báo real-time
- **Learning Paths**: Lộ trình học tập có hướng dẫn
- **Instructor Dashboard**: Quản lý khóa học, sinh viên, thống kê
- **Learning Analytics**: Phân tích thói quen, heatmap, báo cáo tuần

**Key Libraries**: React, Redux Toolkit, React Router, Axios, Chart.js, HLS.js, Stripe.js, Socket.io-client

### Admin Frontend (Port 4000)
Giao diện cho quản trị viên:
- **Service Health Monitoring**: Giám sát trạng thái 7 microservices
- **User Management**: Quản lý người dùng, phân quyền
- **Course Management**: Duyệt/từ chối khóa học, quản lý danh mục
- **Order & Payment Management**: Theo dõi đơn hàng, thanh toán
- **Learning Path Management**: Tạo và quản lý lộ trình học tập
- **Analytics Dashboard**: Thống kê toàn hệ thống

---

## 🔍 Health Checks

Tất cả services expose `/health` endpoints:

```bash
curl http://localhost:3001/api/auth/health
curl http://localhost:3002/api/users/health
curl http://localhost:3003/api/courses/health
curl http://localhost:3004/api/orders/health
curl http://localhost:3005/api/payments/health
curl http://localhost:3006/api/learning/health
curl http://localhost:3007/api/ai/health
curl http://localhost:8080/health        # Nginx Gateway
```

Response Format:
```json
{
  "service": "ai-service",
  "status": "ok",
  "version": "2.0",
  "features": ["chat", "learning-summary", "recommendations", "coach", "insights"],
  "timestamp": "2026-06-28T12:00:00.000Z"
}
```

---

## 🛠️ Development Workflow

### Adding a New Service

1. **Create service directory**: `mkdir services/new-service`
2. **Copy template files** from an existing service (package.json, tsconfig.json, Dockerfile, src/, prisma/)
3. **Update docker-compose.yml**: Add new service container
4. **Add Nginx routing** in `nginx/nginx.conf`
5. **Initialize Prisma**: `cd services/new-service && npm run prisma:generate`

### Environment Variables

Key environment variables trong `docker-compose.yml`:

```yaml
# MongoDB
DATABASE_URL: "mongodb://admin:securepassword123@mongodb:27017/{service}_db?authSource=admin"

# JWT
JWT_SECRET: "your-super-secret-jwt-key-change-in-production"

# Stripe
STRIPE_SECRET_KEY: "sk_test_..."
VITE_STRIPE_PUBLISHABLE_KEY: "pk_test_..."

# MinIO
MINIO_ENDPOINT: minio
MINIO_ACCESS_KEY: minioadmin
MINIO_SECRET_KEY: minioadmin123

# Google Gemini AI (from .env file)
GEMINI_API_KEY: "${GEMINI_API_KEY}"
GEMINI_MODEL: "gemini-3.1-flash-lite"

# Service Discovery (inter-service communication)
AUTH_SERVICE_URL: "http://auth-service:3001"
USER_SERVICE_URL: "http://user-service:3002"
COURSE_SERVICE_URL: "http://course-service:3003"
ORDER_SERVICE_URL: "http://order-service:3004"
PAYMENT_SERVICE_URL: "http://payment-service:3005"
LEARNING_SERVICE_URL: "http://learning-service:3006"
```

---

## 📈 Scaling Considerations

### Horizontal Scaling

```yaml
# Scale course-service to 3 instances
course-service:
  deploy:
    replicas: 3
```

### Performance Tuning

- **Nginx Worker Connections**: 10,240 concurrent connections
- **Keepalive Connections**: 32 per upstream
- **Connection Pooling**: MongoDB connection pooling via Prisma
- **Rate Limiting**: Configurable per-service (auth: 10r/s, payment: 20r/s, learning: 50r/s, general: 100r/s)
- **Video Upload**: Max 2GB, extended timeouts (600s)
- **AI Responses**: Extended timeouts (120s)

---

## 🔐 Security

### Current Implementation

- **Authentication**: JWT (access + refresh tokens) with device session tracking
- **Authorization**: Role-based access control (STUDENT, INSTRUCTOR, ADMIN)
- **Password**: Hashed with bcrypt
- **Token Blacklisting**: Logout invalidates tokens
- **Rate Limiting**: Per-endpoint rate limiting via Nginx + Express
- **CORS**: Configurable origins
- **Stripe Webhook**: Signature verification
- **Video Protection**: Presigned URLs + AES-128 encryption cho HLS segments
- **Security Headers**: X-Frame-Options, X-Content-Type-Options, X-XSS-Protection

### Production Hardening

1. Update CORS origins to specific domains
2. Enable SSL/TLS in nginx.conf
3. Use environment-specific secrets (don't hardcode)
4. Enable MongoDB authentication with strong passwords
5. Add API key authentication for inter-service communication

---

## 🐛 Troubleshooting

### Services not connecting to MongoDB
```bash
docker-compose logs mongodb
docker-compose exec mongodb mongosh -u admin -p securepassword123
```

### Nginx gateway not routing
```bash
docker-compose exec nginx-gateway cat /etc/nginx/nginx.conf
docker-compose exec nginx-gateway curl http://auth-service:3001/api/auth/health
```

### AI Service not working
```bash
# Check Gemini API key
cat .env
docker-compose logs ai-service
```

### Video upload/streaming issues
```bash
docker-compose logs learning-service
docker-compose exec minio mc ls myminio/course-videos
```

### Port conflicts
```bash
docker-compose ps
docker-compose down && docker-compose up -d
```

---

## 📖 Scripts

| Script | Description |
|--------|-------------|
| `scripts/check-nginx.sh` | Kiểm tra Nginx configuration |
| `scripts/generate-ssl.sh` | Tạo SSL certificates |
| `scripts/setup-all-services.sh` | Setup tất cả services |
| `scripts/fix-cache-ids.js` | Fix cache IDs |
| `scripts/optimize-dockerfiles.js` | Optimize Dockerfiles |

---

## 🎓 Course Integration

Project này covers các chủ đề của môn "Công nghệ mới trong ứng dụng phát triển CNTT":

- **Cloud-native Architecture**: Microservices, Docker, containerization
- **Modern Backend**: Node.js, TypeScript, Express, Prisma ORM
- **Database Design**: MongoDB, Database-per-Service pattern, Replica Sets
- **API Gateway**: Nginx, reverse proxy, load balancing, rate limiting
- **Real-time Communication**: WebSocket (Socket.io)
- **AI Integration**: Google Gemini API, personalized learning
- **Payment Processing**: Stripe API, webhooks, PCI compliance
- **Video Streaming**: HLS adaptive streaming, AES-128 encryption
- **Frontend Frameworks**: React 18, Vite, Tailwind CSS, Redux Toolkit
- **DevOps**: Docker Compose, health checks, auto-seeding
- **System Design**: C10K scalability, horizontal scaling, performance tuning

---

## 📄 License

Academic project — adjust as needed for your institution.

---

**Built with ❤️ for Công nghệ mới trong ứng dụng phát triển CNTT**

**Last Updated**: June 2026
