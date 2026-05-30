const { PrismaClient } = require('@prisma/client');
const axios = require('axios');

const prisma = new PrismaClient();

async function main() {
  const courseServiceUrl = process.env.COURSE_SERVICE_URL || 'http://localhost:3003';
  
  console.log('Fetching available courses from course-service...');
  let courses = [];
  try {
    const response = await axios.get(`${courseServiceUrl}/api/courses?limit=100`);
    courses = response.data.courses || [];
    console.log(`Found ${courses.length} courses in course-service.`);
  } catch (err) {
    console.error('Failed to fetch courses from course-service. Seed might create paths with empty course IDs.', err.message);
  }

  // 1. Filter Web courses
  const webKeywords = ['html', 'css', 'javascript', 'react', 'node', 'express', 'web', 'frontend', 'backend'];
  const webCourses = courses
    .filter((c) => {
      const title = c.title.toLowerCase();
      return webKeywords.some((keyword) => title.includes(keyword));
    })
    .sort((a, b) => {
      const aTitle = a.title.toLowerCase();
      const bTitle = b.title.toLowerCase();
      if (aTitle.includes('html') || aTitle.includes('css')) return -1;
      if (bTitle.includes('html') || bTitle.includes('css')) return 1;
      if (aTitle.includes('javascript')) return -1;
      if (bTitle.includes('javascript')) return 1;
      return 0;
    });

  const webCourseIds = webCourses.map((c) => c.id);

  // 2. Filter Data Science courses
  const dataKeywords = ['python', 'data', 'sql', 'machine', 'learning', 'ai', 'deep', 'analyst'];
  const dataCourses = courses
    .filter((c) => {
      const title = c.title.toLowerCase();
      return dataKeywords.some((keyword) => title.includes(keyword)) && !webCourseIds.includes(c.id);
    })
    .sort((a, b) => {
      const aTitle = a.title.toLowerCase();
      const bTitle = b.title.toLowerCase();
      if (aTitle.includes('python') || aTitle.includes('sql')) return -1;
      if (bTitle.includes('python') || bTitle.includes('sql')) return 1;
      return 0;
    });

  const dataCourseIds = dataCourses.map((c) => c.id);

  // Fallback: If no courses found, try to fetch some default IDs or use placeholders
  const finalWebIds = webCourseIds.length > 0 ? webCourseIds : (courses.slice(0, 3).map(c => c.id).length > 0 ? courses.slice(0, 3).map(c => c.id) : ['65f1234567890abcdef00001', '65f1234567890abcdef00002']);
  const finalDataIds = dataCourseIds.length > 0 ? dataCourseIds : (courses.slice(3, 6).map(c => c.id).length > 0 ? courses.slice(3, 6).map(c => c.id) : ['65f1234567890abcdef00003', '65f1234567890abcdef00004']);

  console.log('Seeding learning paths...');

  // Create Web Developer Roadmap
  await prisma.learningPath.upsert({
    where: { slug: 'fullstack-web-developer' },
    update: {
      courseIds: finalWebIds,
      category: 'Công nghệ thông tin',
      difficulty: 'ALL',
    },
    create: {
      title: 'Lập trình viên Web Chuyên nghiệp (Fullstack Developer)',
      description: 'Lộ trình toàn diện đi từ cơ bản đến nâng cao. Học cách xây dựng giao diện người dùng đẹp mắt với HTML/CSS/JS, lập trình ứng dụng SPA hiện đại bằng React, xây dựng backend mạnh mẽ với Node.js/Express và kết nối cơ sở dữ liệu MongoDB.',
      slug: 'fullstack-web-developer',
      category: 'Công nghệ thông tin',
      difficulty: 'ALL',
      courseIds: finalWebIds,
      imageUrl: 'https://images.unsplash.com/photo-1517694712202-14dd9538aa97?q=80&w=600&auto=format&fit=crop',
    },
  });

  // Create Data Science Roadmap
  await prisma.learningPath.upsert({
    where: { slug: 'data-science-expert' },
    update: {
      courseIds: finalDataIds,
      category: 'Công nghệ thông tin',
      difficulty: 'ALL',
    },
    create: {
      title: 'Chuyên gia Khoa học Dữ liệu (Data Science Expert)',
      description: 'Chinh phục thế giới dữ liệu lớn và Trí tuệ Nhân tạo. Bắt đầu với ngôn ngữ Python, phân tích cơ sở dữ liệu nâng cao với SQL, học cách trực quan hóa thông tin và áp dụng các thuật toán Học máy (Machine Learning) để giải quyết bài toán thực tế.',
      slug: 'data-science-expert',
      category: 'Công nghệ thông tin',
      difficulty: 'ALL',
      courseIds: finalDataIds,
      imageUrl: 'https://images.unsplash.com/photo-1551288049-bebda4e38f71?q=80&w=600&auto=format&fit=crop',
    },
  });

  console.log('Seeding learning paths successfully completed!');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
