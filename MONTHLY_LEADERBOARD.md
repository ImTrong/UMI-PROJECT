# Monthly Leaderboard — UMI E-learning

## 1. Mục tiêu

Xây dựng bảng xếp hạng học viên theo tháng. Mỗi tháng hệ thống ghi nhận số khóa học học viên hoàn thành, tính thành tích, xếp hạng và trao phần thưởng (Badge) cho Top 3.

## 2. Business Rules

### Chu kỳ
- Leaderboard được tính theo **tháng dương lịch** (ví dụ: 01/09/2026 00:00 → 30/09/2026 23:59).
- Timezone: sử dụng timezone hệ thống (nhất quán với cách UMI lưu DateTime).

### Điều kiện hoàn thành khóa học
- Sử dụng **Certificate** (`type = COURSE_COMPLETION`) làm bằng chứng hoàn thành chính thức.
- Thời gian hoàn thành: `Certificate.issueDate`.
- Một khóa học chỉ được tính **1 lần** cho mỗi học viên (deduplicate bằng `userId + courseId`).

### Retake
- Nếu học viên retake khóa đã hoàn thành → **KHÔNG tạo thêm thành tích** trong leaderboard.
- Deduplicate trước khi tính ranking.

## 3. Ranking Formula

```
1. completedCourses DESC   (số khóa học hoàn thành trong tháng)
2. averageScore DESC       (điểm trung bình các khóa — từ Certificate.averageScore hoặc CourseProgress.averageQuizScore)
3. lastCompletedAt ASC     (ai hoàn thành khóa cuối sớm hơn → xếp trên)
```

## 4. Reward

Sử dụng **Badge system** hiện có trong learning-service:

| Rank | Badge Name | Icon |
|------|-----------|------|
| Top 1 | `Top 1 Xuất Sắc Tháng MM/YYYY` | 🥇 |
| Top 2 | `Top 2 Tháng MM/YYYY` | 🥈 |
| Top 3 | `Top 3 Tháng MM/YYYY` | 🥉 |

- Badge `badgeType = 'LEADERBOARD_REWARD'`.
- Idempotent: không tạo duplicate badge.

## 5. Database

### MonthlyLeaderboard
```prisma
model MonthlyLeaderboard {
  id          String    @id @default(auto()) @map("_id") @db.ObjectId
  month       Int
  year        Int
  status      String    @default("ACTIVE")  // ACTIVE | FINALIZED
  finalizedAt DateTime?
  createdAt   DateTime  @default(now())
  updatedAt   DateTime  @updatedAt
  entries     LeaderboardEntry[]
  @@unique([month, year])
  @@map("monthly_leaderboards")
}
```

### LeaderboardEntry
```prisma
model LeaderboardEntry {
  id                String   @id @default(auto()) @map("_id") @db.ObjectId
  leaderboardId     String   @db.ObjectId
  userId            String   @db.ObjectId
  rank              Int
  completedCourses  Int      @default(0)
  averageScore      Float    @default(0)
  lastCompletedAt   DateTime
  rewardBadgeId     String?  @db.ObjectId
  leaderboard       MonthlyLeaderboard @relation(...)
  @@unique([leaderboardId, userId])
  @@index([leaderboardId, rank])
  @@map("leaderboard_entries")
}
```

## 6. API

| Method | Endpoint | Auth | Mô tả |
|--------|----------|------|--------|
| GET | `/api/learning/leaderboard/current` | Optional | Leaderboard tháng hiện tại (on-the-fly) |
| GET | `/api/learning/leaderboard/history?month=&year=` | Optional | Leaderboard đã finalized |
| GET | `/api/learning/leaderboard/me` | Required | Rank của current user |
| GET | `/api/learning/leaderboard/months` | Optional | Danh sách các tháng đã finalized |

## 7. Cron Finalize

- **Schedule**: `5 0 1 * *` (00:05 ngày 1 hàng tháng).
- **On startup**: kiểm tra tháng trước chưa finalize → finalize ngay.
- **Idempotent**: chạy lại không tạo duplicate.

### Flow:
```
Check previous month status
→ if FINALIZED: skip
→ if not: 
    1. Aggregate completions from Certificate
    2. Deduplicate userId + courseId
    3. Sort & rank
    4. Award Badge cho Top 3
    5. Save snapshot (upsert leaderboard + createMany entries)
    6. Set status = FINALIZED
```

## 8. Edge Cases

| # | Edge Case | Xử lý |
|---|-----------|-------|
| 1 | Không có ai hoàn thành | Tạo leaderboard trống, status = FINALIZED |
| 2 | Chỉ 1-2 học viên | Chỉ trao badge cho số lượng có |
| 3 | Tie completedCourses | So averageScore DESC |
| 4 | Tie completedCourses + averageScore | So lastCompletedAt ASC |
| 5 | Tie hoàn toàn | Giữ nguyên thứ tự (stable sort) |
| 6 | Completion cuối tháng | `issueDate <= 23:59:59.999 cuối tháng` → thuộc tháng đó |
| 7 | Retake | Deduplicate userId+courseId |
| 8 | User bị xóa | History vẫn hiển thị, UI: "Học viên ẩn" |
| 9 | Cron chạy nhiều lần | Idempotent (check FINALIZED, upsert, deleteMany+createMany) |
| 10 | Badge đã tồn tại | Check `findUnique` trước khi create |
| 11 | Certificate averageScore null | Fallback sang CourseProgress.averageQuizScore |

## 9. Test Cases

### Ranking
1. User A: 5 courses → rank 1
2. User B: 4 courses → rank 2
3. Tie courses → compare averageScore
4. Tie courses + score → compare lastCompletedAt

### Retake
5. Retake cùng course → chỉ tính 1 lần

### Monthly
6. Completion tháng 09 không xuất hiện trong tháng 08
7. Completion ngày 01/10 thuộc tháng 10

### Reward
8. Top 1 nhận badge 🥇
9. Top 2 nhận badge 🥈
10. Top 3 nhận badge 🥉
11. Finalize lần 2 → không tạo duplicate badge

### API
12. GET /leaderboard/current → 200
13. GET /leaderboard/history?month=08&year=2026 → 200
14. GET /leaderboard/me → 200 (authenticated)
