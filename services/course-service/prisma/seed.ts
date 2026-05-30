import { PrismaClient } from '@prisma/client';
import slugify from 'slugify';

const prisma = new PrismaClient();

// Hàm tạo slug tự động
const createSlug = (text: string) => {
  return slugify(text, { lower: true, strict: true, locale: 'vi' });
};

async function main() {
  console.log('Bắt đầu quá trình seed dữ liệu cho course-service...');

  // 1. Kiểm tra xem dữ liệu đã tồn tại chưa
  console.log('Kiểm tra dữ liệu cũ...');
  const courseCount = await prisma.course.count();
  if (courseCount > 0) {
    console.log(`Đã tồn tại ${courseCount} khóa học. Bỏ qua quá trình seed để bảo toàn dữ liệu.`);
    return;
  }

  // 2. Tạo danh mục (Categories)
  console.log('Đang tạo các danh mục...');
  const categoriesData = [
    { name: 'Lập trình', description: 'Các khóa học về lập trình, phát triển phần mềm, web, mobile.', icon: '💻' },
    { name: 'Thiết kế', description: 'Thiết kế đồ họa, UI/UX, 3D, animation.', icon: '🎨' },
    { name: 'Marketing', description: 'Digital marketing, SEO, Social Media, Content.', icon: '📈' },
    { name: 'Kinh doanh', description: 'Quản trị kinh doanh, khởi nghiệp, kỹ năng bán hàng.', icon: '💼' },
    { name: 'Ngoại ngữ', description: 'Tiếng Anh, Tiếng Nhật, Tiếng Hàn, Tiếng Trung.', icon: '🌍' },
    { name: 'Kỹ năng mềm', description: 'Giao tiếp, thuyết trình, quản lý thời gian.', icon: '🧠' },
  ];

  const categories: Record<string, any> = {};
  for (const cat of categoriesData) {
    categories[cat.name] = await prisma.category.create({
      data: {
        name: cat.name,
        slug: createSlug(cat.name),
        description: cat.description,
        icon: cat.icon,
      },
    });
  }

  // Instructor giả định (Dùng ID tĩnh để không bị lỗi khóa ngoại khi kết nối các service)
  const defaultInstructorId = '65abcdef1234567890abcde1';

  // 3. Tạo 40 khóa học mẫu
  console.log('Đang tạo 40 khóa học mẫu...');
  
  const coursesData = [
    // LẬP TRÌNH
    {
      title: 'Lập trình Web Frontend với ReactJS và Tailwind CSS từ số 0',
      category: 'Lập trình',
      level: 'BEGINNER',
      price: 499000,
      thumbnail: 'https://images.unsplash.com/photo-1633356122544-f134324a6cee?w=800&q=80',
      whatYouWillLearn: 'Thành thạo ReactJS, Component, State management, TailwindCSS responsive',
      requirements: ['Biết cơ bản về HTML, CSS', 'Sử dụng máy tính cơ bản'],
    },
    {
      title: 'Backend Node.js & Express toàn tập',
      category: 'Lập trình',
      level: 'INTERMEDIATE',
      price: 599000,
      thumbnail: 'https://images.unsplash.com/photo-1618477388954-7852f32655cb?w=800&q=80',
      whatYouWillLearn: 'Xây dựng RESTful API, xác thực JWT, kết nối MongoDB, bảo mật API',
      requirements: ['Có kiến thức Javascript cơ bản'],
    },
    {
      title: 'Khoá học Next.js 14 Thực Chiến, App Router & Server Actions',
      category: 'Lập trình',
      level: 'ADVANCED',
      price: 899000,
      thumbnail: 'https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=800&q=80',
      whatYouWillLearn: 'Làm chủ SSR, SSG, Server Actions, Tối ưu SEO cho ứng dụng React',
      requirements: ['Thành thạo ReactJS'],
    },
    {
      title: 'Mastering Python cho Phân Tích Dữ Liệu',
      category: 'Lập trình',
      level: 'BEGINNER',
      price: 450000,
      thumbnail: 'https://images.unsplash.com/photo-1526374965328-7f61d4dc18c5?w=800&q=80',
      whatYouWillLearn: 'Pandas, NumPy, Matplotlib, Data visualization cơ bản',
      requirements: ['Không yêu cầu kinh nghiệm lập trình'],
    },
    {
      title: 'Lập trình Mobile với React Native',
      category: 'Lập trình',
      level: 'INTERMEDIATE',
      price: 799000,
      thumbnail: 'https://images.unsplash.com/photo-1512941937669-90a1b58e7e9c?w=800&q=80',
      whatYouWillLearn: 'Build ứng dụng iOS & Android, navigation, call API',
      requirements: ['Đã biết ReactJS cơ bản'],
    },
    {
      title: 'Cấu trúc Dữ liệu & Giải thuật cho Phỏng vấn IT',
      category: 'Lập trình',
      level: 'ADVANCED',
      price: 699000,
      thumbnail: 'https://images.unsplash.com/photo-1504639725590-34d0984388bd?w=800&q=80',
      whatYouWillLearn: 'Trees, Graphs, Dynamic Programming, Sorting algorithms',
      requirements: ['Biết 1 ngôn ngữ lập trình'],
    },
    {
      title: 'Lập trình C++ từ Cơ bản đến Nâng cao',
      category: 'Lập trình',
      level: 'BEGINNER',
      price: 350000,
      thumbnail: 'https://images.unsplash.com/photo-1587620962725-abab7fe55159?w=800&q=80',
      whatYouWillLearn: 'Lập trình hướng đối tượng, con trỏ, quản lý bộ nhớ',
      requirements: ['Đam mê học hỏi'],
    },
    {
      title: 'Xây dựng Microservices với Spring Boot',
      category: 'Lập trình',
      level: 'ADVANCED',
      price: 999000,
      thumbnail: 'https://images.unsplash.com/photo-1517694712202-14dd9538aa97?w=800&q=80',
      whatYouWillLearn: 'Kiến trúc Microservices, Service Discovery, API Gateway',
      requirements: ['Nắm vững Java và Spring Boot cơ bản'],
    },
    {
      title: 'Lập trình Go (Golang) Thực chiến',
      category: 'Lập trình',
      level: 'INTERMEDIATE',
      price: 650000,
      thumbnail: 'https://images.unsplash.com/photo-1528360983277-13d401cdc186?w=800&q=80',
      whatYouWillLearn: 'Goroutines, Channels, xây dựng API hiệu năng cao',
      requirements: ['Có kinh nghiệm backend cơ bản'],
    },
    {
      title: 'Khóa học SQL và Cơ Sở Dữ Liệu',
      category: 'Lập trình',
      level: 'BEGINNER',
      price: 299000,
      thumbnail: 'https://images.unsplash.com/photo-1544383835-bda2bc66a55d?w=800&q=80',
      whatYouWillLearn: 'Truy vấn SQL, thiết kế CSDL chuẩn hóa, Index, Triggers',
      requirements: ['Không yêu cầu'],
    },

    // THIẾT KẾ
    {
      title: 'Thiết kế UI/UX với Figma: Từ Ý tưởng đến Prototype',
      category: 'Thiết kế',
      level: 'BEGINNER',
      price: 550000,
      thumbnail: 'https://images.unsplash.com/photo-1561070791-2526d30994b5?w=800&q=80',
      whatYouWillLearn: 'Công cụ Figma, thiết kế giao diện web/app, làm prototype tương tác',
      requirements: ['Chưa cần kinh nghiệm thiết kế'],
    },
    {
      title: 'Adobe Premiere Pro: Chỉnh sửa Video Chuyên nghiệp',
      category: 'Thiết kế',
      level: 'INTERMEDIATE',
      price: 690000,
      thumbnail: 'https://images.unsplash.com/photo-1574717024653-61fd2cf4d44d?w=800&q=80',
      whatYouWillLearn: 'Dựng phim, cắt ghép, hiệu ứng chuyển cảnh, chỉnh màu',
      requirements: ['Cài đặt sẵn phần mềm Premiere'],
    },
    {
      title: 'Photoshop Thực Chiến: Chỉnh Ảnh và Manipulations',
      category: 'Thiết kế',
      level: 'BEGINNER',
      price: 490000,
      thumbnail: 'https://images.unsplash.com/photo-1542744094-3a31f272c490?w=800&q=80',
      whatYouWillLearn: 'Sử dụng layer, mask, blend mode, xóa phông',
      requirements: ['Máy tính cài Photoshop'],
    },
    {
      title: 'Khóa học Illustrator: Thiết Kế Logo và Vector',
      category: 'Thiết kế',
      level: 'BEGINNER',
      price: 450000,
      thumbnail: 'https://images.unsplash.com/photo-1626785774573-4b799315345d?w=800&q=80',
      whatYouWillLearn: 'Vẽ vector, thiết kế logo, banner, bao bì sản phẩm',
      requirements: ['Không yêu cầu'],
    },
    {
      title: 'Thiết kế 3D với Blender: Tạo hình nhân vật',
      category: 'Thiết kế',
      level: 'ADVANCED',
      price: 890000,
      thumbnail: 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=800&q=80',
      whatYouWillLearn: 'Modeling, Sculpting, Texturing, Rigging',
      requirements: ['Biết cơ bản về không gian 3D'],
    },
    {
      title: 'After Effects: Hiệu Ứng Hình Ảnh và Animation',
      category: 'Thiết kế',
      level: 'INTERMEDIATE',
      price: 750000,
      thumbnail: 'https://images.unsplash.com/photo-1550751827-4bd374c3f58b?w=800&q=80',
      whatYouWillLearn: 'Motion graphics, VFX cơ bản, animation chữ',
      requirements: ['Cài đặt sẵn After Effects'],
    },

    // MARKETING
    {
      title: 'Digital Marketing Toàn Tập: Facebook & Google Ads',
      category: 'Marketing',
      level: 'BEGINNER',
      price: 599000,
      thumbnail: 'https://images.unsplash.com/photo-1432888498266-38ffec3eaf0a?w=800&q=80',
      whatYouWillLearn: 'Chạy quảng cáo Facebook, Google Search, tối ưu chi phí',
      requirements: ['Sử dụng máy tính cơ bản'],
    },
    {
      title: 'SEO Masterclass: Đưa Website Lên Top Google',
      category: 'Marketing',
      level: 'INTERMEDIATE',
      price: 650000,
      thumbnail: 'https://images.unsplash.com/photo-1562577309-4932fdd64cd1?w=800&q=80',
      whatYouWillLearn: 'On-page SEO, Off-page SEO, Link building, nghiên cứu từ khóa',
      requirements: ['Hiểu cơ bản về website'],
    },
    {
      title: 'Content Marketing: Viết bài thu hút khách hàng',
      category: 'Marketing',
      level: 'BEGINNER',
      price: 399000,
      thumbnail: 'https://images.unsplash.com/photo-1455390582262-044cdead2708?w=800&q=80',
      whatYouWillLearn: 'Kỹ năng copywriting, xây dựng kế hoạch nội dung, storytelling',
      requirements: ['Thích viết lách'],
    },
    {
      title: 'Xây dựng Kênh TikTok Triệu View từ Con Số 0',
      category: 'Marketing',
      level: 'BEGINNER',
      price: 499000,
      thumbnail: 'https://images.unsplash.com/photo-1611162617213-7d7a39e9b1d7?w=800&q=80',
      whatYouWillLearn: 'Thuật toán TikTok, kịch bản quay video, CapCut edit',
      requirements: ['Có smartphone'],
    },
    {
      title: 'Email Marketing Tự Động Hóa với Mailchimp',
      category: 'Marketing',
      level: 'INTERMEDIATE',
      price: 350000,
      thumbnail: 'https://images.unsplash.com/photo-1563986768494-4dee2763ff3f?w=800&q=80',
      whatYouWillLearn: 'Tạo phễu bán hàng, chuỗi email tự động hóa, tăng tỷ lệ mở email',
      requirements: ['Biết sử dụng internet'],
    },
    {
      title: 'Phân Tích Dữ Liệu Marketing với Google Analytics 4',
      category: 'Marketing',
      level: 'ADVANCED',
      price: 550000,
      thumbnail: 'https://images.unsplash.com/photo-1551288049-bebda4e38f71?w=800&q=80',
      whatYouWillLearn: 'Tracking sự kiện, phễu chuyển đổi, đọc hiểu báo cáo GA4',
      requirements: ['Đã có website'],
    },

    // KINH DOANH
    {
      title: 'Khởi nghiệp tinh gọn (Lean Startup) cho Startup Việt',
      category: 'Kinh doanh',
      level: 'BEGINNER',
      price: 450000,
      thumbnail: 'https://images.unsplash.com/photo-1460925895917-afdab827c52f?w=800&q=80',
      whatYouWillLearn: 'Xác thực ý tưởng, xây dựng MVP, đo lường và Pivot',
      requirements: ['Có đam mê khởi nghiệp'],
    },
    {
      title: 'Quản Lý Tài Chính Doanh Nghiệp Nhỏ và Vừa',
      category: 'Kinh doanh',
      level: 'INTERMEDIATE',
      price: 650000,
      thumbnail: 'https://images.unsplash.com/photo-1554224155-8d04cb21cd6c?w=800&q=80',
      whatYouWillLearn: 'Đọc báo cáo tài chính, quản lý dòng tiền, định giá',
      requirements: ['Có kiến thức cơ bản về kinh doanh'],
    },
    {
      title: 'Kỹ Năng Bán Hàng B2B Chuyên Nghiệp',
      category: 'Kinh doanh',
      level: 'INTERMEDIATE',
      price: 590000,
      thumbnail: 'https://images.unsplash.com/photo-1556761175-5973dc0f32e7?w=800&q=80',
      whatYouWillLearn: 'Chốt sale, đàm phán hợp đồng, xây dựng quan hệ khách hàng',
      requirements: ['Đang làm sale hoặc quan tâm đến sale'],
    },
    {
      title: 'Bán Hàng Trên Sàn Thương Mại Điện Tử (Shopee/Lazada)',
      category: 'Kinh doanh',
      level: 'BEGINNER',
      price: 390000,
      thumbnail: 'https://images.unsplash.com/photo-1516321497487-e288fb19713f?w=800&q=80',
      whatYouWillLearn: 'Thiết lập gian hàng, tối ưu SEO sản phẩm, chạy quảng cáo nội sàn',
      requirements: ['Biết dùng máy tính cơ bản'],
    },
    {
      title: 'Quản Trị Nhân Sự Khởi Nghiệp',
      category: 'Kinh doanh',
      level: 'ADVANCED',
      price: 790000,
      thumbnail: 'https://images.unsplash.com/photo-1522071820081-009f0129c71c?w=800&q=80',
      whatYouWillLearn: 'Tuyển dụng, xây dựng KPI, văn hóa doanh nghiệp',
      requirements: ['Đang quản lý đội nhóm'],
    },

    // NGOẠI NGỮ
    {
      title: 'Tiếng Anh Giao Tiếp Cho Người Mất Gốc',
      category: 'Ngoại ngữ',
      level: 'BEGINNER',
      price: 299000,
      thumbnail: 'https://images.unsplash.com/photo-1546410531-ee4cb12b1ceb?w=800&q=80',
      whatYouWillLearn: 'Phát âm chuẩn, giao tiếp chủ đề hàng ngày, từ vựng cơ bản',
      requirements: ['Không có yêu cầu'],
    },
    {
      title: 'Luyện Thi IELTS 6.5+ Toàn Diện 4 Kỹ Năng',
      category: 'Ngoại ngữ',
      level: 'ADVANCED',
      price: 990000,
      thumbnail: 'https://images.unsplash.com/photo-1513475382585-d06e58bcb0e0?w=800&q=80',
      whatYouWillLearn: 'Chiến thuật làm bài Reading/Listening, cấu trúc Writing Task 1&2, Speaking tự nhiên',
      requirements: ['Đã có nền tảng tiếng Anh khoảng 5.0'],
    },
    {
      title: 'Tiếng Nhật Cơ Bản N5 Cho Người Mới Bắt Đầu',
      category: 'Ngoại ngữ',
      level: 'BEGINNER',
      price: 450000,
      thumbnail: 'https://images.unsplash.com/photo-1528164344705-47542687000d?w=800&q=80',
      whatYouWillLearn: 'Bảng chữ cái Hiragana/Katakana, ngữ pháp N5 cơ bản, Kanji đơn giản',
      requirements: ['Sự kiên nhẫn'],
    },
    {
      title: 'Luyện Thi TOPIK II Tiếng Hàn (Cấp 3-4)',
      category: 'Ngoại ngữ',
      level: 'INTERMEDIATE',
      price: 550000,
      thumbnail: 'https://images.unsplash.com/photo-1580247817119-c6cb496270a4?w=800&q=80',
      whatYouWillLearn: 'Ngữ pháp trung cấp, luyện viết TOPIK câu 51-53, giải đề',
      requirements: ['Đã có TOPIK I hoặc trình độ tương đương'],
    },
    {
      title: 'Tiếng Trung Giao Tiếp Thương Mại',
      category: 'Ngoại ngữ',
      level: 'INTERMEDIATE',
      price: 650000,
      thumbnail: 'https://images.unsplash.com/photo-1555431189-0afcb103be43?w=800&q=80',
      whatYouWillLearn: 'Từ vựng thương mại, email giao dịch, đàm phán hợp đồng',
      requirements: ['Đã biết HSK3'],
    },
    {
      title: 'Tiếng Anh Chuyên Ngành IT',
      category: 'Ngoại ngữ',
      level: 'INTERMEDIATE',
      price: 390000,
      thumbnail: 'https://images.unsplash.com/photo-1488590528505-98d2b5aba04b?w=800&q=80',
      whatYouWillLearn: 'Đọc hiểu tài liệu chuyên ngành, viết code comments, phỏng vấn IT',
      requirements: ['Là sinh viên hoặc người đi làm IT'],
    },

    // KỸ NĂNG MỀM
    {
      title: 'Nghệ thuật Thuyết trình Thuyết phục',
      category: 'Kỹ năng mềm',
      level: 'BEGINNER',
      price: 250000,
      thumbnail: 'https://images.unsplash.com/photo-1475721027785-f74eccf877e2?w=800&q=80',
      whatYouWillLearn: 'Vượt qua nỗi sợ đám đông, thiết kế slide ấn tượng, ngôn ngữ cơ thể',
      requirements: ['Không yêu cầu'],
    },
    {
      title: 'Quản Lý Thời Gian và Tối Ưu Năng Suất Đỉnh Cao',
      category: 'Kỹ năng mềm',
      level: 'BEGINNER',
      price: 199000,
      thumbnail: 'https://images.unsplash.com/photo-1434494878577-86c23bcb06b9?w=800&q=80',
      whatYouWillLearn: 'Pomodoro, Ma trận Eisenhower, kỹ năng lập kế hoạch',
      requirements: ['Muốn cải thiện bản thân'],
    },
    {
      title: 'Tư Duy Phản Biện (Critical Thinking) Cơ Bản',
      category: 'Kỹ năng mềm',
      level: 'INTERMEDIATE',
      price: 350000,
      thumbnail: 'https://images.unsplash.com/photo-1516383740770-fbcc5ccbece0?w=800&q=80',
      whatYouWillLearn: 'Nhận diện ngụy biện logic, phân tích vấn đề đa chiều',
      requirements: ['Không yêu cầu'],
    },
    {
      title: 'Kỹ năng Giải quyết Vấn đề Khó Khăn',
      category: 'Kỹ năng mềm',
      level: 'INTERMEDIATE',
      price: 290000,
      thumbnail: 'https://images.unsplash.com/photo-1507537297725-24a1c029d3ca?w=800&q=80',
      whatYouWillLearn: 'Phân tích nguyên nhân gốc rễ, brainstorming giải pháp',
      requirements: ['Không yêu cầu'],
    },
    {
      title: 'Quản Lý Cảm Xúc (EQ) Trong Công Sở',
      category: 'Kỹ năng mềm',
      level: 'BEGINNER',
      price: 250000,
      thumbnail: 'https://images.unsplash.com/photo-1499209974431-9dddcece7f88?w=800&q=80',
      whatYouWillLearn: 'Nhận thức cảm xúc, kiểm soát sự tức giận, thấu cảm',
      requirements: ['Không yêu cầu'],
    },
    {
      title: 'Kỹ Năng Đàm Phán Win-Win',
      category: 'Kỹ năng mềm',
      level: 'ADVANCED',
      price: 490000,
      thumbnail: 'https://images.unsplash.com/photo-1573497491208-6b1acb260507?w=800&q=80',
      whatYouWillLearn: 'Chuẩn bị đàm phán, kỹ thuật nhượng bộ, xử lý bế tắc',
      requirements: ['Đã có kinh nghiệm làm việc thực tế'],
    },
    {
      title: 'Phát Triển Tư Duy Lãnh Đạo (Leadership Mindset)',
      category: 'Kỹ năng mềm',
      level: 'ADVANCED',
      price: 590000,
      thumbnail: 'https://images.unsplash.com/photo-1517048676732-d65bc937f952?w=800&q=80',
      whatYouWillLearn: 'Truyền cảm hứng, tạo động lực, phân quyền hiệu quả',
      requirements: ['Đang hoặc sắp làm vị trí quản lý'],
    }
  ];

  for (let i = 0; i < coursesData.length; i++) {
    const data = coursesData[i];
    const category = categories[data.category];
    
    // Default mock description if none specified
    const mockDescription = `Đây là khóa học chuyên sâu về ${data.title}. Trong khóa học này, bạn sẽ được hướng dẫn từng bước một từ cơ bản đến nâng cao. Nội dung được thiết kế dễ hiểu, bám sát thực tế, giúp học viên có thể áp dụng ngay vào công việc sau khi hoàn thành.`;

    await prisma.course.create({
      data: {
        title: data.title,
        slug: createSlug(data.title) + '-' + Math.random().toString(36).substring(2, 7),
        description: mockDescription,
        instructorId: defaultInstructorId,
        categoryId: category?.id,
        price: data.price,
        level: data.level as 'BEGINNER' | 'INTERMEDIATE' | 'ADVANCED',
        thumbnail: data.thumbnail,
        whatYouWillLearn: data.whatYouWillLearn,
        requirements: data.requirements,
        targetAudience: ['Sinh viên', 'Người đi làm', 'Người muốn chuyển ngành'],
        published: true,
        approvalStatus: 'APPROVED',
        approvedAt: new Date(),
        rating: Math.round((4.0 + Math.random() * 1.0) * 10) / 10, // Random 4.0 - 5.0
        totalReviews: Math.floor(Math.random() * 500) + 10, // Random 10 - 500
        enrolledCount: Math.floor(Math.random() * 2000) + 50, // Random 50 - 2000
      },
    });
  }

  console.log(`Đã tạo thành công ${Object.keys(categories).length} danh mục và ${coursesData.length} khóa học.`);
  console.log('Quá trình seed hoàn tất.');
}

main()
  .catch((e) => {
    console.error('Có lỗi xảy ra trong quá trình seed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
