/**
 * RAG Foundation — RUNTIME VERIFICATION
 *
 * Tests all 12 requirements from the verification spec.
 * Outputs structured results for each test.
 */

import dotenv from 'dotenv';
dotenv.config();

import { PrismaClient } from '@prisma/client';
import { initializeGemini } from '../../config/gemini.config';
import { RAGService } from './rag.service';
import { GeminiEmbeddingService } from './embeddings/gemini-embedding.service';

const prisma = new PrismaClient();

// Real UMI lesson content (Vietnamese, about ExpressJS Middleware)
const LESSON_CONTENT = `# Middleware trong ExpressJS

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

app.use((req, res, next) => {
  console.log('Time:', Date.now());
  next();
});

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
app.use(morgan('dev'));
app.use(cors());
app.use(express.json());
app.use('/api', routes);
app.use(errorHandler);
\`\`\`

## Kết luận

Middleware là nền tảng của kiến trúc Express.js. Hiểu rõ cách middleware hoạt động giúp bạn xây dựng ứng dụng web có tổ chức, bảo mật và dễ bảo trì.
`;

interface TestResult {
  name: string;
  status: 'PASS' | 'FAIL';
  details: any;
}

const results: TestResult[] = [];

function log(msg: string) {
  console.log(msg);
}

function logResult(result: TestResult) {
  results.push(result);
  const icon = result.status === 'PASS' ? '✅' : '❌';
  log(`\n${icon} ${result.name}: ${result.status}`);
  if (typeof result.details === 'object') {
    log(JSON.stringify(result.details, null, 2));
  } else {
    log(String(result.details));
  }
}

async function main() {
  log('========================================================');
  log('   RAG FOUNDATION — RUNTIME VERIFICATION');
  log('========================================================\n');

  // ============================================================
  // TEST 1: Infrastructure
  // ============================================================
  log('\n--- [1] INFRASTRUCTURE STATUS ---');

  // MongoDB
  let mongoOk = false;
  try {
    await prisma.$connect();
    const count = await prisma.conversation.count();
    mongoOk = true;
    log(`MongoDB: CONNECTED (conversations: ${count})`);
  } catch (e: any) {
    log(`MongoDB: FAILED — ${e.message}`);
  }

  // Qdrant
  let qdrantOk = false;
  try {
    const res = await fetch(`${process.env.QDRANT_URL || 'http://localhost:6333'}/healthz`);
    const body = await res.text();
    qdrantOk = body.includes('passed') || res.ok;
    log(`Qdrant: ${qdrantOk ? 'HEALTHY' : 'UNHEALTHY'} (${body.trim()})`);
  } catch (e: any) {
    log(`Qdrant: FAILED — ${e.message}`);
  }

  logResult({
    name: 'Infrastructure',
    status: mongoOk && qdrantOk ? 'PASS' : 'FAIL',
    details: { MongoDB: mongoOk ? 'CONNECTED' : 'FAILED', Qdrant: qdrantOk ? 'HEALTHY' : 'FAILED' },
  });

  if (!mongoOk || !qdrantOk) {
    log('\n❌ INFRASTRUCTURE FAILED. Cannot continue.');
    printFinalReport();
    process.exit(1);
  }

  // ============================================================
  // TEST 2: Embedding Verification
  // ============================================================
  log('\n--- [2] EMBEDDING VERIFICATION ---');

  const embModel = process.env.EMBEDDING_MODEL || 'gemini-embedding-001';
  const embDim = parseInt(process.env.EMBEDDING_DIMENSION || '768', 10);

  try {
    initializeGemini();
    log(`Gemini initialized. API key present: ${!!process.env.GEMINI_API_KEY}`);
  } catch (e: any) {
    log(`Gemini init failed: ${e.message}`);
    logResult({ name: 'Embedding', status: 'FAIL', details: e.message });
    printFinalReport();
    process.exit(1);
  }

  let actualDim = 0;
  try {
    const embService = new GeminiEmbeddingService(embModel, embDim);
    const testVector = await embService.embedQuery('test embedding verification');
    actualDim = testVector.length;
    log(`Embedding API call: SUCCESS`);
    log(`  Model: ${embModel}`);
    log(`  Config dimension: ${embDim}`);
    log(`  Actual vector length: ${actualDim}`);
    log(`  Match: ${actualDim === embDim}`);

    logResult({
      name: 'Embedding',
      status: actualDim === embDim ? 'PASS' : 'FAIL',
      details: {
        provider: 'gemini',
        model: embModel,
        configDimension: embDim,
        actualDimension: actualDim,
        match: actualDim === embDim,
      },
    });
  } catch (e: any) {
    log(`Embedding API call FAILED: ${e.message}`);
    logResult({ name: 'Embedding', status: 'FAIL', details: e.message });
    printFinalReport();
    process.exit(1);
  }

  // ============================================================
  // TEST 3: RAG Initialize + Qdrant Collection
  // ============================================================
  log('\n--- [3] RAG INITIALIZATION + QDRANT COLLECTION ---');

  const rag = RAGService.getInstance();
  await rag.initialize();
  const health = await rag.health();
  log(`RAG Health: ${JSON.stringify(health, null, 2)}`);

  // Verify Qdrant collection details
  const qdrantUrl = process.env.QDRANT_URL || 'http://localhost:6333';
  const collName = process.env.QDRANT_COLLECTION || 'umi_knowledge';
  let collInfo: any = null;
  try {
    const res = await fetch(`${qdrantUrl}/collections/${collName}`);
    collInfo = await res.json();
    const vectorConfig = collInfo?.result?.config?.params?.vectors;
    log(`Qdrant collection "${collName}":`);
    log(`  Vector size: ${vectorConfig?.size}`);
    log(`  Distance: ${vectorConfig?.distance}`);
    log(`  Dimension match with embedding: ${vectorConfig?.size === embDim}`);
  } catch (e: any) {
    log(`Qdrant collection check failed: ${e.message}`);
  }

  logResult({
    name: 'RAG Init + Qdrant',
    status: health.status === 'healthy' ? 'PASS' : 'FAIL',
    details: {
      ragStatus: health.status,
      qdrantConnected: health.qdrant,
      collection: collName,
      qdrantDimension: collInfo?.result?.config?.params?.vectors?.size,
      embeddingDimension: embDim,
      dimensionMatch: collInfo?.result?.config?.params?.vectors?.size === embDim,
      distance: collInfo?.result?.config?.params?.vectors?.distance,
    },
  });

  // ============================================================
  // TEST 4: Ingest Real Lesson
  // ============================================================
  log('\n--- [4] INGEST REAL LESSON ---');

  let ingestedDoc: any;
  try {
    ingestedDoc = await rag.ingest(
      'LESSON',
      'lesson-expressjs-middleware-001',
      LESSON_CONTENT,
      'Middleware trong ExpressJS',
      {
        courseId: 'course-nodejs-fundamentals',
        lessonId: 'lesson-expressjs-middleware-001',
        skills: ['ExpressJS', 'Middleware', 'Node.js', 'Backend'],
        language: 'vi',
      },
    );
    log(`Ingested document:`);
    log(`  ID: ${ingestedDoc.id}`);
    log(`  Title: ${ingestedDoc.title}`);
    log(`  Version: ${ingestedDoc.version}`);
    log(`  Status: ${ingestedDoc.status}`);
    log(`  Chunk count: ${ingestedDoc.chunkCount}`);
    log(`  Content hash: ${ingestedDoc.contentHash}`);

    // Verify MongoDB records
    const docCount = await prisma.knowledgeDocument.count({ where: { id: ingestedDoc.id } });
    const chunkCount = await prisma.documentChunk.count({ where: { documentId: ingestedDoc.id } });
    log(`  MongoDB KnowledgeDocument records: ${docCount}`);
    log(`  MongoDB DocumentChunk records: ${chunkCount}`);

    // Verify Qdrant points
    const qdrantRes = await fetch(`${qdrantUrl}/collections/${collName}/points/count`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filter: { must: [{ key: 'documentId', match: { value: ingestedDoc.id } }] }, exact: true }),
    });
    const qdrantCount = await qdrantRes.json();
    const pointCount = (qdrantCount as any)?.result?.count || 0;
    log(`  Qdrant points: ${pointCount}`);

    logResult({
      name: 'Ingest Lesson',
      status: ingestedDoc.status === 'ACTIVE' && ingestedDoc.chunkCount > 0 ? 'PASS' : 'FAIL',
      details: {
        documentId: ingestedDoc.id,
        title: ingestedDoc.title,
        version: ingestedDoc.version,
        status: ingestedDoc.status,
        chunkCount: ingestedDoc.chunkCount,
        mongoChunks: chunkCount,
        qdrantPoints: pointCount,
        contentHash: ingestedDoc.contentHash,
      },
    });
  } catch (e: any) {
    log(`Ingestion FAILED: ${e.message}`);
    logResult({ name: 'Ingest Lesson', status: 'FAIL', details: e.message });
    printFinalReport();
    process.exit(1);
  }

  // ============================================================
  // TEST 5: Semantic Retrieval (3 queries, different phrasings)
  // ============================================================
  log('\n--- [5] SEMANTIC RETRIEVAL ---');

  const queries = [
    'Middleware trong ExpressJS dùng để làm gì?',
    'Trong Express, middleware có vai trò gì?',
    'Tại sao request phải đi qua middleware?',
  ];

  const retrievalResults: any[] = [];
  for (const query of queries) {
    log(`\n  Query: "${query}"`);
    const ctx = await rag.retrieve(query);
    log(`  Results: ${ctx.totalChunks} chunks`);
    const qResults: any[] = [];
    for (const chunk of ctx.chunks) {
      const preview = chunk.content.substring(0, 120).replace(/\n/g, ' ');
      log(`    [${chunk.score}] chunk#${chunk.metadata.chunkIndex} "${preview}..."`);
      qResults.push({
        chunkIndex: chunk.metadata.chunkIndex,
        score: chunk.score,
        title: chunk.title,
        contentPreview: preview,
      });
    }
    retrievalResults.push({ query, totalChunks: ctx.totalChunks, topResults: qResults });
  }

  const allQueriesHaveResults = retrievalResults.every(r => r.totalChunks > 0);
  logResult({
    name: 'Semantic Retrieval',
    status: allQueriesHaveResults ? 'PASS' : 'FAIL',
    details: retrievalResults,
  });

  // ============================================================
  // TEST 6: Metadata Filtering
  // ============================================================
  log('\n--- [6] METADATA FILTERING ---');

  // Filter by correct courseId → should return results
  const correctFilter = await rag.retrieve('middleware', { courseId: 'course-nodejs-fundamentals' });
  log(`  Filter courseId=course-nodejs-fundamentals: ${correctFilter.totalChunks} chunks`);

  // Filter by wrong courseId → should return 0
  const wrongFilter = await rag.retrieve('middleware', { courseId: 'course-nonexistent-999' });
  log(`  Filter courseId=course-nonexistent-999: ${wrongFilter.totalChunks} chunks`);

  // Filter by sourceType
  const typeFilter = await rag.retrieve('middleware', { sourceType: 'LESSON' });
  log(`  Filter sourceType=LESSON: ${typeFilter.totalChunks} chunks`);

  // Filter by lessonId
  const lessonFilter = await rag.retrieve('middleware', { lessonId: 'lesson-expressjs-middleware-001' });
  log(`  Filter lessonId=lesson-expressjs-middleware-001: ${lessonFilter.totalChunks} chunks`);

  logResult({
    name: 'Metadata Filtering',
    status: correctFilter.totalChunks > 0 && wrongFilter.totalChunks === 0 ? 'PASS' : 'FAIL',
    details: {
      correctCourseId: { count: correctFilter.totalChunks, expected: '>0' },
      wrongCourseId: { count: wrongFilter.totalChunks, expected: '0' },
      sourceTypeLESSON: { count: typeFilter.totalChunks },
      lessonId: { count: lessonFilter.totalChunks },
    },
  });

  // ============================================================
  // TEST 7: Idempotency
  // ============================================================
  log('\n--- [7] IDEMPOTENCY ---');

  const doc2 = await rag.ingest(
    'LESSON',
    'lesson-expressjs-middleware-001',
    LESSON_CONTENT,
    'Middleware trong ExpressJS',
    {
      courseId: 'course-nodejs-fundamentals',
      lessonId: 'lesson-expressjs-middleware-001',
      skills: ['ExpressJS', 'Middleware', 'Node.js', 'Backend'],
      language: 'vi',
    },
  );
  log(`  Re-index same content:`);
  log(`    Same ID: ${doc2.id === ingestedDoc.id}`);
  log(`    Same version: ${doc2.version === ingestedDoc.version}`);
  log(`    Same hash: ${doc2.contentHash === ingestedDoc.contentHash}`);

  // Check no duplicates
  const totalDocs = await prisma.knowledgeDocument.count({
    where: { sourceType: 'LESSON', sourceId: 'lesson-expressjs-middleware-001', status: 'ACTIVE' },
  });
  const totalChunks = await prisma.documentChunk.count({ where: { documentId: doc2.id } });
  log(`    Active documents for this source: ${totalDocs}`);
  log(`    Chunks for this doc: ${totalChunks}`);

  logResult({
    name: 'Idempotency',
    status: doc2.id === ingestedDoc.id && doc2.version === ingestedDoc.version && totalDocs === 1 ? 'PASS' : 'FAIL',
    details: {
      sameId: doc2.id === ingestedDoc.id,
      sameVersion: doc2.version === ingestedDoc.version,
      sameHash: doc2.contentHash === ingestedDoc.contentHash,
      activeDocCount: totalDocs,
      chunkCount: totalChunks,
    },
  });

  // ============================================================
  // TEST 8: Version Upgrade (Changed Content)
  // ============================================================
  log('\n--- [8] VERSION UPGRADE ---');

  const updatedContent = LESSON_CONTENT + `\n\n## Middleware Chain Pattern\n\nMiddleware chain pattern cho phép bạn xử lý request qua nhiều bước tuần tự. Mỗi middleware trong chain có thể quyết định tiếp tục (gọi next()) hoặc dừng lại (gửi response).

### Ví dụ middleware chain:
\`\`\`javascript
const authenticate = (req, res, next) => { /* verify token */ next(); };
const authorize = (req, res, next) => { /* check permissions */ next(); };
const validate = (req, res, next) => { /* validate input */ next(); };

app.post('/api/data', authenticate, authorize, validate, handler);
\`\`\`
`;

  const doc3 = await rag.ingest(
    'LESSON',
    'lesson-expressjs-middleware-001',
    updatedContent,
    'Middleware trong ExpressJS (Updated)',
    {
      courseId: 'course-nodejs-fundamentals',
      lessonId: 'lesson-expressjs-middleware-001',
      skills: ['ExpressJS', 'Middleware', 'Node.js', 'Backend'],
      language: 'vi',
    },
  );

  log(`  New version:`);
  log(`    ID: ${doc3.id}`);
  log(`    Version: ${doc3.version}`);
  log(`    Status: ${doc3.status}`);
  log(`    Chunks: ${doc3.chunkCount}`);

  // Check old version is archived
  const oldDoc = await prisma.knowledgeDocument.findUnique({ where: { id: ingestedDoc.id } });
  log(`  Old version (${ingestedDoc.id}):`);
  log(`    Status: ${oldDoc?.status}`);

  // Verify new content is searchable
  const chainSearch = await rag.retrieve('middleware chain pattern');
  log(`  Search "middleware chain pattern": ${chainSearch.totalChunks} chunks`);

  logResult({
    name: 'Version Upgrade',
    status: doc3.version > ingestedDoc.version && doc3.status === 'ACTIVE' && oldDoc?.status === 'ARCHIVED' ? 'PASS' : 'FAIL',
    details: {
      newId: doc3.id,
      newVersion: doc3.version,
      newStatus: doc3.status,
      newChunkCount: doc3.chunkCount,
      oldId: ingestedDoc.id,
      oldStatus: oldDoc?.status,
      newContentSearchable: chainSearch.totalChunks > 0,
    },
  });

  // Update tracked doc for later tests
  ingestedDoc = doc3;

  // ============================================================
  // TEST 9: Failure Safety
  // ============================================================
  log('\n--- [9] FAILURE SAFETY ---');

  // Remember current ACTIVE doc
  const safeDocBefore = await prisma.knowledgeDocument.findFirst({
    where: { sourceType: 'LESSON', sourceId: 'lesson-expressjs-middleware-001', status: 'ACTIVE' },
  });
  log(`  Active doc before: ${safeDocBefore?.id} v${safeDocBefore?.version}`);

  // Try to ingest with empty content (should fail)
  let failError: any = null;
  try {
    await rag.ingest('LESSON', 'lesson-expressjs-middleware-001', '', 'Empty');
  } catch (e: any) {
    failError = e;
    log(`  Expected failure: ${e.message}`);
  }

  // Verify old ACTIVE doc is still there and searchable
  const safeDocAfter = await prisma.knowledgeDocument.findFirst({
    where: { sourceType: 'LESSON', sourceId: 'lesson-expressjs-middleware-001', status: 'ACTIVE' },
  });
  log(`  Active doc after failure: ${safeDocAfter?.id} v${safeDocAfter?.version}`);

  const safeSearch = await rag.retrieve('middleware trong Express');
  log(`  Still searchable: ${safeSearch.totalChunks > 0}`);

  logResult({
    name: 'Failure Safety',
    status: failError && safeDocAfter?.id === safeDocBefore?.id && safeSearch.totalChunks > 0 ? 'PASS' : 'FAIL',
    details: {
      failureTriggered: !!failError,
      failureMessage: failError?.message,
      activeDocPreserved: safeDocAfter?.id === safeDocBefore?.id,
      stillSearchable: safeSearch.totalChunks > 0,
    },
  });

  // ============================================================
  // TEST 10: Delete
  // ============================================================
  log('\n--- [10] DELETE ---');

  const deleteDocId = ingestedDoc.id;
  log(`  Deleting doc: ${deleteDocId}`);

  await rag.deleteDocument(deleteDocId);

  const deletedDoc = await prisma.knowledgeDocument.findUnique({ where: { id: deleteDocId } }).catch(() => null);
  const deletedChunks = await prisma.documentChunk.count({ where: { documentId: deleteDocId } });

  // Check Qdrant
  const qdrantAfterDel = await fetch(`${qdrantUrl}/collections/${collName}/points/count`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ filter: { must: [{ key: 'documentId', match: { value: deleteDocId } }] }, exact: true }),
  });
  const qdrantDelCount = await qdrantAfterDel.json();
  const qdrantPointsAfter = (qdrantDelCount as any)?.result?.count || 0;

  log(`  MongoDB doc exists: ${!!deletedDoc}`);
  log(`  MongoDB chunks remaining: ${deletedChunks}`);
  log(`  Qdrant points remaining: ${qdrantPointsAfter}`);

  logResult({
    name: 'Delete',
    status: !deletedDoc && deletedChunks === 0 && qdrantPointsAfter === 0 ? 'PASS' : 'FAIL',
    details: {
      documentDeleted: !deletedDoc,
      chunksRemaining: deletedChunks,
      qdrantPointsRemaining: qdrantPointsAfter,
    },
  });

  // ============================================================
  // TEST 11: Regression (Existing AI health)
  // ============================================================
  log('\n--- [11] REGRESSION CHECK ---');

  let aiHealthOk = false;
  try {
    // Check existing conversations table is still accessible
    const convCount = await prisma.conversation.count();
    const msgCount = await prisma.message.count();
    const cacheCount = await prisma.aIAnalysisCache.count();
    log(`  Existing data accessible:`);
    log(`    Conversations: ${convCount}`);
    log(`    Messages: ${msgCount}`);
    log(`    AI Analysis Cache: ${cacheCount}`);
    aiHealthOk = true;
  } catch (e: any) {
    log(`  Regression check failed: ${e.message}`);
  }

  logResult({
    name: 'Regression',
    status: aiHealthOk ? 'PASS' : 'FAIL',
    details: { existingDataAccessible: aiHealthOk },
  });

  // ============================================================
  // FINAL REPORT
  // ============================================================
  printFinalReport();

  await prisma.$disconnect();
  process.exit(results.every(r => r.status === 'PASS') ? 0 : 1);
}

function printFinalReport() {
  log('\n');
  log('========================================================');
  log('   FINAL VERIFICATION REPORT');
  log('========================================================\n');

  for (const r of results) {
    const icon = r.status === 'PASS' ? '✅' : '❌';
    log(`${icon} ${r.name}: ${r.status}`);
  }

  const allPass = results.every(r => r.status === 'PASS');
  log('\n========================================================');
  if (allPass) {
    log('   VERDICT: RAG FOUNDATION VERIFIED ✅');
  } else {
    log('   VERDICT: RAG FOUNDATION NOT VERIFIED ❌');
    const failures = results.filter(r => r.status === 'FAIL').map(r => r.name);
    log(`   Failed: ${failures.join(', ')}`);
  }
  log('========================================================\n');
}

main().catch(err => {
  console.error('FATAL ERROR:', err);
  process.exit(1);
});
