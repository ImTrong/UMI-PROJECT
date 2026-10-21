const { MongoClient } = require('mongodb');

async function analyzeCatalog() {
  const uri = process.env.DATABASE_URL || 'mongodb://admin:securepassword123@localhost:27017/?authSource=admin';
  const client = new MongoClient(uri);

  try {
    await client.connect();
    const courseDb = client.db('course_db');
    const courses = await courseDb.collection('courses').find({}).toArray();
    const lessons = await courseDb.collection('lessons').find({}).toArray();

    console.log(`\n=== PHÂN TÍCH DANH MỤC KHÓA HỌC THỰC TẾ (${courses.length} KHÓA HỌC) ===\n`);

    // Map courseId -> totalDurationSeconds from lessons
    const durationMap = {};
    const lessonCountMap = {};

    for (const l of lessons) {
      const cId = l.courseId ? l.courseId.toString() : '';
      if (!durationMap[cId]) {
        durationMap[cId] = 0;
        lessonCountMap[cId] = 0;
      }
      const dur = Number(l.duration) || 0;
      if (dur > 0) {
        durationMap[cId] += Math.floor(dur);
      }
      lessonCountMap[cId]++;
    }

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
      // 1 base point per 1800s (30 mins), capped at 40 points (20 hours)
      return Math.min(40, Math.round((seconds / 1800) * 100) / 100);
    }

    const tierDistribution = {
      '<30m': 0,
      '30m-<2h': 0,
      '2h-<5h': 0,
      '5h-<10h': 0,
      '10h-<20h': 0,
      '>=20h': 0,
      '0s_or_missing': 0
    };

    const courseStats = [];

    for (const c of courses) {
      const cId = c._id.toString();
      const durSeconds = durationMap[cId] || Number(c.totalDuration) || 0;
      const lessonCount = lessonCountMap[cId] || 0;
      const level = (c.level || 'BEGINNER').toUpperCase();
      const mult = levelMultipliers[level] || 1.0;

      if (durSeconds <= 0) tierDistribution['0s_or_missing']++;
      else if (durSeconds < 1800) tierDistribution['<30m']++;
      else if (durSeconds < 7200) tierDistribution['30m-<2h']++;
      else if (durSeconds < 18000) tierDistribution['2h-<5h']++;
      else if (durSeconds < 36000) tierDistribution['5h-<10h']++;
      else if (durSeconds < 72000) tierDistribution['10h-<20h']++;
      else tierDistribution['>=20h']++;

      const baseTier = getTierPoints(durSeconds);
      const pointsTier = Math.round(baseTier * mult * 100) / 100;

      const baseCont = getContinuousPoints(durSeconds);
      const pointsCont = Math.round(baseCont * mult * 100) / 100;

      courseStats.push({
        id: cId,
        title: c.title,
        level,
        mult,
        durSeconds,
        durHours: Math.round((durSeconds / 3600) * 100) / 100,
        lessonCount,
        baseTier,
        pointsTier,
        baseCont,
        pointsCont,
        diff: Math.round((pointsCont - pointsTier) * 100) / 100
      });
    }

    console.log('--- PHÂN BỐ KHÓA HỌC THEO CÁC NGƯỠNG HIỆN TẠI ---');
    console.table(tierDistribution);

    console.log('\n--- MẪU 15 KHÓA HỌC SO SÁNH GIỮA 2 CÔNG THỨC ---');
    console.table(
      courseStats.slice(0, 15).map(c => ({
        'Tên khóa học': c.title.slice(0, 30),
        'Cấp độ': c.level,
        'Số bài': c.lessonCount,
        'Thời lượng (h)': c.durHours,
        'Điểm bậc (cũ)': c.pointsTier,
        'Điểm liên tục (mới)': c.pointsCont,
        'Chênh lệch': c.diff
      }))
    );

    // Tìm các trường hợp sát ngưỡng để so sánh bước nhảy
    console.log('\n--- CÁC KHÓA GẦN NGƯỠNG ĐỂ THẤY BƯỚC NHẢY BẤT CÔNG Ở CÔNG THỨC BẬC ---');
    const borderExamples = [
      { name: 'Khóa 29 phút (1.740s)', sec: 1740, lvl: 'BEGINNER' },
      { name: 'Khóa 30 phút (1.800s)', sec: 1800, lvl: 'BEGINNER' },
      { name: 'Khóa 1 giờ 59 phút (7.140s)', sec: 7140, lvl: 'BEGINNER' },
      { name: 'Khóa 2 giờ 00 phút (7.200s)', sec: 7200, lvl: 'BEGINNER' },
      { name: 'Khóa 4 giờ 59 phút (17.940s)', sec: 17940, lvl: 'INTERMEDIATE' },
      { name: 'Khóa 5 giờ 00 phút (18.000s)', sec: 18000, lvl: 'INTERMEDIATE' },
      { name: 'Khóa 9 giờ 59 phút (35.940s)', sec: 35940, lvl: 'ADVANCED' },
      { name: 'Khóa 10 giờ 00 phút (36.000s)', sec: 36000, lvl: 'ADVANCED' },
    ];

    console.table(borderExamples.map(e => {
      const bTier = getTierPoints(e.sec);
      const mult = levelMultipliers[e.lvl];
      const pTier = Math.round(bTier * mult * 100) / 100;
      const bCont = getContinuousPoints(e.sec);
      const pCont = Math.round(bCont * mult * 100) / 100;
      return {
        'Kịch bản sát ngưỡng': e.name,
        'Cấp độ': e.lvl,
        'Điểm bậc (cũ)': pTier,
        'Điểm liên tục (mới)': pCont,
        'Ghi chú': pCont > pTier ? 'Tăng xứng đáng' : 'Mịn màng, không bước nhảy sốc'
      };
    }));

  } finally {
    await client.close();
  }
}

analyzeCatalog().catch(console.error);
