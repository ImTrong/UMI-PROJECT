# Middleware trong ExpressJS

## Middleware là gì?

Middleware là các hàm trung gian trong Express.js, có quyền truy cập vào đối tượng request (req), response (res), và hàm next() trong chu trình xử lý request-response.

Middleware có thể:
- Thực thi bất kỳ code nào
- Thay đổi đối tượng request và response
- Kết thúc chu trình request-response
- Gọi middleware tiếp theo trong chuỗi

## Các loại Middleware

### 1. Application-level middleware
Được gắn vào instance của Express app bằng app.use() hoặc app.METHOD():

```javascript
const express = require('express');
const app = express();

app.use((req, res, next) => {
  console.log('Time:', Date.now());
  next();
});
```

### 2. Router-level middleware
Hoạt động tương tự application-level middleware nhưng gắn vào instance của express.Router():

```javascript
const router = express.Router();
router.use((req, res, next) => {
  console.log('Time:', Date.now());
  next();
});
```

### 3. Error-handling middleware
Có 4 tham số thay vì 3: (err, req, res, next):

```javascript
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).send('Something broke!');
});
```

### 4. Built-in middleware
Express cung cấp sẵn:
- express.static: phục vụ file tĩnh
- express.json: parse JSON body
- express.urlencoded: parse URL-encoded body

### 5. Third-party middleware
Các middleware bên thứ ba phổ biến:
- cors: xử lý Cross-Origin Resource Sharing
- helmet: bảo mật HTTP headers
- morgan: logging HTTP requests
- cookie-parser: parse cookies

## Thứ tự Middleware

Thứ tự khai báo middleware RẤT QUAN TRỌNG. Middleware được thực thi theo thứ tự khai báo. Nếu một middleware không gọi next(), các middleware phía sau sẽ không được thực thi.

## Kết luận

Middleware là nền tảng của kiến trúc Express.js. Hiểu rõ cách middleware hoạt động giúp bạn xây dựng ứng dụng web có tổ chức, bảo mật và dễ bảo trì.
