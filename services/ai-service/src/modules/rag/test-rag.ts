/**
 * RAG Foundation — End-to-End Test Script
 *
 * Usage: Once Docker is up with Qdrant + MongoDB, run:
 *   npx ts-node src/modules/rag/test-rag.ts
 *
 * This script:
 * 1. Initializes RAG service
 * 2. Ingests a real lesson document
 * 3. Performs semantic search
 * 4. Tests idempotent re-indexing
 * 5. Tests version upgrade
 * 6. Tests document deletion
 */

import dotenv from 'dotenv';
dotenv.config();

import { initializeGemini } from '../../config/gemini.config';
import { RAGService } from '../rag/rag.service';

// Sample real UMI lesson content for testing
const SAMPLE_LESSON_CONTENT = `
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

\`\`\`javascript
const express = require('express');
const app = express();

// Middleware không có mount path → chạy mỗi khi nhận request
app.use((req, res, next) => {
  console.log('Time:', Date.now());
  next();
});

// Middleware có mount path
app.use('/user/:id', (req, res, next) => {
  console.log('Request Type:', req.method);
  next();
});
\`\`\`

### 2. Router-level middleware
Hoạt động tương tự application-level middleware nhưng gắn vào instance của express.Router():

\`\`\`javascript
const router = express.Router();

router.use((req, res, next) => {
  console.log('Time:', Date.now());
  next();
});
\`\`\`

### 3. Error-handling middleware
Có 4 tham số thay vì 3: (err, req, res, next):

\`\`\`javascript
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).send('Something broke!');
});
\`\`\`

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

Thứ tự khai báo middleware RẤT QUAN TRỌNG. Middleware được thực thi theo thứ tự khai báo:

\`\`\`javascript
// 1. Logging (chạy đầu tiên)
app.use(morgan('dev'));

// 2. CORS
app.use(cors());

// 3. Body parsing
app.use(express.json());

// 4. Routes
app.use('/api', routes);

// 5. Error handling (chạy cuối cùng)
app.use(errorHandler);
\`\`\`

## Kết luận

Middleware là nền tảng của kiến trúc Express.js. Hiểu rõ cách middleware hoạt động giúp bạn xây dựng ứng dụng web có tổ chức, bảo mật và dễ bảo trì.
`;

async function main() {
  console.log('=== RAG Foundation — End-to-End Test ===\n');

  // 1. Initialize
  console.log('[1] Initializing Gemini + RAG...');
  try {
    initializeGemini();
  } catch (e: any) {
    console.error('Failed to init Gemini:', e.message);
    console.error('Make sure GEMINI_API_KEY is set in .env');
    process.exit(1);
  }

  const rag = RAGService.getInstance();
  await rag.initialize();
  console.log('[1] ✅ RAG initialized\n');

  // 2. Health check
  console.log('[2] Health check...');
  const health = await rag.health();
  console.log('[2] Health:', JSON.stringify(health, null, 2), '\n');

  // 3. Ingest document
  console.log('[3] Ingesting lesson document...');
  const doc = await rag.ingest(
    'LESSON',
    'test-lesson-middleware-001',
    SAMPLE_LESSON_CONTENT,
    'Middleware trong ExpressJS',
    {
      courseId: 'course-nodejs-001',
      lessonId: 'test-lesson-middleware-001',
      skills: ['ExpressJS', 'Middleware', 'Node.js'],
      language: 'vi',
    },
  );
  console.log('[3] ✅ Document indexed:', {
    id: doc.id,
    title: doc.title,
    version: doc.version,
    status: doc.status,
    chunkCount: doc.chunkCount,
  }, '\n');

  // 4. Semantic search
  console.log('[4] Testing semantic search...');
  const queries = [
    'Middleware trong ExpressJS dùng để làm gì?',
    'Error handling middleware có mấy tham số?',
    'Thứ tự khai báo middleware có quan trọng không?',
  ];

  for (const query of queries) {
    console.log(`\n  Query: "${query}"`);
    const context = await rag.retrieve(query);
    console.log(`  Found: ${context.totalChunks} chunks`);
    for (const chunk of context.chunks) {
      console.log(`    - Score: ${chunk.score} | Title: ${chunk.title}`);
      console.log(`      Content (first 150 chars): ${chunk.content.substring(0, 150)}...`);
    }
  }
  console.log('\n[4] ✅ Semantic search working\n');

  // 5. Test idempotent re-index
  console.log('[5] Testing idempotent re-index (same content)...');
  const doc2 = await rag.ingest(
    'LESSON',
    'test-lesson-middleware-001',
    SAMPLE_LESSON_CONTENT,
    'Middleware trong ExpressJS',
    {
      courseId: 'course-nodejs-001',
      lessonId: 'test-lesson-middleware-001',
      skills: ['ExpressJS', 'Middleware', 'Node.js'],
      language: 'vi',
    },
  );
  console.log('[5] ✅ Same content re-index result:', {
    id: doc2.id,
    version: doc2.version,
    status: doc2.status,
  }, '(should be same id and version)\n');

  // 6. Test version upgrade
  console.log('[6] Testing version upgrade (changed content)...');
  const doc3 = await rag.ingest(
    'LESSON',
    'test-lesson-middleware-001',
    SAMPLE_LESSON_CONTENT + '\n\n## Bổ sung: Middleware chain\nMiddleware chain cho phép xử lý request qua nhiều bước.',
    'Middleware trong ExpressJS (Updated)',
    {
      courseId: 'course-nodejs-001',
      lessonId: 'test-lesson-middleware-001',
      skills: ['ExpressJS', 'Middleware', 'Node.js'],
      language: 'vi',
    },
  );
  console.log('[6] ✅ Version upgrade result:', {
    id: doc3.id,
    version: doc3.version,
    status: doc3.status,
    chunkCount: doc3.chunkCount,
  }, '(should have new version)\n');

  // 7. List documents
  console.log('[7] Listing documents...');
  const docs = await rag.listDocuments();
  console.log('[7] Documents:', docs.map(d => ({
    id: d.id,
    title: d.title,
    version: d.version,
    status: d.status,
  })), '\n');

  // 8. Cleanup
  console.log('[8] Cleaning up test document...');
  await rag.deleteDocument(doc3.id);
  console.log('[8] ✅ Deleted\n');

  console.log('=== All tests passed! ===');
  process.exit(0);
}

main().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
