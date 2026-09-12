# Docker Containers Cơ Bản

## Docker là gì?

Docker là một nền tảng mã nguồn mở cho phép đóng gói, phân phối và chạy ứng dụng trong các container. Container là một đơn vị phần mềm nhẹ, độc lập, chứa mọi thứ cần thiết để chạy ứng dụng: code, runtime, thư viện và cấu hình hệ thống.

## Sự khác biệt giữa Container và Virtual Machine

Container chia sẻ kernel của hệ điều hành host, trong khi VM cần một hệ điều hành guest riêng. Do đó container khởi động nhanh hơn (giây thay vì phút), tiêu tốn ít tài nguyên hơn, và có kích thước nhỏ hơn nhiều so với VM.

## Dockerfile

Dockerfile là file text chứa các chỉ thị để Docker build một image. Các chỉ thị quan trọng:

- **FROM**: chỉ định base image (ví dụ: `FROM node:18-alpine`)
- **WORKDIR**: thiết lập thư mục làm việc trong container
- **COPY**: sao chép file từ host vào container
- **RUN**: thực thi lệnh trong quá trình build
- **EXPOSE**: khai báo port container lắng nghe
- **CMD**: lệnh mặc định khi container khởi động
- **ENV**: thiết lập biến môi trường

Ví dụ Dockerfile cho ứng dụng Node.js:

```dockerfile
FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
EXPOSE 3000
CMD ["node", "server.js"]
```

## Docker Compose

Docker Compose cho phép định nghĩa và chạy nhiều container cùng lúc bằng file YAML. Lệnh chính:

- `docker compose up`: khởi động tất cả services
- `docker compose down`: dừng và xóa containers
- `docker compose build`: build lại images
- `docker compose logs`: xem logs

Ví dụ docker-compose.yml:

```yaml
version: '3.8'
services:
  web:
    build: .
    ports:
      - "3000:3000"
  db:
    image: mongo:7
    volumes:
      - mongo_data:/data/db
volumes:
  mongo_data:
```

## Các lệnh Docker cơ bản

- `docker build -t myapp .`: build image từ Dockerfile
- `docker run -p 3000:3000 myapp`: chạy container
- `docker ps`: liệt kê containers đang chạy
- `docker images`: liệt kê images
- `docker stop <id>`: dừng container
- `docker rm <id>`: xóa container
- `docker rmi <image>`: xóa image

## Docker Volume

Volume là cơ chế lưu trữ dữ liệu bền vững cho container. Có 3 loại:
- **Named volumes**: quản lý bởi Docker, dùng `docker volume create`
- **Bind mounts**: ánh xạ trực tiếp thư mục host vào container
- **tmpfs mounts**: lưu trong bộ nhớ RAM, mất khi container dừng

## Kết luận

Docker giúp đơn giản hóa quy trình phát triển, kiểm thử và triển khai ứng dụng. Hiểu rõ Dockerfile, Docker Compose và Volume là nền tảng để làm việc hiệu quả với container.
