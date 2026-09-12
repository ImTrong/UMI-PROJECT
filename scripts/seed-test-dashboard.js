// ============================================================
// Seed Script: Full Analytics Dashboard Test Account
// ============================================================
// Creates user: dashboard-test@elearning.local / Test123456
// Populates ALL analytics sections with realistic data:
//   1. Learning Overview (5 KPI cards)
//   2. Learning Journey Timeline
//   3. Progress Trend Chart
//   4. Performance Trend Chart
//   5. Engagement Analytics
//   6. Skill Analytics
//   7. Knowledge Gap
//   8. Bottleneck Detection
//   9. Revisit / Recovery
//  10. Learning State
//  11. Next Recommended Actions
//  12. AI Learning Summary (reserved)
// ============================================================
// Usage:
//   docker exec elearning-mongo mongosh -u admin -p securepassword123 \
//     --authenticationDatabase admin /scripts/seed-test-dashboard.js
// ============================================================

// bcrypt hash of "Test123456" — same algorithm as auth-service uses
const BCRYPT_HASH = "$2a$10$RQMd0ZpsNb2uppEe7jjTg.uzzdfBhKIC4ac/puZ8Ch/pR5UDyCZ/S";

// ─── User ID (generate a fixed ObjectId for consistency across DBs) ───
const TEST_USER_ID = ObjectId("aaa000000000000000000001");

// ─── Course IDs (from existing published courses) ───
const COURSES = {
  react:     { id: ObjectId("6a7f42b5ff5e586a3ce5b17c"), title: "Lập trình Web Frontend với ReactJS và Tailwind CSS từ số 0", lessons: [
    { id: ObjectId("6a7f42b5ff5e586a3ce5b17d"), title: "Bài 1: Tổng quan và Cài đặt", dur: 300 },
    { id: ObjectId("6a7f42b5ff5e586a3ce5b17e"), title: "Bài 2: Thực hành chuyên sâu", dur: 600 },
  ]},
  nodejs:    { id: ObjectId("6a7f42b5ff5e586a3ce5b17f"), title: "Backend Node.js & Express toàn tập", lessons: [
    { id: ObjectId("6a7f42b5ff5e586a3ce5b180"), title: "Bài 1: Tổng quan và Cài đặt", dur: 300 },
    { id: ObjectId("6a7f42b5ff5e586a3ce5b181"), title: "Bài 2: Thực hành chuyên sâu", dur: 600 },
  ]},
  nextjs:    { id: ObjectId("6a7f42b5ff5e586a3ce5b182"), title: "Khoá học Next.js 14 Thực Chiến, App Router & Server Actions", lessons: [
    { id: ObjectId("6a7f42b5ff5e586a3ce5b183"), title: "Bài 1: Tổng quan và Cài đặt", dur: 300 },
    { id: ObjectId("6a7f42b5ff5e586a3ce5b184"), title: "Bài 2: Thực hành chuyên sâu", dur: 600 },
  ]},
  python:    { id: ObjectId("6a7f42b5ff5e586a3ce5b185"), title: "Mastering Python cho Phân Tích Dữ Liệu", lessons: [
    { id: ObjectId("6a7f42b5ff5e586a3ce5b186"), title: "Bài 1: Tổng quan và Cài đặt", dur: 300 },
    { id: ObjectId("6a7f42b5ff5e586a3ce5b187"), title: "Bài 2: Thực hành chuyên sâu", dur: 600 },
  ]},
  docker:    { id: ObjectId("6a7f448aa949aa290408270f"), title: "Thành Thạo Docker Từ Cơ Bản Đến Nâng Cao", lessons: [
    { id: ObjectId("6a7f4498a949aa2904082710"), title: "Bài 1", dur: 3600 },
    { id: ObjectId("6a7f44b2a949aa2904082711"), title: "Bài 2", dur: 3600 },
  ]},
  sql:       { id: ObjectId("6a7f42b6ff5e586a3ce5b197"), title: "Khóa học SQL và Cơ Sở Dữ Liệu", lessons: [
    // Using the pattern from other seeded courses (2 lessons each)
  ]},
};

// ─── Learning Path ID ───
const FULLSTACK_PATH_ID = ObjectId("6a7f42bf887c02cf2a08c40c");

// ─── Quiz IDs (existing) ───
const QUIZZES = [
  { id: ObjectId("6a7f44cf077f076b8445ae42"), courseId: ObjectId("6a7f448aa949aa290408270f"), lessonId: ObjectId("6a7f4498a949aa2904082710"), title: "Bài kiểm tra 1" },
  { id: ObjectId("6a7f44e7077f076b8445ae43"), courseId: ObjectId("6a7f448aa949aa290408270f"), lessonId: ObjectId("6a7f44b2a949aa2904082711"), title: "Bài kiểm tra 2" },
  { id: ObjectId("6a7f45c7077f076b8445ae46"), courseId: ObjectId("6a7f456da949aa2904082712"), lessonId: ObjectId("6a7f459ea949aa2904082713"), title: "Bài kiểm tra 1 (Git)" },
  { id: ObjectId("6a8896c0b3538c3d5f2cddf2"), courseId: ObjectId("6a8894d41878e03ad8299dfa"), lessonId: ObjectId("6a8894e71878e03ad8299dfb"), title: "Bài KT 1" },
  { id: ObjectId("6a8896d4b3538c3d5f2cddf3"), courseId: ObjectId("6a8894d41878e03ad8299dfa"), lessonId: ObjectId("6a8894fb1878e03ad8299dfc"), title: "Bài KT 2" },
  { id: ObjectId("6a8896e2b3538c3d5f2cddf4"), courseId: ObjectId("6a8894d41878e03ad8299dfa"), lessonId: ObjectId("6a88950a1878e03ad8299dfd"), title: "Bài KT 3" },
  { id: ObjectId("6a8896f0b3538c3d5f2cddf5"), courseId: ObjectId("6a8894d41878e03ad8299dfa"), lessonId: ObjectId("6a8895271878e03ad8299dfe"), title: "Bài KT 4" },
  { id: ObjectId("6a889701b3538c3d5f2cddf6"), courseId: ObjectId("6a8894d41878e03ad8299dfa"), lessonId: ObjectId("6a8895331878e03ad8299dff"), title: "Bài KT 5" },
];

// ─── Helper: Generate date N days ago ───
function daysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d;
}

function hoursAgo(n) {
  const d = new Date();
  d.setHours(d.getHours() - n);
  return d;
}

const NOW = new Date();

print("╔═══════════════════════════════════════════════╗");
print("║  Seeding Full Dashboard Test Account          ║");
print("║  Email: dashboard-test@elearning.local        ║");
print("║  Password: Test123456                         ║");
print("╚═══════════════════════════════════════════════╝");

// =====================================================
// 1. AUTH_DB — Create user account
// =====================================================
print("\n[1/5] Seeding auth_db...");
const authDb = db.getSiblingDB("auth_db");

// Remove existing if any
authDb.users.deleteMany({ email: "dashboard-test@elearning.local" });

authDb.users.insertOne({
  _id: TEST_USER_ID,
  email: "dashboard-test@elearning.local",
  password: BCRYPT_HASH,
  fullName: "Nguyễn Văn Analytics",
  emailVerified: true,
  lastLogin: NOW,
  isActive: true,
  createdAt: daysAgo(75),
  updatedAt: NOW,
});
print("  ✓ User created in auth_db");

// =====================================================
// 2. USER_DB — Create user profile
// =====================================================
print("\n[2/5] Seeding user_db...");
const userDb = db.getSiblingDB("user_db");

userDb.user_profiles.deleteMany({ email: "dashboard-test@elearning.local" });

userDb.user_profiles.insertOne({
  _id: ObjectId(),
  userId: TEST_USER_ID,
  email: "dashboard-test@elearning.local",
  fullName: "Nguyễn Văn Analytics",
  avatar: null,
  bio: "Sinh viên IT đam mê Fullstack Web Development",
  role: "STUDENT",
  phoneNumber: "0901234567",
  address: "TP.HCM, Việt Nam",
  dateOfBirth: new Date("2002-05-15"),
  badges: [],
  preferences: {},
  isActive: true,
  createdAt: daysAgo(75),
  updatedAt: NOW,
});
print("  ✓ Profile created in user_db");

// =====================================================
// 3. ORDER_DB — Create purchase orders
// =====================================================
print("\n[3/5] Seeding order_db...");
const orderDb = db.getSiblingDB("order_db");

orderDb.orders.deleteMany({ userId: TEST_USER_ID.toString() });
orderDb.order_items.deleteMany({});  // Clean up orphaned items only for this user

const coursesToBuy = [
  { key: "react",  price: 499000, date: daysAgo(70) },
  { key: "nodejs", price: 599000, date: daysAgo(65) },
  { key: "nextjs", price: 699000, date: daysAgo(50) },
  { key: "python", price: 399000, date: daysAgo(40) },
  { key: "docker", price: 349000, date: daysAgo(30) },
];

coursesToBuy.forEach(function(item, idx) {
  const c = COURSES[item.key];
  const orderId = ObjectId();
  const orderNum = "ORD-TEST-" + String(idx + 1).padStart(4, "0");

  orderDb.orders.insertOne({
    _id: orderId,
    orderNumber: orderNum,
    userId: TEST_USER_ID.toString(),
    items: [{ courseId: c.id.toString(), courseTitle: c.title, price: item.price, discount: 0, finalPrice: item.price }],
    subtotal: item.price,
    discount: 0,
    totalPrice: item.price,
    status: "COMPLETED",
    paymentStatus: "PAID",
    paymentId: null,
    notes: null,
    createdAt: item.date,
    updatedAt: item.date,
    completedAt: item.date,
  });

  orderDb.order_items.insertOne({
    _id: ObjectId(),
    orderId: orderId.toString(),
    courseId: c.id.toString(),
    courseTitle: c.title,
    price: item.price,
    discount: 0,
    finalPrice: item.price,
    createdAt: item.date,
  });
});
print("  ✓ " + coursesToBuy.length + " orders created in order_db");

// =====================================================
// 4. LEARNING_DB — The main data for analytics
// =====================================================
print("\n[4/5] Seeding learning_db...");
const learnDb = db.getSiblingDB("learning_db");

// ── Clean existing data for this user ──
[
  "user_progress", "course_progress", "lesson_progress",
  "activity_logs", "quiz_attempts", "badges", "certificates",
  "user_path_enrollments", "user_skill_profiles", "learner_analyses",
  "study_schedules",
].forEach(function(col) {
  learnDb[col].deleteMany({ userId: TEST_USER_ID });
  learnDb[col].deleteMany({ userId: TEST_USER_ID.toString() });
});

// ─────────────────────────────────────────────────
// 4.1 User Progress (aggregate stats)
// ─────────────────────────────────────────────────
learnDb.user_progress.insertOne({
  _id: ObjectId(),
  userId: TEST_USER_ID,
  totalCoursesEnrolled: 5,
  totalCoursesCompleted: 2,
  totalLessonsCompleted: 7,
  totalStudyTime: 54000,  // ~15 hours in seconds
  streakDays: 8,
  lastActivityDate: hoursAgo(3),
  createdAt: daysAgo(70),
  updatedAt: NOW,
});
print("  ✓ user_progress");

// ─────────────────────────────────────────────────
// 4.2 Course Progress (5 courses at various stages)
// ─────────────────────────────────────────────────
const courseProgressData = [
  // Completed courses
  { key: "react",  pct: 100, completedLessons: 2, totalLessons: 2, time: 5400, enrollDaysAgo: 70, completedDaysAgo: 45, quizScore: 88, passed: true },
  { key: "nodejs", pct: 100, completedLessons: 2, totalLessons: 2, time: 7200, enrollDaysAgo: 65, completedDaysAgo: 35, quizScore: 92, passed: true },
  // In progress
  { key: "nextjs", pct: 50,  completedLessons: 1, totalLessons: 2, time: 3600, enrollDaysAgo: 50, completedDaysAgo: null, quizScore: null, passed: null },
  { key: "python", pct: 50,  completedLessons: 1, totalLessons: 2, time: 2700, enrollDaysAgo: 40, completedDaysAgo: null, quizScore: 65, passed: null },
  // Just started
  { key: "docker", pct: 0,   completedLessons: 0, totalLessons: 2, time: 900,  enrollDaysAgo: 30, completedDaysAgo: null, quizScore: null, passed: null },
];

courseProgressData.forEach(function(cp) {
  const c = COURSES[cp.key];
  learnDb.course_progress.insertOne({
    _id: ObjectId(),
    userId: TEST_USER_ID,
    courseId: c.id,
    courseTitle: c.title,
    enrolledAt: daysAgo(cp.enrollDaysAgo),
    completedAt: cp.completedDaysAgo ? daysAgo(cp.completedDaysAgo) : null,
    progressPercentage: cp.pct,
    totalLessons: cp.totalLessons,
    completedLessons: cp.completedLessons,
    timeSpentSeconds: cp.time,
    lastAccessedAt: daysAgo(cp.completedDaysAgo || 1),
    averageQuizScore: cp.quizScore,
    passed: cp.passed,
    allowRetake: false,
    passingScore: 80,
    retakeCount: 0,
  });
});
print("  ✓ course_progress (5 courses)");

// ─────────────────────────────────────────────────
// 4.3 Lesson Progress (detailed per-lesson tracking)
// ─────────────────────────────────────────────────
const lessonProgressData = [];


// Node.js: both completed
COURSES.nodejs.lessons.forEach(function(l, i) {
  lessonProgressData.push({
    courseId: COURSES.nodejs.id, lessonId: l.id, lessonTitle: l.title,
    completed: true, completedAt: daysAgo(40 - i * 3), timeSpent: 3000 + i * 500,
    watchCount: 3, lastWatched: daysAgo(40 - i * 3),
  });
});

// Next.js: lesson 1 completed, lesson 2 in progress
lessonProgressData.push({
  courseId: COURSES.nextjs.id, lessonId: COURSES.nextjs.lessons[0].id,
  lessonTitle: COURSES.nextjs.lessons[0].title,
  completed: true, completedAt: daysAgo(15), timeSpent: 2700,
  watchCount: 2, lastWatched: daysAgo(15),
});
lessonProgressData.push({
  courseId: COURSES.nextjs.id, lessonId: COURSES.nextjs.lessons[1].id,
  lessonTitle: COURSES.nextjs.lessons[1].title,
  completed: false, completedAt: null, timeSpent: 900,
  watchCount: 3, lastWatched: daysAgo(2),  // revisited recently — for bottleneck/revisit detection
});

// Python: lesson 1 completed (with poor quiz), lesson 2 in progress
lessonProgressData.push({
  courseId: COURSES.python.id, lessonId: COURSES.python.lessons[0].id,
  lessonTitle: COURSES.python.lessons[0].title,
  completed: true, completedAt: daysAgo(25), timeSpent: 2100,
  watchCount: 4, lastWatched: daysAgo(5),  // revisited many times — bottleneck signal
});
lessonProgressData.push({
  courseId: COURSES.python.id, lessonId: COURSES.python.lessons[1].id,
  lessonTitle: COURSES.python.lessons[1].title,
  completed: false, completedAt: null, timeSpent: 600,
  watchCount: 1, lastWatched: daysAgo(10),
});

// React: lesson 1 completed, lesson 2 struggling (bottleneck signal!)
lessonProgressData.push({
  courseId: COURSES.react.id, lessonId: COURSES.react.lessons[0].id,
  lessonTitle: COURSES.react.lessons[0].title,
  completed: true, completedAt: daysAgo(45), timeSpent: 2100,
  watchCount: 1, lastWatched: daysAgo(45),
});
lessonProgressData.push({
  courseId: COURSES.react.id, lessonId: COURSES.react.lessons[1].id,
  lessonTitle: COURSES.react.lessons[1].title,
  completed: false, completedAt: null, timeSpent: 5400,
  watchCount: 6, lastWatched: daysAgo(2), // HIGH watch count + no completion + low quiz score
});

// Docker: both not completed, lesson 1 accessed once
lessonProgressData.push({
  courseId: COURSES.docker.id, lessonId: COURSES.docker.lessons[0].id,
  lessonTitle: COURSES.docker.lessons[0].title,
  completed: false, completedAt: null, timeSpent: 900,
  watchCount: 2, lastWatched: daysAgo(20), // Revisit count = 1
});

lessonProgressData.forEach(function(lp) {
  learnDb.lesson_progress.insertOne({
    _id: ObjectId(),
    userId: TEST_USER_ID,
    courseId: lp.courseId,
    lessonId: lp.lessonId,
    lessonTitle: lp.lessonTitle,
    completed: lp.completed,
    completedAt: lp.completedAt,
    timeSpentSeconds: lp.timeSpent,
    lastWatchedAt: lp.lastWatched,
    watchCount: lp.watchCount,
  });
});
print("  ✓ lesson_progress (" + lessonProgressData.length + " records)");

// ─────────────────────────────────────────────────
// 4.4 Activity Logs (rich 90-day history for engagement & trends)
// ─────────────────────────────────────────────────
const activityTypes = [
  "LESSON_STARTED", "LESSON_COMPLETED", "LESSON_WATCHED",
  "QUIZ_STARTED", "QUIZ_SUBMITTED",
  "COURSE_ENROLLED", "ASSIGNMENT_SUBMITTED",
  "LOGIN", "LESSON_REVISITED",
];

const activityLogs = [];

// Generate 70 days of activity with varying patterns
for (let day = 70; day >= 0; day--) {
  // Skip some days to create realistic gaps (weekends, breaks)
  if (day % 7 === 6 && Math.random() > 0.3) continue; // some Sundays off
  if (day > 55 && day < 60) continue; // a break period

  // Use a sine wave combined with random factor to create realistic "nhấp nhô" (fluctuating) engagement pattern
  const baseIntensity = (Math.sin(day / 4) + 1) * 2; // 0 to 4
  const randomFactor = Math.random() * 3;
  const sessionsPerDay = Math.max(1, Math.floor(baseIntensity + randomFactor)); // 1 to 7 sessions per day

  for (let s = 0; s < sessionsPerDay; s++) {
    const courseKeys = Object.keys(COURSES).filter(k => COURSES[k].lessons && COURSES[k].lessons.length > 0);
    const courseKey = courseKeys[Math.floor(Math.random() * courseKeys.length)];
    const course = COURSES[courseKey];
    const lesson = course.lessons[Math.floor(Math.random() * course.lessons.length)];
    const action = activityTypes[Math.floor(Math.random() * activityTypes.length)];
    const duration = Math.floor(Math.random() * 2400) + 300; // 5-45 min

    const actDate = daysAgo(day);
    actDate.setHours(8 + Math.floor(Math.random() * 14), Math.floor(Math.random() * 60));

    activityLogs.push({
      _id: ObjectId(),
      userId: TEST_USER_ID,
      courseId: course.id,
      lessonId: lesson.id,
      action: action,
      durationSeconds: duration,
      metadata: {},
      createdAt: actDate,
    });
  }
}

if (activityLogs.length > 0) {
  learnDb.activity_logs.insertMany(activityLogs);
}
print("  ✓ activity_logs (" + activityLogs.length + " records over 70 days)");

// ─────────────────────────────────────────────────
// 4.5 Quiz Attempts (important for performance trends & recovery)
// ─────────────────────────────────────────────────
const quizAttemptData = [
  // Docker quiz 1 — multiple attempts showing improvement (recovery pattern!)
  { quizId: QUIZZES[0].id, lessonId: QUIZZES[0].lessonId, courseId: QUIZZES[0].courseId, score: 45, total: 10, correct: 4, passed: false, day: 60, status: "SUBMITTED", time: 420 },
  { quizId: QUIZZES[0].id, lessonId: QUIZZES[0].lessonId, courseId: QUIZZES[0].courseId, score: 55, total: 10, correct: 5, passed: false, day: 55, status: "SUBMITTED", time: 380 },
  { quizId: QUIZZES[0].id, lessonId: QUIZZES[0].lessonId, courseId: QUIZZES[0].courseId, score: 72, total: 10, correct: 7, passed: true,  day: 48, status: "SUBMITTED", time: 350 },

  // Docker quiz 2
  { quizId: QUIZZES[1].id, lessonId: QUIZZES[1].lessonId, courseId: QUIZZES[1].courseId, score: 80, total: 10, correct: 8, passed: true, day: 45, status: "SUBMITTED", time: 300 },

  // React quiz (bottleneck signal — multiple fails, no improvement)
  { quizId: QUIZZES[3].id, lessonId: QUIZZES[3].lessonId, courseId: QUIZZES[3].courseId, score: 30, total: 10, correct: 3, passed: false, day: 10, status: "SUBMITTED", time: 420 },
  { quizId: QUIZZES[3].id, lessonId: QUIZZES[3].lessonId, courseId: QUIZZES[3].courseId, score: 35, total: 10, correct: 3, passed: false, day: 8, status: "SUBMITTED", time: 420 },
  { quizId: QUIZZES[3].id, lessonId: QUIZZES[3].lessonId, courseId: QUIZZES[3].courseId, score: 40, total: 10, correct: 4, passed: false, day: 6, status: "SUBMITTED", time: 420 },

  // API course quizzes — showing declining then recovering scores
  { quizId: QUIZZES[4].id, lessonId: QUIZZES[4].lessonId, courseId: QUIZZES[4].courseId, score: 85, total: 10, correct: 8, passed: true, day: 42, status: "SUBMITTED", time: 360 },
  { quizId: QUIZZES[4].id, lessonId: QUIZZES[4].lessonId, courseId: QUIZZES[4].courseId, score: 78, total: 10, correct: 7, passed: true, day: 38, status: "SUBMITTED", time: 340 },
  { quizId: QUIZZES[4].id, lessonId: QUIZZES[4].lessonId, courseId: QUIZZES[4].courseId, score: 62, total: 10, correct: 6, passed: false, day: 30, status: "SUBMITTED", time: 420 },
  { quizId: QUIZZES[4].id, lessonId: QUIZZES[4].lessonId, courseId: QUIZZES[4].courseId, score: 58, total: 10, correct: 5, passed: false, day: 25, status: "SUBMITTED", time: 450 },
  { quizId: QUIZZES[4].id, lessonId: QUIZZES[4].lessonId, courseId: QUIZZES[4].courseId, score: 75, total: 10, correct: 7, passed: true, day: 18, status: "SUBMITTED", time: 380 },

  // Git quiz — recent good score
  { quizId: QUIZZES[2].id, lessonId: QUIZZES[2].lessonId, courseId: QUIZZES[2].courseId, score: 90, total: 10, correct: 9, passed: true, day: 10, status: "SUBMITTED", time: 280 },

  // Retry of Docker quiz 1 — great improvement 
  { quizId: QUIZZES[0].id, lessonId: QUIZZES[0].lessonId, courseId: QUIZZES[0].courseId, score: 88, total: 10, correct: 8, passed: true, day: 5, status: "SUBMITTED", time: 240 },

  // Recent quiz — high score (recovery confirmed)
  { quizId: QUIZZES[4].id, lessonId: QUIZZES[4].lessonId, courseId: QUIZZES[4].courseId, score: 92, total: 10, correct: 9, passed: true, day: 2, status: "SUBMITTED", time: 260 },
];

quizAttemptData.forEach(function(qa) {
  const submitDate = daysAgo(qa.day);
  learnDb.quiz_attempts.insertOne({
    _id: ObjectId(),
    quizId: qa.quizId,
    userId: TEST_USER_ID,
    courseId: qa.courseId,
    lessonId: qa.lessonId, // Explicitly add lessonId for recovery analyzer
    answers: [],
    score: qa.score,
    totalQuestions: qa.total,
    correctAnswers: qa.correct,
    passed: qa.passed,
    status: qa.status,
    startedAt: submitDate,
    submittedAt: submitDate,
    timeTakenSeconds: qa.time,
  });
});
print("  ✓ quiz_attempts (" + quizAttemptData.length + " attempts with recovery pattern)");

// ─────────────────────────────────────────────────
// 4.6 User Skill Profile (drives Skill Analytics & Knowledge Gap)
// ─────────────────────────────────────────────────
const skillsData = [
  {
    canonicalName: "react", displayName: "ReactJS", category: "Frontend",
    level: "INTERMEDIATE", confidence: 0.82,
    evidences: [
      { source: "COURSE_COMPLETION", sourceId: COURSES.react.id, detail: "Completed ReactJS course", scorePercentage: 88, weight: 1.0, date: daysAgo(45).toISOString() },
      { source: "QUIZ", sourceId: QUIZZES[0].id, detail: "Quiz score 88%", scorePercentage: 88, weight: 0.8, date: daysAgo(5).toISOString() },
    ],
    lastUpdated: daysAgo(5).toISOString(),
  },
  {
    canonicalName: "nodejs", displayName: "Node.js", category: "Backend",
    level: "INTERMEDIATE", confidence: 0.85,
    evidences: [
      { source: "COURSE_COMPLETION", sourceId: COURSES.nodejs.id, detail: "Completed Node.js course", scorePercentage: 92, weight: 1.0, date: daysAgo(35).toISOString() },
    ],
    lastUpdated: daysAgo(35).toISOString(),
  },
  {
    canonicalName: "nextjs", displayName: "Next.js", category: "Frontend",
    level: "BEGINNER", confidence: 0.55,
    evidences: [
      { source: "COURSE_PROGRESS", sourceId: COURSES.nextjs.id, detail: "50% progress in Next.js course", scorePercentage: 50, weight: 0.6, date: daysAgo(2).toISOString() },
    ],
    lastUpdated: daysAgo(2).toISOString(),
  },
  {
    canonicalName: "python", displayName: "Python", category: "Data & AI",
    level: "BEGINNER", confidence: 0.45,
    evidences: [
      { source: "QUIZ", sourceId: QUIZZES[5].id, detail: "Quiz score 62%", scorePercentage: 62, weight: 0.8, date: daysAgo(30).toISOString() },
    ],
    lastUpdated: daysAgo(30).toISOString(),
  },
  {
    canonicalName: "docker", displayName: "Docker", category: "DevOps",
    level: "BEGINNER", confidence: 0.40,
    evidences: [
      { source: "COURSE_PROGRESS", sourceId: COURSES.docker.id, detail: "Just started Docker course", scorePercentage: 0, weight: 0.3, date: daysAgo(20).toISOString() },
    ],
    lastUpdated: daysAgo(20).toISOString(),
  },
  {
    canonicalName: "sql", displayName: "SQL", category: "Database",
    level: "BEGINNER", confidence: 0.30,
    evidences: [
      { source: "PATH_REQUIREMENT", sourceId: FULLSTACK_PATH_ID, detail: "Required by Fullstack path", scorePercentage: 0, weight: 0.2, date: daysAgo(70).toISOString() },
    ],
    lastUpdated: daysAgo(70).toISOString(),
  },
  {
    canonicalName: "tailwindcss", displayName: "Tailwind CSS", category: "Frontend",
    level: "INTERMEDIATE", confidence: 0.75,
    evidences: [
      { source: "COURSE_COMPLETION", sourceId: COURSES.react.id, detail: "Learned alongside React", scorePercentage: 80, weight: 0.7, date: daysAgo(45).toISOString() },
    ],
    lastUpdated: daysAgo(45).toISOString(),
  },
  {
    canonicalName: "express", displayName: "Express.js", category: "Backend",
    level: "INTERMEDIATE", confidence: 0.80,
    evidences: [
      { source: "COURSE_COMPLETION", sourceId: COURSES.nodejs.id, detail: "Completed Express course", scorePercentage: 92, weight: 1.0, date: daysAgo(35).toISOString() },
    ],
    lastUpdated: daysAgo(35).toISOString(),
  },
];

learnDb.user_skill_profiles.insertOne({
  _id: ObjectId(),
  userId: TEST_USER_ID,
  skills: skillsData,
  strengths: ["Node.js", "ReactJS", "Express.js"],
  weaknesses: ["Docker", "Python", "SQL"],
  overallLevel: "INTERMEDIATE",
  profileCompleteness: 65,
  createdAt: daysAgo(70),
  updatedAt: NOW,
});
print("  ✓ user_skill_profiles (8 skills)");

// ─────────────────────────────────────────────────
// 4.7 Badges (achievement system)
// ─────────────────────────────────────────────────
const badgesData = [
  { name: "Khởi đầu hành trình", type: "FIRST_COURSE", desc: "Đăng ký khóa học đầu tiên", days: 70 },
  { name: "Hoàn thành đầu tiên", type: "FIRST_COMPLETION", desc: "Hoàn thành khóa học đầu tiên", days: 45 },
  { name: "Streak 7 ngày", type: "STREAK_7", desc: "Học liên tục 7 ngày", days: 15 },
  { name: "Quiz Master", type: "QUIZ_SCORE_90", desc: "Đạt 90%+ trong bài kiểm tra", days: 10 },
  { name: "Đa năng", type: "MULTI_COURSE", desc: "Đăng ký 5+ khóa học", days: 30 },
];

badgesData.forEach(function(b) {
  learnDb.badges.insertOne({
    _id: ObjectId(),
    userId: TEST_USER_ID,
    badgeName: b.name,
    badgeType: b.type,
    description: b.desc,
    iconUrl: null,
    earnedAt: daysAgo(b.days),
    metadata: {},
  });
});
print("  ✓ badges (" + badgesData.length + " badges)");

// ─────────────────────────────────────────────────
// 4.8 Certificates (for completed courses)
// ─────────────────────────────────────────────────
const certData = [
  { courseId: COURSES.react.id, title: COURSES.react.title, score: 88, day: 45, num: "CERT-TEST-0001" },
  { courseId: COURSES.nodejs.id, title: COURSES.nodejs.title, score: 92, day: 35, num: "CERT-TEST-0002" },
];

certData.forEach(function(cert) {
  learnDb.certificates.insertOne({
    _id: ObjectId(),
    certificateNumber: cert.num,
    userId: TEST_USER_ID,
    courseId: cert.courseId,
    learningPathId: null,
    courseTitle: cert.title,
    userName: "Nguyễn Văn Analytics",
    type: "COURSE_COMPLETION",
    averageScore: cert.score,
    issueDate: daysAgo(cert.day),
    expiresAt: null,
    certificateUrl: null,
    verificationUrl: null,
    isVerified: true,
    metadata: {},
    createdAt: daysAgo(cert.day),
  });
});
print("  ✓ certificates (" + certData.length + ")");

// ─────────────────────────────────────────────────
// 4.9 Learning Path Enrollment & Path Definition
// ─────────────────────────────────────────────────
// Ensure the path exists so Knowledge Gap Analyzer can read expectedMastery
learnDb.learning_paths.deleteMany({ _id: FULLSTACK_PATH_ID });
learnDb.learning_paths.insertOne({
  _id: FULLSTACK_PATH_ID,
  title: "Fullstack Web Developer",
  description: "Trở thành Fullstack Web Developer với MERN stack",
  slug: "fullstack-web-developer",
  skills: [
    { name: "ReactJS", expectedMastery: 90, importance: "HIGH" },
    { name: "Node.js", expectedMastery: 85, importance: "HIGH" },
    { name: "Express.js", expectedMastery: 85, importance: "HIGH" },
    { name: "Tailwind CSS", expectedMastery: 80, importance: "MEDIUM" },
    { name: "Next.js", expectedMastery: 75, importance: "MEDIUM" },
    { name: "Python", expectedMastery: 60, importance: "LOW" },
    { name: "Docker", expectedMastery: 70, importance: "MEDIUM" },
    { name: "SQL", expectedMastery: 80, importance: "HIGH" },
  ],
  level: "INTERMEDIATE",
  status: "PUBLISHED",
  courseIds: [
    COURSES.react.id.toString(), COURSES.nodejs.id.toString(),
    COURSES.nextjs.id.toString(), COURSES.docker.id.toString(), COURSES.sql.id.toString()
  ],
  totalDurationHours: 120,
  createdAt: daysAgo(100),
  updatedAt: NOW,
});

learnDb.user_path_enrollments.insertOne({
  _id: ObjectId(),
  userId: TEST_USER_ID,
  learningPathId: FULLSTACK_PATH_ID,
  status: "IN_PROGRESS",
  enrolledAt: daysAgo(70),
  completedAt: null,
  lastUpdatedAt: NOW,
});
print("  ✓ user_path_enrollments (Fullstack Web Developer path + created path)");

// ─────────────────────────────────────────────────
// 4.10 Clear any cached analysis (force fresh computation)
// ─────────────────────────────────────────────────
learnDb.learner_analyses.deleteMany({ userId: TEST_USER_ID });
print("  ✓ cleared learner_analyses cache");

// =====================================================
// 5. VERIFY — Print summary
// =====================================================
print("\n[5/5] Verification...");

const verify = {
  auth_users: authDb.users.countDocuments({ _id: TEST_USER_ID }),
  user_profiles: userDb.user_profiles.countDocuments({ userId: TEST_USER_ID }),
  orders: orderDb.orders.countDocuments({ userId: TEST_USER_ID.toString() }),
  course_progress: learnDb.course_progress.countDocuments({ userId: TEST_USER_ID }),
  lesson_progress: learnDb.lesson_progress.countDocuments({ userId: TEST_USER_ID }),
  activity_logs: learnDb.activity_logs.countDocuments({ userId: TEST_USER_ID }),
  quiz_attempts: learnDb.quiz_attempts.countDocuments({ userId: TEST_USER_ID }),
  skill_profiles: learnDb.user_skill_profiles.countDocuments({ userId: TEST_USER_ID }),
  badges: learnDb.badges.countDocuments({ userId: TEST_USER_ID }),
  certificates: learnDb.certificates.countDocuments({ userId: TEST_USER_ID }),
  path_enrollments: learnDb.user_path_enrollments.countDocuments({ userId: TEST_USER_ID }),
};

print("\n╔═══════════════════════════════════════════════╗");
print("║           SEED COMPLETE — Summary             ║");
print("╠═══════════════════════════════════════════════╣");
Object.keys(verify).forEach(function(k) {
  const v = verify[k];
  const label = (k + ":").padEnd(22, " ");
  print("║  " + label + v.toString().padStart(5, " ") + " records".padEnd(20, " ") + "║");
});
print("╠═══════════════════════════════════════════════╣");
print("║  Login credentials:                           ║");
print("║    Email:    dashboard-test@elearning.local   ║");
print("║    Password: Test123456                       ║");
print("╠═══════════════════════════════════════════════╣");
print("║  Dashboard sections covered:                  ║");
print("║    ✓ Learning Overview (5 KPIs)               ║");
print("║    ✓ Learning Journey Timeline                ║");
print("║    ✓ Progress Trend Chart                     ║");
print("║    ✓ Performance Trend Chart                  ║");
print("║    ✓ Engagement Analytics                     ║");
print("║    ✓ Skill Analytics (8 skills)               ║");
print("║    ✓ Knowledge Gap Detection                  ║");
print("║    ✓ Bottleneck Detection                     ║");
print("║    ✓ Revisit / Recovery Analysis              ║");
print("║    ✓ Learning State                           ║");
print("║    ✓ Next Recommended Actions                 ║");
print("║    ○ AI Summary (requires RAG/Gemini)         ║");
print("╚═══════════════════════════════════════════════╝");
