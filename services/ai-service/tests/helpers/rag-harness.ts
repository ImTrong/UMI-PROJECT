/**
 * RAG-P0 test harness — the real ai-service express app, with every external dependency replaced:
 *   - auth-service / user-service / course-service / learning-service: ONE loopback HTTP stub answering like the real routes
 *     (POST /api/auth/verify-token, GET /api/users/:id, GET /api/courses/:id, GET /api/learning/progress/course/:id);
 *   - Qdrant: a fake client object on the RAGService's vector store (no network);
 *   - embeddings: a fake embedQuery (no Gemini call);
 *   - LLM: spies on geminiService.generateResponse / generateTitle (no Gemini call);
 *   - MongoDB: an in-memory Conversation / Message store for the RAG chat, stubs for the KnowledgeDocument lookups.
 * Nothing is written to Qdrant or MongoDB, no paid API is called. Tokens are random, JWT-shaped (so a leak is recognizable).
 * Every request uses its own X-Forwarded-For so the per-IP rate limiters of app.ts do not interfere.
 */
import http from 'node:http';
import { randomBytes } from 'node:crypto';
import { Writable } from 'node:stream';
import type { AddressInfo } from 'node:net';

const b64 = (n: number) => randomBytes(n).toString('base64url');
export const jwtLike = () => `eyJ${b64(12)}.eyJ${b64(24)}.${b64(32)}`;
export const oid = () => randomBytes(12).toString('hex');

export const ADMIN = { id: oid(), role: 'ADMIN', token: jwtLike(), email: 'admin@umi.test' };
export const INSTR1 = { id: oid(), role: 'INSTRUCTOR', token: jwtLike(), email: 'instr1@umi.test' };
export const INSTR2 = { id: oid(), role: 'INSTRUCTOR', token: jwtLike(), email: 'instr2@umi.test' };
export const STUDENT_A = { id: oid(), role: 'STUDENT', token: jwtLike(), email: 'alice@umi.test' };
export const STUDENT_B = { id: oid(), role: 'STUDENT', token: jwtLike(), email: 'bob@umi.test' };
export const EXPIRED_TOKEN = jwtLike();
export const USERS = [ADMIN, INSTR1, INSTR2, STUDENT_A, STUDENT_B];

export const C1 = oid();
export const C2 = oid();
export const C_DRAFT = oid(); // unpublished, owned by INSTR1
export const L1 = oid();      // lesson of C1 with text content
export const L1_VIDEO = oid(); // lesson of C1, video only
export const L2 = oid();      // lesson of C2
export const L1_FILES = oid(); // lesson of C1 with file resources (RAG-PDF-01)
export const L1_PDF = oid();   // lesson of C1 whose upload (videoUrl) is a PDF - the existing LessonManager flow (RAG-PDF-02)
export const L1_DOCX = oid();  // lesson of C1 whose upload (videoUrl) is a DOCX
export const PDF_KEY = '1792868080737-0f3c2a1e-9d4b-4c8e-8a51-2b7c9e6d4f10.pdf'; // "<timestamp>-<uuid>.<ext>" as the upload makes it
export const DOCX_KEY = '1792868080738-5b1d7e2a-3c4f-4a6b-9e8d-7f2a1c3b5d60.docx';
const download = (key: string) => `/api/courses/files/download?bucket=courses&key=${key}`;

const LONG_TEXT = 'Middleware trong ExpressJS là các hàm nhận req, res và next, chạy theo thứ tự đăng ký trong pipeline xử lý request.';

export const COURSES: Record<string, any> = {
  [C1]: {
    id: C1, title: 'NodeJS', instructorId: INSTR1.id, published: true,
    lessons: [
      { id: L1, courseId: C1, title: 'Middleware', description: LONG_TEXT, isPreview: false, resources: [] },
      { id: L1_VIDEO, courseId: C1, title: 'Video only', description: '', isPreview: true, resources: [] },
      {
        id: L1_FILES, courseId: C1, title: 'Tài liệu', description: '', isPreview: false,
        resources: [
          { title: 'Slide bài giảng.pdf', type: 'pdf', fileUrl: download('slides-1.pdf') },
          { name: 'Ghi chú.docx', fileUrl: download('notes-1.docx') },
          { title: 'Bản scan.pdf', fileUrl: download('scan-1.pdf') },
          { title: 'Ảnh.png', fileUrl: download('image-1.png') },
          { title: 'Tài liệu ngoài', url: 'https://example.com/outside.pdf' },
          { title: 'Bucket khác', fileUrl: '/api/courses/files/download?bucket=avatars&key=other-1.pdf' },
        ],
      },
      { id: L1_PDF, courseId: C1, title: 'Bài 1', description: '', videoUrl: download(PDF_KEY), isPreview: false, resources: [] },
      { id: L1_DOCX, courseId: C1, title: 'Bài 3', description: '', videoUrl: download(DOCX_KEY), isPreview: false, resources: [] },
    ],
  },
  [C2]: {
    id: C2, title: 'Python', instructorId: INSTR2.id, published: true,
    lessons: [{ id: L2, courseId: C2, title: 'Decorators', description: LONG_TEXT, isPreview: false, resources: [{ title: 'C2.pdf', fileUrl: download('c2-only.pdf') }] }],
  },
  [C_DRAFT]: { id: C_DRAFT, title: 'Draft', instructorId: INSTR1.id, published: false, lessons: [] },
};

/** courseId -> enrolled userIds */
export const ENROLLMENTS: Record<string, string[]> = { [C1]: [STUDENT_A.id], [C2]: [], [C_DRAFT]: [] };

export interface StubCall { method: string; url: string; authorization?: string }

export function chunk(courseId: string, lessonId: string, score: number, content: string, documentId = oid(), chunkIndex = 0) {
  return { score, payload: { documentId, chunkIndex, content, title: `Doc ${documentId.slice(0, 6)}`, sourceType: 'LESSON', courseId, lessonId } };
}

export class Harness {
  stub!: http.Server;
  server!: http.Server;
  base = '';
  calls: StubCall[] = [];
  logs: string[] = [];
  /** upstream failure switches */
  courseServiceDown = false;
  learningServiceDown = false;
  /** RAG-PDF-01: storage of the course-service download route (key -> bytes) and a forced status */
  files = new Map<string, Buffer>();
  downloadStatus = 200;

  rag: any;
  qdrant = {
    points: [] as Array<{ score: number; payload: any }>,
    leaky: false,          // ignore the filter (simulates a store bug)
    fail: false,
    queries: [] as any[],
    getCollections: async () => ({ collections: [{ name: 'umi_knowledge' }] }),
    getCollection: async () => ({ config: { params: { vectors: { size: 768 } } } }),
    query: async (_collection: string, req: any) => {
      this.qdrant.queries.push(req);
      if (this.qdrant.fail) throw new Error('connect ECONNREFUSED qdrant:6333');
      const must: any[] = req.filter?.must || [];
      const matches = (p: any) => this.qdrant.leaky || must.every((c) => p.payload[c.key] === c.match.value);
      // score_threshold deliberately NOT applied: the RelevanceGate must reject low scores on its own
      const points = this.qdrant.points.filter(matches).sort((a, b) => b.score - a.score).slice(0, req.limit);
      return { points };
    },
  };
  embed = { calls: 0, fail: false };
  llm = { calls: [] as Array<{ systemPrompt: string; history: any[]; userMessage: string }>, titles: 0, fail: false, answer: 'Theo [Nguồn 1], middleware là hàm trung gian.' };
  db = new FakeChatStore();
  docs = {
    byId: new Map<string, any>(),
    ingestCalls: [] as any[],
    deleteCalls: [] as string[],
    ingestFileCalls: [] as any[],
    listCalls: [] as any[],
  };

  async start(env: Record<string, string> = {}) {
    this.stub = http.createServer((req, res) => this.handleStub(req, res));
    await new Promise<void>((resolve) => this.stub.listen(0, '127.0.0.1', resolve));
    const upstream = `http://127.0.0.1:${(this.stub.address() as AddressInfo).port}`;
    Object.assign(process.env, {
      NODE_ENV: 'test',
      AUTH_SERVICE_URL: upstream,
      USER_SERVICE_URL: upstream,
      COURSE_SERVICE_URL: upstream,
      LEARNING_SERVICE_URL: upstream,
      QDRANT_URL: 'http://127.0.0.1:9', // never contacted: the client is replaced below
      GEMINI_API_KEY: '',
      ...env,
    });

    // capture what the log files would receive, after the logger's formats
    const winston = require('winston');
    const logger = require('../../src/utils/logger').default;
    logger.transports.forEach((t: any) => { t.silent = true; });
    const sink = new Writable({ write: (c, _e, cb) => { this.logs.push(String(c)); cb(); } });
    logger.add(new winston.transports.Stream({ stream: sink }));
    // the raw arguments too (before formatting), to prove nothing sensitive is even handed to the logger by RAG code
    this.logger = logger;

    const { RAGService } = require('../../src/modules/rag/rag.service');
    this.rag = RAGService.getInstance();
    this.rag.vectorStore.client = this.qdrant;
    this.rag.embeddingService.embedQuery = async () => {
      this.embed.calls++;
      if (this.embed.fail) {
        const { RAGError } = require('../../src/modules/rag/errors');
        throw new RAGError('EMBEDDING_FAILED', '429 quota exceeded');
      }
      return new Array(768).fill(0.01);
    };
    this.rag.getDocument = async (id: string) => this.docs.byId.get(id) || null;
    this.rag.findActiveDocumentBySource = async (sourceType: string, sourceId: string) =>
      [...this.docs.byId.values()].find((d) => d.sourceType === sourceType && d.sourceId === sourceId && d.status === 'ACTIVE') || null;
    this.rag.ingest = async (...args: any[]) => {
      this.docs.ingestCalls.push(args);
      return { id: oid(), sourceType: args[0], sourceId: args[1], title: args[3], version: 1, status: 'ACTIVE', chunkCount: 1, contentHash: 'h', lastIndexedAt: new Date() };
    };
    this.rag.deleteDocument = async (id: string) => { this.docs.deleteCalls.push(id); };
    this.rag.ingestFile = async (...args: any[]) => {
      this.docs.ingestFileCalls.push(args);
      return { id: oid(), sourceType: args[0], sourceId: args[1], title: args[2], version: 1, status: 'ACTIVE', chunkCount: args[4].length, contentHash: 'h', lastIndexedAt: new Date() };
    };
    this.rag.listDocuments = async (status?: string, courseId?: string) => {
      this.docs.listCalls.push([status, courseId]);
      return [...this.docs.byId.values()].filter((d) => !courseId || d.metadata?.courseId === courseId);
    };

    const { geminiService } = require('../../src/services/gemini.service');
    geminiService.generateResponse = async (systemPrompt: string, history: any[], userMessage: string) => {
      this.llm.calls.push({ systemPrompt, history, userMessage });
      if (this.llm.fail) throw new Error('Gemini API error: [503 Service Unavailable] high demand');
      return this.llm.answer;
    };
    geminiService.generateTitle = async () => { this.llm.titles++; return 'Tiêu đề'; };

    const { ragChatService } = require('../../src/modules/rag/chat/rag-chat.controller');
    ragChatService.db = this.db;

    const app = require('../../src/app').default;
    this.server = app.listen(0, '127.0.0.1');
    await new Promise<void>((resolve) => this.server.once('listening', () => resolve()));
    this.base = `http://127.0.0.1:${(this.server.address() as AddressInfo).port}`;
  }

  logger: any;

  async stop() {
    await new Promise((r) => this.server.close(r));
    await new Promise((r) => this.stub.close(r));
  }

  reset() {
    this.calls.length = 0;
    this.courseServiceDown = false;
    this.learningServiceDown = false;
    this.qdrant.points = [];
    this.qdrant.leaky = false;
    this.qdrant.fail = false;
    this.qdrant.queries.length = 0;
    this.embed.calls = 0;
    this.embed.fail = false;
    this.llm.calls.length = 0;
    this.llm.titles = 0;
    this.llm.fail = false;
    this.docs.byId.clear();
    this.docs.ingestCalls.length = 0;
    this.docs.deleteCalls.length = 0;
    this.docs.listCalls.length = 0;
    this.docs.ingestFileCalls.length = 0;
    this.files.clear();
    this.downloadStatus = 200;
    this.db.clear();
  }

  private ipCounter = 0;
  async call(method: string, path: string, opts: { token?: string; body?: unknown } = {}) {
    this.ipCounter++;
    const headers: Record<string, string> = {
      'content-type': 'application/json',
      'x-forwarded-for': `10.${(this.ipCounter >> 16) & 255}.${(this.ipCounter >> 8) & 255}.${this.ipCounter & 255}`,
    };
    if (opts.token) headers.authorization = `Bearer ${opts.token}`;
    const res = await fetch(`${this.base}${path}`, {
      method,
      headers,
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    });
    const text = await res.text();
    let json: any = null;
    try { json = JSON.parse(text); } catch { /* not json */ }
    return { status: res.status, body: json, text };
  }

  /** The sensitive values of this run that must never appear in any log line. */
  secrets(): string[] {
    return [...USERS.map((u) => u.token), EXPIRED_TOKEN];
  }

  private handleStub(req: http.IncomingMessage, res: http.ServerResponse) {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      const url = req.url || '';
      this.calls.push({ method: req.method || '', url, authorization: req.headers.authorization });
      const send = (status: number, body: unknown) => {
        res.statusCode = status;
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify(body));
      };
      const bearer = (req.headers.authorization || '').replace(/^Bearer /, '');
      const caller = USERS.find((u) => u.token === bearer);

      if (req.method === 'POST' && url === '/api/auth/verify-token') {
        const token = JSON.parse(raw || '{}').token;
        const user = USERS.find((u) => u.token === token);
        return user
          ? send(200, { valid: true, user: { userId: user.id, email: user.email } })
          : send(401, { valid: false, error: 'Token has expired' });
      }
      let m = url.match(/^\/api\/users\/([a-f0-9]{24})$/);
      if (req.method === 'GET' && m) {
        const user = USERS.find((u) => u.id === m![1]);
        return user ? send(200, { data: { id: user.id, role: user.role } }) : send(404, { error: 'not found' });
      }
      if (req.method === 'GET' && url.startsWith('/api/courses/files/download?')) {
        // the course-service's FileAccessService rule: a key referenced by a lesson resource; ADMIN, owner or enrolled learner
        if (this.downloadStatus !== 200) return send(this.downloadStatus, { error: 'Failed to download file' });
        const params = new URLSearchParams(url.split('?')[1]);
        const key = params.get('key') || '';
        const refersTo = (v: unknown) => String(v || '').endsWith(`key=${key}`);
        const owner = Object.values(COURSES).find((c: any) => c.lessons.some((l: any) => refersTo(l.videoUrl) || (l.resources || []).some((r: any) => refersTo(r.fileUrl) || refersTo(r.url))));
        if (params.get('bucket') !== 'courses' || !owner || !this.files.has(key)) return send(404, { error: 'File not found' });
        const allowed = !!caller && (caller.role === 'ADMIN' || caller.id === owner.instructorId || ENROLLMENTS[owner.id]?.includes(caller.id));
        if (!allowed) return send(caller ? 403 : 401, { error: 'Access denied' });
        res.statusCode = 200;
        res.setHeader('content-type', 'application/octet-stream');
        return res.end(this.files.get(key));
      }
      m = url.match(/^\/api\/courses\/([a-f0-9]{24})$/);
      if (req.method === 'GET' && m) {
        if (this.courseServiceDown) return send(500, { error: 'Failed to get course' });
        const course = COURSES[m[1]];
        if (!course) return send(404, { error: 'Course not found' });
        // the course-service's own visibility rule (course.service.ts getCourseById)
        const privileged = !!caller && (caller.role === 'ADMIN' || caller.id === course.instructorId || ENROLLMENTS[course.id]?.includes(caller.id));
        if (!course.published && !privileged) return send(403, { error: 'Course is not published' });
        return send(200, { data: { ...course, lessons: privileged ? course.lessons : course.lessons.filter((l: any) => l.isPreview) } });
      }
      m = url.match(/^\/api\/learning\/progress\/course\/([a-f0-9]{24})$/);
      if (req.method === 'GET' && m) {
        if (this.learningServiceDown) return send(500, { error: 'Failed to get course progress' });
        if (!caller) return send(401, { error: 'Unauthorized' });
        const enrolled = ENROLLMENTS[m[1]]?.includes(caller.id);
        return send(200, { data: enrolled ? { courseId: m[1], userId: caller.id, progressPercent: 10 } : null });
      }
      send(404, { error: `stub: no route ${req.method} ${url}` });
    });
  }
}

/** In-memory Conversation / Message store with the Prisma calls RAGChatService makes. */
export class FakeChatStore {
  conversations: any[] = [];
  messages: any[] = [];
  private seq = 0;
  clear() { this.conversations = []; this.messages = []; }
  private id() { this.seq++; return this.seq.toString(16).padStart(24, '0'); }

  conversation = {
    findFirst: async ({ where }: any) => this.conversations.find((c) => c.id === where.id && c.userId === where.userId) || null,
    create: async ({ data }: any) => { const c = { id: this.id(), createdAt: new Date(), updatedAt: new Date(), ...data }; this.conversations.push(c); return c; },
    update: async ({ where, data }: any) => { const c = this.conversations.find((x) => x.id === where.id); Object.assign(c, data); return c; },
  };
  message = {
    findMany: async ({ where }: any) => this.messages.filter((m) => m.conversationId === where.conversationId),
    create: async ({ data }: any) => { const m = { id: this.id(), createdAt: new Date(), ...data }; this.messages.push(m); return m; },
  };
}
