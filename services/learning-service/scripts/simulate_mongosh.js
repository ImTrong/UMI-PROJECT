const courseDb = db.getSiblingDB('course_db');
const courses = courseDb.courses.find({}).toArray();
const lessons = courseDb.lessons.find({}).toArray();

print("\n================================================================================");
print(" UMI E-LEARNING: PHÂN TÍCH DANH MỤC KHÓA HỌC THỰC TẾ & MÔ PHỎNG TÍNH ĐIỂM");
print("================================================================================\n");
print("Tổng số khóa học trong cơ sở dữ liệu course_db: " + courses.length);
print("Tổng số bài học trong cơ sở dữ liệu course_db: " + lessons.length);

const durationMap = {};
const lessonCountMap = {};

lessons.forEach(l => {
  const cId = l.courseId ? l.courseId.toString() : '';
  if (!durationMap[cId]) {
    durationMap[cId] = 0;
    lessonCountMap[cId] = 0;
  }
  const dur = Number(l.duration) || 0;
  if (dur > 0) durationMap[cId] += Math.floor(dur);
  lessonCountMap[cId]++;
});

const levelMultipliers = {
  BEGINNER: 1.0,
  INTERMEDIATE: 1.1,
  ADVANCED: 1.2
};

function getTierPoints(seconds) {
  if (seconds <= 0) return 0;
  if (seconds < 1800) return 2;
  if (seconds < 7200) return 5;
  if (seconds < 18000) return 10;
  if (seconds < 36000) return 20;
  if (seconds < 72000) return 30;
  return 40;
}

function getContinuousPoints(seconds) {
  if (seconds <= 0) return 0;
  // min(40, totalDurationSeconds / 1800)
  const base = Math.min(40, seconds / 1800);
  return Math.round(base * 100) / 100;
}

const tierCounts = {
  '< 30 phút': 0,
  '30 phút - < 2 giờ': 0,
  '2 giờ - < 5 giờ': 0,
  '5 giờ - < 10 giờ': 0,
  '10 giờ - < 20 giờ': 0,
  '>= 20 giờ': 0,
  'Không có thời lượng (0s)': 0
};

const levelCounts = {
  BEGINNER: 0,
  INTERMEDIATE: 0,
  ADVANCED: 0,
  UNKNOWN: 0
};

const approvalCounts = {};

const courseList = [];

courses.forEach(c => {
  const cId = c._id.toString();
  const durSeconds = durationMap[cId] || Number(c.totalDuration) || 0;
  const lessonCount = lessonCountMap[cId] || 0;
  const level = (c.level || 'UNKNOWN').toUpperCase();
  const approval = c.approvalStatus || 'APPROVED';

  levelCounts[level] = (levelCounts[level] || 0) + 1;
  approvalCounts[approval] = (approvalCounts[approval] || 0) + 1;

  if (durSeconds <= 0) tierCounts['Không có thời lượng (0s)']++;
  else if (durSeconds < 1800) tierCounts['< 30 phút']++;
  else if (durSeconds < 7200) tierCounts['30 phút - < 2 giờ']++;
  else if (durSeconds < 18000) tierCounts['2 giờ - < 5 giờ']++;
  else if (durSeconds < 36000) tierCounts['5 giờ - < 10 giờ']++;
  else if (durSeconds < 72000) tierCounts['10 giờ - < 20 giờ']++;
  else tierCounts['>= 20 giờ']++;

  const mult = levelMultipliers[level] || 1.0;
  const pTier = Math.round(getTierPoints(durSeconds) * mult * 100) / 100;
  const pCont = Math.round(getContinuousPoints(durSeconds) * mult * 100) / 100;

  courseList.push({
    title: c.title,
    level: level,
    lessonCount: lessonCount,
    durSeconds: durSeconds,
    durHours: Math.round((durSeconds / 3600) * 100) / 100,
    pTier: pTier,
    pCont: pCont,
    diff: Math.round((pCont - pTier) * 100) / 100
  });
});

print("\n--- PHÂN BỐ CẤP ĐỘ KHÓA HỌC ---");
printjson(levelCounts);

print("\n--- TRẠNG THÁI KIỂM DUYỆT (APPROVAL STATUS) ---");
printjson(approvalCounts);

print("\n--- PHÂN BỐ THEO CÁC KHOẢNG THỜI LƯỢNG (HIỆN TẠI) ---");
printjson(tierCounts);

print("\n--- SO SÁNH ĐIỂM SỐ GIỮA CÔNG THỨC BẬC (V1.0) VÀ CÔNG THỨC LIÊN TỤC (V1.1) TRÊN 10 KHÓA THỰC TẾ ---");
courseList.slice(0, 10).forEach((c, idx) => {
  print((idx + 1) + ". " + c.title.padEnd(55) + " | " + c.level.padEnd(12) + " | " + (c.durHours + "h (" + c.durSeconds + "s)").padEnd(16) + " | Bậc: " + c.pTier.toString().padEnd(5) + " -> Liên tục: " + c.pCont.toString().padEnd(5) + " (diff: " + (c.diff >= 0 ? "+" : "") + c.diff + ")");
});

print("\n--- PHÂN TÍCH BƯỚC NHẢY CỦA CÔNG THỨC BẬC TẠI CÁC NGƯỠNG ---");
const testThresholds = [
  { label: 'Ngưỡng 30m: 1.799s (29m59s) vs 1.800s (30m)', s1: 1799, s2: 1800, lvl: 'BEGINNER' },
  { label: 'Ngưỡng 2h: 7.199s (1h59m59s) vs 7.200s (2h)', s1: 7199, s2: 7200, lvl: 'BEGINNER' },
  { label: 'Ngưỡng 5h: 17.999s (4h59m59s) vs 18.000s (5h)', s1: 17999, s2: 18000, lvl: 'INTERMEDIATE' },
  { label: 'Ngưỡng 10h: 35.999s (9h59m59s) vs 36.000s (10h)', s1: 35999, s2: 36000, lvl: 'ADVANCED' },
  { label: 'Ngưỡng 20h: 71.999s (19h59m59s) vs 72.000s (20h)', s1: 71999, s2: 72000, lvl: 'ADVANCED' },
];

testThresholds.forEach(t => {
  const mult = levelMultipliers[t.lvl];
  const t1 = Math.round(getTierPoints(t.s1) * mult * 100) / 100;
  const t2 = Math.round(getTierPoints(t.s2) * mult * 100) / 100;
  const c1 = Math.round(getContinuousPoints(t.s1) * mult * 100) / 100;
  const c2 = Math.round(getContinuousPoints(t.s2) * mult * 100) / 100;

  print("\n" + t.label + " (" + t.lvl + "):");
  print("   • Công thức bậc:     " + t1 + " đ  ->  " + t2 + " đ  (Bước nhảy đột ngột: " + (t2 - t1) + " đ chỉ vì 1 giây!)");
  print("   • Công thức liên tục: " + c1 + " đ  ->  " + c2 + " đ  (Tăng hoàn toàn mượt mà: +" + (Math.round((c2 - c1) * 100) / 100) + " đ)");
});

print("\n================================================================================\n");
