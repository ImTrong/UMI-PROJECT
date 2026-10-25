# DATA-01 – dữ liệu phát triển: tài khoản, hồ sơ, danh mục, khóa học, bài học

Dữ liệu **tổng hợp** cho môi trường phát triển UMI (miền `@umi-demo.local`). Giai đoạn 1 không tạo đơn hàng, thanh toán,
enrollment, chứng chỉ hay leaderboard.

| Fixture | Nội dung |
|---|---|
| `data/accounts.json` | 1 ADMIN, 5 INSTRUCTOR (bio, học vấn, kinh nghiệm), 40 STUDENT – không có mật khẩu |
| `data/catalog.json` | 6 danh mục: Frontend, Backend, Cơ sở dữ liệu, DevOps & Cloud, An toàn thông tin, AI & Khoa học dữ liệu |
| `data/courses.json` | 30 khóa học (20 APPROVED, 4 PENDING_REVIEW, 3 DRAFT, 3 REJECTED; 6 khóa/giảng viên), 307 bài học (8–14/khóa) |

## Chạy

```bash
node scripts/dev-data/seed-dev-data.mjs
```
Dry-run (mặc định): chỉ đọc, in số bản ghi sẽ tạo / đã có / xung đột / bị chặn và trạng thái unique index.

```bash
node scripts/dev-data/seed-dev-data.mjs --apply
```
Chỉ chạy được sau khi đã đồng bộ schema (`prisma db push`, xem `docs/database-maintenance.md`): nếu thiếu unique index,
`--apply` bị từ chối và không ghi gì.

```bash
node scripts/dev-data/verify-consistency.mjs --complete
```
Kiểm tra chỉ đọc: userId account ↔ profile, role, chủ sở hữu khóa học, danh mục, tổ hợp trạng thái duyệt, thứ tự bài học, bài học mồ côi.

Mặc định mỗi phần chạy **trong container** của service (`docker exec -i elearning-<service> node -`, cùng cách với
`scripts/demo-seed`), dùng Prisma client và `DATABASE_URL` của chính container. `--target=local` chỉ dành cho DB cô lập
(biến `DEV_DATA_AUTH_DB_URL`, `DEV_DATA_USER_DB_URL`, `DEV_DATA_COURSE_DB_URL`); cổng 27017 bị từ chối.

Mã thoát: `0` xong, `2` dừng (fixture sai, thiếu index, không đọc được DB, vấn đề file mật khẩu), `3` có xung đột hoặc bản ghi bị chặn
(đã bỏ qua, không ghi đè), `1` lỗi nhất quán sau apply.

## Quy tắc an toàn

- Không có `delete`/`update`/`upsert`/`drop` (test `safety.test.mjs` kiểm tra mã nguồn). Chạy lại chỉ tạo phần còn thiếu.
- Khóa định danh: email (account), userId/email (profile), slug (danh mục, khóa học), `(courseId, order)` (bài học).
- Bản ghi đã có nhưng khác fixture → **xung đột**, giữ nguyên và bỏ qua cả các bản ghi phụ thuộc (ví dụ khóa học của giảng viên đó).
- Chỉ xử lý email `@umi-demo.local`; dữ liệu ngoài phạm vi được băm trước/sau để chứng minh không đổi.
- Mật khẩu: sinh ngẫu nhiên (144 bit), ghi một lần vào `scripts/dev-data/.accounts.local.json` (git-ignore) **trước** khi tạo tài khoản,
  không bao giờ ghi đè file đã có, không in ra log; hash bằng `bcryptjs` với `BCRYPT_ROUNDS` như auth-service.
- `rating`, `totalReviews`, `enrolledCount` giữ mặc định 0 – sẽ hình thành từ review/enrollment thật ở giai đoạn sau.
- Khóa APPROVED được ghi như `CourseService.approveCourse` (published, approvedAt, approvedBy = tài khoản ADMIN demo);
  REJECTED có `rejectionReason`; PENDING_REVIEW/DRAFT chưa xuất bản.

## Video

Trình phát lấy video từ MinIO (`/api/learning/lessons/:id/stream`, HLS hoặc file trong bucket `courses`); URL ngoài và đường dẫn
cục bộ không phát được. Giai đoạn này **không ghi MinIO**, nên `videoUrl` để rỗng: trang học hiển thị bài ở dạng văn bản
(`Learning.tsx`) từ mô tả. Container `learning-service` có `ffmpeg`; clip phát triển và URL thật sẽ được gắn ở giai đoạn sau.
Ghi chú: API tạo bài học yêu cầu `videoUrl` không rỗng, còn schema thì cho phép – seed ghi trực tiếp qua Prisma.

## Test

```bash
node --test scripts/dev-data/tests/fixtures.test.mjs scripts/dev-data/tests/consistency.test.mjs scripts/dev-data/tests/safety.test.mjs
```

```bash
node --test --test-concurrency=1 scripts/dev-data/tests/integration.mongo.test.mjs
```
Integration test khởi động mongod riêng (replica set trên 127.0.0.1:27098, dữ liệu trong thư mục tạm, tự xóa), chạy `prisma db push`
vào DB test đó, rồi kiểm tra dry-run, apply, chạy lại, xung đột và lỗi kết nối. Không dùng MongoDB của Docker.
