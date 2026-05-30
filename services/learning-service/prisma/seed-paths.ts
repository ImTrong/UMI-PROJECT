import { PrismaClient } from '@prisma/client';
import axios from 'axios';

const prisma = new PrismaClient();

const createSlug = (text: string) => {
  return text.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)+/g, '');
};

const images = [
  'https://images.unsplash.com/photo-1517694712202-14dd9538aa97?q=80&w=600&auto=format&fit=crop',
  'https://images.unsplash.com/photo-1551288049-bebda4e38f71?q=80&w=600&auto=format&fit=crop',
  'https://images.unsplash.com/photo-1512941937669-90a1b58e7e9c?q=80&w=600&auto=format&fit=crop',
  'https://images.unsplash.com/photo-1561070791-2526d30994b5?q=80&w=600&auto=format&fit=crop',
  'https://images.unsplash.com/photo-1533750516457-a7f992034fec?q=80&w=600&auto=format&fit=crop',
  'https://images.unsplash.com/photo-1618401471353-b98afee0b2eb?q=80&w=600&auto=format&fit=crop',
  'https://images.unsplash.com/photo-1460925895917-afdab827c52f?q=80&w=600&auto=format&fit=crop',
  'https://images.unsplash.com/photo-1522202176988-66273c2fd55f?q=80&w=600&auto=format&fit=crop',
  'https://images.unsplash.com/photo-1504639725590-34d0984388bd?q=80&w=600&auto=format&fit=crop',
  'https://images.unsplash.com/photo-1432888498266-38ffec3eaf0a?q=80&w=600&auto=format&fit=crop'
];

const pathsData = {
  'Lập trình': [
    { title: 'Fullstack Web Developer', desc: 'Lộ trình trở thành lập trình viên Web Fullstack toàn diện.', diff: 'ALL' },
    { title: 'Frontend React Master', desc: 'Chuyên gia Frontend với ReactJS và hệ sinh thái hiện đại.', diff: 'INTERMEDIATE' },
    { title: 'Backend Node.js Expert', desc: 'Chuyên gia xây dựng hệ thống Backend với Node.js.', diff: 'ADVANCED' },
    { title: 'Mobile App Developer', desc: 'Phát triển ứng dụng di động đa nền tảng.', diff: 'BEGINNER' },
    { title: 'Data Scientist', desc: 'Khai phá dữ liệu và Machine Learning với Python.', diff: 'ALL' },
    { title: 'DevOps & Cloud Engineer', desc: 'Kiến trúc sư hệ thống đám mây và tự động hóa CI/CD.', diff: 'ADVANCED' },
    { title: 'Java Spring Boot Microservices', desc: 'Xây dựng hệ thống siêu vi dịch vụ với Java Spring.', diff: 'ADVANCED' },
    { title: 'Golang Backend Developer', desc: 'Lập trình Backend hiệu năng cao với ngôn ngữ Go.', diff: 'INTERMEDIATE' },
    { title: 'C++ cho Game & Hệ thống', desc: 'Nền tảng C++ cho phát triển Game và phần mềm cốt lõi.', diff: 'BEGINNER' },
    { title: 'Cấu trúc dữ liệu & Thuật toán', desc: 'Nền tảng CS vững chắc để vượt qua mọi bài phỏng vấn.', diff: 'ALL' },
  ],
  'Thiết kế': [
    { title: 'UI/UX Designer Chuyên nghiệp', desc: 'Trở thành nhà thiết kế giao diện và trải nghiệm người dùng.', diff: 'ALL' },
    { title: 'Graphic Designer Cơ bản', desc: 'Nền tảng thiết kế đồ họa với Photoshop và Illustrator.', diff: 'BEGINNER' },
    { title: 'Chuyên gia Adobe Photoshop', desc: 'Làm chủ công cụ chỉnh sửa ảnh mạnh mẽ nhất thế giới.', diff: 'INTERMEDIATE' },
    { title: 'Chuyên gia Illustrator', desc: 'Sáng tạo logo và đồ họa vector chuyên nghiệp.', diff: 'INTERMEDIATE' },
    { title: 'Motion Graphics Cơ Bản', desc: 'Tạo hiệu ứng hình ảnh và chuyển động bắt mắt.', diff: 'ADVANCED' },
    { title: 'Video Editor Chuyên Nghiệp', desc: 'Dựng phim và chỉnh sửa video đỉnh cao.', diff: 'INTERMEDIATE' },
    { title: '3D Artist với Blender', desc: 'Thiết kế nhân vật và không gian 3D ấn tượng.', diff: 'ADVANCED' },
    { title: 'Thiết kế Bao bì Sản phẩm', desc: 'Nghệ thuật thiết kế bao bì tăng tỷ lệ chuyển đổi.', diff: 'ALL' },
    { title: 'Typography Masterclass', desc: 'Làm chủ nghệ thuật chữ trong thiết kế.', diff: 'INTERMEDIATE' },
    { title: 'Creative Director Pathway', desc: 'Lộ trình thăng tiến thành Giám đốc Sáng tạo.', diff: 'ADVANCED' },
  ],
  'Marketing': [
    { title: 'Digital Marketing Full-stack', desc: 'Nắm vững toàn bộ các kênh tiếp thị kỹ thuật số.', diff: 'ALL' },
    { title: 'Chuyên gia Facebook Ads', desc: 'Tối ưu quảng cáo Facebook ra đơn hiệu quả.', diff: 'INTERMEDIATE' },
    { title: 'Google Ads Master', desc: 'Thống trị nền tảng tìm kiếm lớn nhất thế giới.', diff: 'INTERMEDIATE' },
    { title: 'SEO Specialist', desc: 'Đưa website lên Top 1 Google bền vững.', diff: 'ADVANCED' },
    { title: 'Content Creator triệu view', desc: 'Kỹ năng sáng tạo nội dung thu hút trên MXH.', diff: 'BEGINNER' },
    { title: 'TikTok Marketing & Xây Kênh', desc: 'Chiến lược lên xu hướng và bán hàng trên TikTok.', diff: 'ALL' },
    { title: 'Email Marketing Tự động hóa', desc: 'Xây dựng phễu bán hàng qua Email.', diff: 'INTERMEDIATE' },
    { title: 'Data Analytics for Marketing', desc: 'Đo lường và tối ưu chiến dịch với dữ liệu thực.', diff: 'ADVANCED' },
    { title: 'Brand Management', desc: 'Quản trị và định vị thương hiệu chuyên nghiệp.', diff: 'INTERMEDIATE' },
    { title: 'PR & Media Relations', desc: 'Chiến lược quan hệ công chúng và xử lý khủng hoảng.', diff: 'ADVANCED' },
  ],
  'Kinh doanh': [
    { title: 'Khởi nghiệp từ số 0', desc: 'Hướng dẫn từng bước xây dựng doanh nghiệp mới.', diff: 'ALL' },
    { title: 'Giám đốc Kinh doanh', desc: 'Nâng cao năng lực quản lý và thúc đẩy doanh thu.', diff: 'ADVANCED' },
    { title: 'Kỹ năng Bán hàng B2B', desc: 'Trở thành Best Seller với kỹ năng đàm phán đỉnh cao.', diff: 'BEGINNER' },
    { title: 'Bán hàng trên TMĐT', desc: 'Xây dựng đế chế bán lẻ trên Shopee/Lazada.', diff: 'ALL' },
    { title: 'Tài chính Doanh nghiệp', desc: 'Làm chủ dòng tiền và kiểm soát rủi ro tài chính.', diff: 'INTERMEDIATE' },
    { title: 'Quản trị Nhân sự (HR)', desc: 'Thu hút, đào tạo và giữ chân nhân tài.', diff: 'INTERMEDIATE' },
    { title: 'Business Intelligence', desc: 'Phân tích dữ liệu để ra quyết định chiến lược.', diff: 'ADVANCED' },
    { title: 'Kỹ năng Đàm phán', desc: 'Kỹ thuật tâm lý học để chiến thắng mọi cuộc đàm phán.', diff: 'ALL' },
    { title: 'Quản lý Chuỗi cung ứng', desc: 'Tối ưu hóa quy trình vận hành và logistics.', diff: 'ADVANCED' },
    { title: 'Lãnh đạo trong kỷ nguyên số', desc: 'Chuyển đổi số doanh nghiệp thành công.', diff: 'INTERMEDIATE' },
  ],
  'Ngoại ngữ': [
    { title: 'Tiếng Anh Giao Tiếp', desc: 'Nghe nói trôi chảy trong môi trường quốc tế.', diff: 'ALL' },
    { title: 'Luyện Thi IELTS 7.0+', desc: 'Lộ trình tối ưu chinh phục chứng chỉ IELTS.', diff: 'ADVANCED' },
    { title: 'Tiếng Anh Chuyên Ngành IT', desc: 'Thuật ngữ và giao tiếp tiếng Anh cho Lập trình viên.', diff: 'INTERMEDIATE' },
    { title: 'Business English', desc: 'Kỹ năng viết email và đàm phán kinh doanh.', diff: 'INTERMEDIATE' },
    { title: 'Tiếng Nhật N5-N4', desc: 'Bắt đầu hành trình chinh phục tiếng Nhật.', diff: 'BEGINNER' },
    { title: 'Luyện thi JLPT N3-N2', desc: 'Lộ trình cấp tốc lấy bằng tiếng Nhật cao cấp.', diff: 'ADVANCED' },
    { title: 'Tiếng Hàn & TOPIK', desc: 'Phát âm chuẩn xác và thi đạt chứng chỉ tiếng Hàn.', diff: 'ALL' },
    { title: 'Tiếng Trung Giao tiếp', desc: 'Giao tiếp lưu loát và luyện thi HSK.', diff: 'BEGINNER' },
    { title: 'Tiếng Tây Ban Nha', desc: 'Làm quen với ngôn ngữ phổ biến thứ 2 thế giới.', diff: 'BEGINNER' },
    { title: 'Tiếng Pháp Du học', desc: 'Lộ trình chuẩn bị ngôn ngữ để đi du học Pháp.', diff: 'INTERMEDIATE' },
  ],
  'Kỹ năng mềm': [
    { title: 'Nghệ thuật Thuyết trình', desc: 'Tự tin nói trước đám đông và truyền cảm hứng.', diff: 'ALL' },
    { title: 'Quản trị Thời gian', desc: 'Xây dựng thói quen làm việc hiệu quả X2 năng suất.', diff: 'BEGINNER' },
    { title: 'Tư duy Phản biện', desc: 'Rèn luyện khả năng lập luận và giải quyết vấn đề.', diff: 'INTERMEDIATE' },
    { title: 'Trí tuệ Cảm xúc (EQ)', desc: 'Quản trị cảm xúc và thấu hiểu người khác.', diff: 'ALL' },
    { title: 'Làm việc Nhóm', desc: 'Kỹ năng phối hợp và xử lý xung đột nội bộ.', diff: 'BEGINNER' },
    { title: 'Design Thinking', desc: 'Phá vỡ lối mòn, sáng tạo giải pháp đột phá.', diff: 'INTERMEDIATE' },
    { title: 'Thương hiệu Cá nhân', desc: 'Định vị bản thân và tạo ảnh hưởng trong ngành.', diff: 'ADVANCED' },
    { title: 'Creative Writing', desc: 'Trình bày ý tưởng mạch lạc và cuốn hút.', diff: 'BEGINNER' },
    { title: 'Quản lý Căng thẳng', desc: 'Cân bằng công việc và cuộc sống.', diff: 'ALL' },
    { title: 'Kỹ năng Lãnh đạo', desc: 'Phát triển tố chất lãnh đạo ở mọi cấp độ.', diff: 'ADVANCED' },
  ]
};

async function main() {
  const courseServiceUrl = process.env.COURSE_SERVICE_URL || 'http://course-service:3003';
  
  console.log('Fetching available courses from course-service...');
  let courses: any[] = [];
  let retries = 12; // Wait up to 60 seconds
  
  while (retries > 0) {
    try {
      const response = await axios.get(`${courseServiceUrl}/api/courses?limit=100`);
      courses = response.data.courses || [];
      if (courses.length > 0) {
        console.log(`Found ${courses.length} courses in course-service.`);
        break; // Successfully fetched courses, exit loop
      } else {
        console.log('course-service returned 0 courses. It might still be seeding. Retrying in 5 seconds...');
      }
    } catch (err) {
      console.error(`Failed to connect to course-service. It might be starting up. Retries left: ${retries - 1}. Waiting 5s...`);
    }
    await new Promise(resolve => setTimeout(resolve, 5000));
    retries--;
  }

  if (courses.length === 0) {
    console.error('CRITICAL WARNING: Could not fetch courses from course-service after maximum retries. Falling back to fake IDs.');
  }

  const fallbackIds = ['65f1234567890abcdef00001', '65f1234567890abcdef00002'];

  console.log('Clearing existing paths...');
  await prisma.learningPath.deleteMany({});

  console.log('Seeding new 60 learning paths (10 per category)...');

  let count = 0;

  for (const [categoryName, paths] of Object.entries(pathsData)) {
    // Try to find courses that match this category
    const categoryCourses = courses.filter(c => {
      // In our seed, category might be populated or we can match keywords
      const title = c.title.toLowerCase();
      const cat = c.category ? (c.category.name || c.category).toString().toLowerCase() : '';
      return cat.includes(categoryName.toLowerCase()) || title.includes(categoryName.toLowerCase());
    });

    for (let i = 0; i < paths.length; i++) {
      const pathDef = paths[i];
      
      // Give each path 2-4 distinct courses from this category, or fallback to any courses, or fallback IDs
      let courseIdsToUse = [];
      if (categoryCourses.length >= 2) {
        // Shift subset of courses for variety
        const startIndex = i % (categoryCourses.length - 1);
        courseIdsToUse = categoryCourses.slice(startIndex, startIndex + 2).map(c => c.id);
      } else if (courses.length > 0) {
        const startIndex = (count * 2) % (courses.length - 1);
        courseIdsToUse = courses.slice(startIndex, startIndex + 2).map(c => c.id);
      } else {
        courseIdsToUse = fallbackIds;
      }

      const slug = createSlug(`${pathDef.title}-${Math.random().toString(36).substring(2, 6)}`);

      await prisma.learningPath.create({
        data: {
          title: pathDef.title,
          description: pathDef.desc,
          slug: slug,
          category: categoryName,
          difficulty: pathDef.diff as any,
          courseIds: courseIdsToUse,
          imageUrl: images[i % images.length],
          status: 'PUBLISHED',
          recommended: i === 0, // Recommend the first path in each category
        },
      });
      count++;
    }
  }

  console.log(`Successfully seeded ${count} learning paths!`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
