const courses = db.courses.find().toArray();
const lessons = db.lessons.find().toArray();

print("=== REAL COURSE CATALOG AUDIT ===");
print("Total courses in course_db: " + courses.length);
print("Total lessons in course_db: " + lessons.length);

const lessonsByCourse = {};
for (const l of lessons) {
  const cId = l.courseId ? l.courseId.toString() : 'unknown';
  if (!lessonsByCourse[cId]) lessonsByCourse[cId] = [];
  lessonsByCourse[cId].push(l);
}

let approvedPublished = 0;
let zeroDurationCount = 0;
let unverifiedLevelCount = 0;

const tiers = {
  under30m: 0,
  from30mTo2h: 0,
  from2hTo5h: 0,
  from5hTo10h: 0,
  above10h: 0,
};

const details = [];

for (const c of courses) {
  const cId = c._id.toString();
  const courseLessons = lessonsByCourse[cId] || [];

  let totalDuration = 0;
  for (const l of courseLessons) {
    const d = Number(l.duration);
    if (!isNaN(d) && d > 0) totalDuration += d;
  }

  if (c.approvalStatus === 'APPROVED' && c.published === true) {
    approvedPublished++;
  }

  if (totalDuration === 0) zeroDurationCount++;
  if (!c.level || !['BEGINNER', 'INTERMEDIATE', 'ADVANCED'].includes(c.level.toUpperCase())) {
    unverifiedLevelCount++;
  }

  if (totalDuration > 0 && totalDuration < 1800) tiers.under30m++;
  else if (totalDuration >= 1800 && totalDuration < 7200) tiers.from30mTo2h++;
  else if (totalDuration >= 7200 && totalDuration < 18000) tiers.from2hTo5h++;
  else if (totalDuration >= 18000 && totalDuration < 36000) tiers.from5hTo10h++;
  else if (totalDuration >= 36000) tiers.above10h++;

  details.push({
    id: cId,
    title: c.title,
    level: c.level,
    approvalStatus: c.approvalStatus,
    published: c.published,
    lessonCount: courseLessons.length,
    totalDurationSeconds: totalDuration,
    durationMinutes: Math.round(totalDuration / 60),
    lessons: courseLessons.map(l => ({ title: l.title, duration: l.duration }))
  });
}

print("\n--- Summary Statistics ---");
print("Approved & Published: " + approvedPublished + "/" + courses.length);
print("Zero Duration: " + zeroDurationCount);
print("Unverified Level: " + unverifiedLevelCount);
print("Duration Tiers:");
print("  - < 30 mins: " + tiers.under30m);
print("  - 30m - 2h:  " + tiers.from30mTo2h);
print("  - 2h - 5h:   " + tiers.from2hTo5h);
print("  - 5h - 10h:  " + tiers.from5hTo10h);
print("  - >= 10h:    " + tiers.above10h);

print("\n--- Sample Course Lesson Analysis (First 5 courses) ---");
for (let i = 0; i < Math.min(5, details.length); i++) {
  const d = details[i];
  print('Course [' + d.id + ']: "' + d.title + '" | Level: ' + d.level + ' | Status: ' + d.approvalStatus + ' | Lessons: ' + d.lessonCount + ' | Duration: ' + d.totalDurationSeconds + 's (' + d.durationMinutes + 'm)');
  d.lessons.forEach((l, idx) => {
    print('   Lesson ' + (idx + 1) + ': "' + l.title + '" - duration: ' + l.duration + 's');
  });
}

const sorted = details.sort((a, b) => b.totalDurationSeconds - a.totalDurationSeconds);
print("\n--- Longest Course in Database ---");
const longest = sorted[0];
print('Course [' + longest.id + ']: "' + longest.title + '" | Level: ' + longest.level + ' | Total: ' + longest.totalDurationSeconds + 's (' + longest.durationMinutes + 'm) | Lessons: ' + longest.lessonCount);
longest.lessons.forEach((l, idx) => {
  print('   Lesson ' + (idx + 1) + ': "' + l.title + '" - duration: ' + l.duration + 's');
});
