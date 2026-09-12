# Git và GitHub Cơ Bản

## Git là gì?

Git là hệ thống quản lý phiên bản phân tán (Distributed Version Control System). Git theo dõi mọi thay đổi trong source code, cho phép nhiều developer cùng làm việc trên một dự án mà không gây xung đột.

## Các khái niệm cơ bản

### Repository (Repo)
Repository là kho lưu trữ chứa toàn bộ lịch sử thay đổi của dự án. Có hai loại:
- **Local repository**: trên máy tính cá nhân
- **Remote repository**: trên server (GitHub, GitLab, Bitbucket)

### Commit
Commit là một snapshot của dự án tại một thời điểm. Mỗi commit có:
- Hash ID duy nhất (ví dụ: `a1b2c3d`)
- Commit message mô tả thay đổi
- Author và timestamp
- Pointer đến commit trước đó (parent)

### Branch
Branch là nhánh phát triển độc lập. Branch mặc định là `main` (hoặc `master`). Tạo branch mới để phát triển tính năng mà không ảnh hưởng code chính.

## Các lệnh Git cơ bản

### Khởi tạo và cấu hình
```bash
git init                    # Khởi tạo repo mới
git config --global user.name "Tên"
git config --global user.email "email@example.com"
git clone <url>             # Clone remote repo
```

### Workflow cơ bản
```bash
git status                  # Xem trạng thái working directory
git add <file>              # Stage file
git add .                   # Stage tất cả
git commit -m "message"     # Tạo commit
git log                     # Xem lịch sử commit
git log --oneline           # Xem lịch sử ngắn gọn
```

### Branch
```bash
git branch                  # Liệt kê branches
git branch <name>           # Tạo branch mới
git checkout <branch>       # Chuyển branch
git checkout -b <branch>    # Tạo và chuyển branch
git merge <branch>          # Merge branch vào branch hiện tại
git branch -d <branch>      # Xóa branch
```

### Remote
```bash
git remote add origin <url> # Thêm remote
git push origin main        # Push lên remote
git pull origin main        # Pull từ remote
git fetch                   # Tải thay đổi nhưng chưa merge
```

## GitHub

GitHub là nền tảng hosting cho Git repository. Tính năng chính:
- **Pull Request (PR)**: yêu cầu review và merge code
- **Issues**: theo dõi bugs và feature requests
- **Actions**: CI/CD tự động
- **Fork**: sao chép repo của người khác về tài khoản mình

### Quy trình Pull Request
1. Fork hoặc tạo branch mới
2. Thực hiện thay đổi và commit
3. Push lên remote
4. Tạo Pull Request trên GitHub
5. Code review bởi team members
6. Merge sau khi được approve

## Giải quyết Conflict

Conflict xảy ra khi hai branch sửa cùng một dòng code. Để giải quyết:
1. Git đánh dấu vùng conflict bằng `<<<<<<<`, `=======`, `>>>>>>>`
2. Developer chọn giữ phiên bản nào hoặc kết hợp cả hai
3. Xóa markers và commit kết quả

## Kết luận

Git và GitHub là công cụ không thể thiếu trong phát triển phần mềm hiện đại. Thành thạo Git giúp bạn quản lý code hiệu quả và làm việc nhóm chuyên nghiệp.
