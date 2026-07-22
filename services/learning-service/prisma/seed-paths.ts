import { PrismaClient } from '@prisma/client';
import axios from 'axios';

const prisma = new PrismaClient();

// ==================== Helpers ====================

const createSlug = (text: string) => {
  return text.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)+/g, '');
};

/** Find the first course whose title (lowercased) contains any keyword. Skips already-used IDs. */
function findCourse(courses: any[], keywords: string[], usedIds: Set<string>): any | null {
  for (const course of courses) {
    if (usedIds.has(course.id)) continue;
    const t = course.title.toLowerCase();
    if (keywords.some(kw => t.includes(kw.toLowerCase()))) {
      return course;
    }
  }
  return null;
}

// ==================== Images ====================

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

// ==================== Evaluation Pipeline Templates ====================

function devPipeline(topic: string) {
  return [
    { stageNumber: 1, title: 'Kiểm tra cấu trúc Project', objective: `Đảm bảo project ${topic} có cấu trúc chuẩn`, criteria: 'README.md tồn tại, cấu trúc thư mục src/ rõ ràng, file cấu hình (package.json / pom.xml / go.mod) hợp lệ', maxScore: 20, weight: 0.2, passCriteria: 'Đạt ≥ 70% tiêu chí' },
    { stageNumber: 2, title: 'Chức năng cốt lõi', objective: `Kiểm tra các tính năng chính của ứng dụng ${topic}`, criteria: 'CRUD operations hoạt động, form validation, error handling, navigation / routing đúng', maxScore: 35, weight: 0.35, passCriteria: 'Đạt ≥ 60% tiêu chí' },
    { stageNumber: 3, title: 'Chất lượng code & Best practices', objective: 'Đánh giá code quality và best practices', criteria: 'Clean code, naming conventions, DRY principle, comments đầy đủ, xử lý lỗi đúng cách', maxScore: 25, weight: 0.25, passCriteria: 'Đạt ≥ 60% tiêu chí' },
    { stageNumber: 4, title: 'Tài liệu & Triển khai', objective: 'Đánh giá documentation và deployment', criteria: 'README hướng dẫn cài đặt đầy đủ, demo hoạt động hoặc screenshot, link GitHub repo', maxScore: 20, weight: 0.2, passCriteria: 'Đạt ≥ 50% tiêu chí' },
  ];
}

function designPipeline(topic: string) {
  return [
    { stageNumber: 1, title: 'Ý tưởng & Concept', objective: `Đánh giá ý tưởng thiết kế ${topic}`, criteria: 'Brief rõ ràng, mood board hoặc reference, phân tích đối tượng mục tiêu', maxScore: 20, weight: 0.2, passCriteria: 'Đạt ≥ 70% tiêu chí' },
    { stageNumber: 2, title: 'Chất lượng thực thi hình ảnh', objective: `Đánh giá output thiết kế ${topic}`, criteria: 'Bố cục hài hòa, typography phù hợp, màu sắc nhất quán, chi tiết hoàn chỉnh', maxScore: 35, weight: 0.35, passCriteria: 'Đạt ≥ 60% tiêu chí' },
    { stageNumber: 3, title: 'Kỹ thuật sử dụng công cụ', objective: 'Đánh giá kỹ năng sử dụng phần mềm', criteria: 'Layers có tổ chức, sử dụng đúng công cụ, file source gọn gàng, xuất file đúng chuẩn', maxScore: 25, weight: 0.25, passCriteria: 'Đạt ≥ 60% tiêu chí' },
    { stageNumber: 4, title: 'Trình bày & Thuyết trình', objective: 'Đánh giá cách trình bày sản phẩm', criteria: 'Mockup presentation, giải thích ý tưởng, case study hoàn chỉnh', maxScore: 20, weight: 0.2, passCriteria: 'Đạt ≥ 50% tiêu chí' },
  ];
}

function marketingPipeline(topic: string) {
  return [
    { stageNumber: 1, title: 'Nghiên cứu & Chiến lược', objective: `Đánh giá chiến lược ${topic}`, criteria: 'Phân tích thị trường/đối thủ, xác định target audience, mục tiêu SMART', maxScore: 25, weight: 0.25, passCriteria: 'Đạt ≥ 70% tiêu chí' },
    { stageNumber: 2, title: 'Thực thi chiến dịch', objective: `Đánh giá triển khai thực tế ${topic}`, criteria: 'Content plan chi tiết, thiết lập campaign, budget allocation hợp lý', maxScore: 30, weight: 0.3, passCriteria: 'Đạt ≥ 60% tiêu chí' },
    { stageNumber: 3, title: 'Phân tích & Tối ưu', objective: 'Đánh giá khả năng đo lường và tối ưu', criteria: 'Tracking đúng KPIs, đọc hiểu báo cáo, đề xuất tối ưu dựa trên dữ liệu', maxScore: 25, weight: 0.25, passCriteria: 'Đạt ≥ 60% tiêu chí' },
    { stageNumber: 4, title: 'Báo cáo & Đề xuất', objective: 'Đánh giá báo cáo tổng kết', criteria: 'Slide/báo cáo chuyên nghiệp, kết luận rõ ràng, đề xuất cải thiện', maxScore: 20, weight: 0.2, passCriteria: 'Đạt ≥ 50% tiêu chí' },
  ];
}

function businessPipeline(topic: string) {
  return [
    { stageNumber: 1, title: 'Mô hình kinh doanh & Kế hoạch', objective: `Đánh giá kế hoạch ${topic}`, criteria: 'Business Model Canvas, phân tích SWOT, kế hoạch hành động rõ ràng', maxScore: 30, weight: 0.3, passCriteria: 'Đạt ≥ 70% tiêu chí' },
    { stageNumber: 2, title: 'Phân tích tài chính', objective: 'Đánh giá khả năng phân tích tài chính', criteria: 'Dự toán doanh thu/chi phí, phân tích ROI, quản lý rủi ro', maxScore: 25, weight: 0.25, passCriteria: 'Đạt ≥ 60% tiêu chí' },
    { stageNumber: 3, title: 'Chiến lược thực thi', objective: 'Đánh giá chiến lược triển khai', criteria: 'Kế hoạch chi tiết, milestone rõ ràng, phân bổ nguồn lực hợp lý', maxScore: 25, weight: 0.25, passCriteria: 'Đạt ≥ 60% tiêu chí' },
    { stageNumber: 4, title: 'Pitch & Thuyết trình', objective: 'Đánh giá khả năng thuyết trình ý tưởng', criteria: 'Slide pitch deck chuyên nghiệp, trình bày thuyết phục, Q&A chuẩn bị kỹ', maxScore: 20, weight: 0.2, passCriteria: 'Đạt ≥ 50% tiêu chí' },
  ];
}

function languagePipeline(topic: string) {
  return [
    { stageNumber: 1, title: 'Ngữ pháp & Từ vựng', objective: `Kiểm tra kiến thức ngôn ngữ ${topic}`, criteria: 'Sử dụng đúng ngữ pháp, vốn từ vựng phong phú, viết câu mạch lạc', maxScore: 25, weight: 0.25, passCriteria: 'Đạt ≥ 70% tiêu chí' },
    { stageNumber: 2, title: 'Nghe & Đọc hiểu', objective: 'Đánh giá kỹ năng tiếp nhận', criteria: 'Nghe hiểu đoạn hội thoại, đọc hiểu văn bản, trả lời đúng câu hỏi', maxScore: 25, weight: 0.25, passCriteria: 'Đạt ≥ 60% tiêu chí' },
    { stageNumber: 3, title: 'Nói & Viết', objective: 'Đánh giá kỹ năng sản sinh', criteria: 'Phát âm rõ ràng, viết bài luận/email, giao tiếp tự nhiên', maxScore: 30, weight: 0.3, passCriteria: 'Đạt ≥ 60% tiêu chí' },
    { stageNumber: 4, title: 'Ứng dụng thực tế', objective: 'Đánh giá khả năng ứng dụng', criteria: 'Xử lý tình huống thực tế, phỏng vấn mô phỏng, bài tập tổng hợp', maxScore: 20, weight: 0.2, passCriteria: 'Đạt ≥ 50% tiêu chí' },
  ];
}

function softSkillPipeline(topic: string) {
  return [
    { stageNumber: 1, title: 'Lý thuyết & Kiến thức nền', objective: `Đánh giá hiểu biết về ${topic}`, criteria: 'Nắm vững khái niệm cốt lõi, liên hệ thực tế, phân tích ví dụ', maxScore: 25, weight: 0.25, passCriteria: 'Đạt ≥ 70% tiêu chí' },
    { stageNumber: 2, title: 'Phân tích Case Study', objective: 'Đánh giá khả năng phân tích tình huống', criteria: 'Phân tích vấn đề có hệ thống, nhận diện nguyên nhân gốc rễ, đề xuất giải pháp', maxScore: 25, weight: 0.25, passCriteria: 'Đạt ≥ 60% tiêu chí' },
    { stageNumber: 3, title: 'Thực hành & Minh chứng', objective: 'Đánh giá khả năng thực hành', criteria: 'Video thực hành, bài tập mô phỏng, phản hồi từ đồng nghiệp/bạn học', maxScore: 30, weight: 0.3, passCriteria: 'Đạt ≥ 60% tiêu chí' },
    { stageNumber: 4, title: 'Kế hoạch phát triển cá nhân', objective: 'Đánh giá tự phản ánh và cải tiến', criteria: 'Bài viết tự đánh giá, kế hoạch cải thiện 30 ngày, cam kết hành động', maxScore: 20, weight: 0.2, passCriteria: 'Đạt ≥ 50% tiêu chí' },
  ];
}

// ==================== Path Definitions ====================

interface PathDef {
  title: string;
  desc: string;
  diff: string;
  careerGoal: string;
  skills: string[];
  shortDesc: string;
  certName: string;
  duration: number; // totalDurationMinutes
  /** Ordered array of keyword groups. Each group finds one course by title match. */
  matchers: string[][];
  /** prerequisite map: index → [required indices]. E.g. { 2: [0, 1] } means course #2 requires #0 and #1 */
  prereqs?: Record<number, number[]>;
  projectTitle: string;
  projectObjectives: string;
}

const pathsData: Record<string, PathDef[]> = {

  // =====================================================================================
  // LẬP TRÌNH
  // =====================================================================================
  'Lập trình': [
    {
      title: 'Fullstack Web Developer', desc: 'Lộ trình trở thành lập trình viên Web Fullstack toàn diện.', diff: 'ALL',
      careerGoal: 'Trở thành Fullstack Web Developer có khả năng xây dựng ứng dụng web hoàn chỉnh từ Frontend đến Backend',
      skills: ['HTML/CSS', 'JavaScript', 'ReactJS', 'TailwindCSS', 'Node.js', 'Express', 'SQL', 'MongoDB', 'REST API', 'Next.js'],
      shortDesc: 'Học từ HTML/CSS → ReactJS → Node.js/Express → Next.js. Xây dựng web app hoàn chỉnh.',
      certName: 'Chứng chỉ Fullstack Web Developer — UMI Academy',
      duration: 9600,
      matchers: [['sql', 'cơ sở dữ liệu'], ['reactjs', 'frontend', 'tailwind'], ['node.js', 'backend', 'express'], ['next.js']],
      prereqs: { 2: [0, 1], 3: [1, 2] },
      projectTitle: 'Xây dựng ứng dụng Web Fullstack hoàn chỉnh',
      projectObjectives: 'Thiết kế và xây dựng một ứng dụng web fullstack có giao diện React, backend Node.js/Express, kết nối cơ sở dữ liệu, xác thực người dùng và triển khai lên server.',
    },
    {
      title: 'Frontend React Master', desc: 'Chuyên gia Frontend với ReactJS và hệ sinh thái hiện đại.', diff: 'INTERMEDIATE',
      careerGoal: 'Trở thành Frontend Developer chuyên sâu ReactJS & Next.js',
      skills: ['ReactJS', 'Next.js', 'TailwindCSS', 'State Management', 'SSR/SSG', 'TypeScript', 'Responsive Design'],
      shortDesc: 'Chuyên sâu ReactJS → Next.js SSR/SSG. Xây dựng SPA hiện đại.',
      certName: 'Chứng chỉ Frontend React Master — UMI Academy',
      duration: 4800,
      matchers: [['reactjs', 'frontend', 'tailwind'], ['next.js']],
      prereqs: { 1: [0] },
      projectTitle: 'Xây dựng Single Page Application với React & Next.js',
      projectObjectives: 'Phát triển một SPA hoàn chỉnh sử dụng React + Next.js với routing, state management, SSR, responsive design và tối ưu SEO.',
    },
    {
      title: 'Backend Node.js Expert', desc: 'Chuyên gia xây dựng hệ thống Backend với Node.js.', diff: 'ADVANCED',
      careerGoal: 'Trở thành Backend Developer chuyên Node.js, xây dựng API và hệ thống scalable',
      skills: ['Node.js', 'Express', 'RESTful API', 'SQL', 'MongoDB', 'JWT Authentication', 'Middleware', 'Error Handling'],
      shortDesc: 'SQL → Node.js/Express → RESTful API → Bảo mật. Backend chuyên sâu.',
      certName: 'Chứng chỉ Backend Node.js Expert — UMI Academy',
      duration: 7200,
      matchers: [['sql', 'cơ sở dữ liệu'], ['node.js', 'backend', 'express']],
      prereqs: { 1: [0] },
      projectTitle: 'Xây dựng RESTful API hoàn chỉnh với Node.js & Express',
      projectObjectives: 'Thiết kế và xây dựng một hệ thống API RESTful có xác thực JWT, kết nối CSDL, validation, error handling, rate limiting và documentation bằng Swagger.',
    },
    {
      title: 'Mobile App Developer', desc: 'Phát triển ứng dụng di động đa nền tảng.', diff: 'BEGINNER',
      careerGoal: 'Phát triển ứng dụng mobile đa nền tảng iOS & Android với React Native',
      skills: ['React Native', 'JavaScript', 'Mobile UI/UX', 'Navigation', 'API Integration', 'AsyncStorage', 'Push Notification'],
      shortDesc: 'ReactJS cơ bản → React Native. Xây dựng app iOS & Android.',
      certName: 'Chứng chỉ Mobile App Developer — UMI Academy',
      duration: 6000,
      matchers: [['reactjs', 'frontend', 'tailwind'], ['react native']],
      prereqs: { 1: [0] },
      projectTitle: 'Phát triển ứng dụng Mobile đa nền tảng',
      projectObjectives: 'Xây dựng ứng dụng mobile hoàn chỉnh với React Native: navigation, gọi API, lưu trữ local, UI responsive trên cả iOS và Android.',
    },
    {
      title: 'Data Scientist', desc: 'Khai phá dữ liệu và Machine Learning với Python.', diff: 'ALL',
      careerGoal: 'Trở thành Data Scientist — phân tích, trực quan hóa dữ liệu và áp dụng Machine Learning',
      skills: ['Python', 'Pandas', 'NumPy', 'Matplotlib', 'SQL', 'Machine Learning', 'Data Visualization', 'Statistical Analysis'],
      shortDesc: 'Python → SQL → Pandas/NumPy → Data Visualization → Machine Learning.',
      certName: 'Chứng chỉ Data Scientist — UMI Academy',
      duration: 7200,
      matchers: [['python'], ['sql', 'cơ sở dữ liệu']],
      prereqs: {},
      projectTitle: 'Phân tích dữ liệu và xây dựng mô hình Machine Learning',
      projectObjectives: 'Thu thập và xử lý bộ dữ liệu thực tế, trực quan hóa insight, xây dựng mô hình ML dự đoán và đánh giá hiệu suất mô hình.',
    },
    {
      title: 'DevOps & Cloud Engineer', desc: 'Kiến trúc sư hệ thống đám mây và tự động hóa CI/CD.', diff: 'ADVANCED',
      careerGoal: 'Trở thành DevOps/Cloud Engineer — quản lý hạ tầng, CI/CD và containerization',
      skills: ['Docker', 'CI/CD', 'Cloud Computing', 'Linux', 'Kubernetes', 'Monitoring', 'Infrastructure as Code', 'Golang'],
      shortDesc: 'Node.js Backend → Golang → Docker → CI/CD → Cloud Deploy.',
      certName: 'Chứng chỉ DevOps & Cloud Engineer — UMI Academy',
      duration: 6000,
      matchers: [['node.js', 'backend', 'express'], ['golang']],
      prereqs: {},
      projectTitle: 'Thiết lập pipeline CI/CD và triển khai ứng dụng lên Cloud',
      projectObjectives: 'Containerize một ứng dụng web, thiết lập CI/CD pipeline tự động, triển khai lên cloud với monitoring và logging.',
    },
    {
      title: 'Java Spring Boot Microservices', desc: 'Xây dựng hệ thống siêu vi dịch vụ với Java Spring.', diff: 'ADVANCED',
      careerGoal: 'Xây dựng hệ thống Microservices enterprise-grade với Java Spring Boot',
      skills: ['Java', 'Spring Boot', 'Microservices', 'API Gateway', 'Service Discovery', 'SQL', 'Docker', 'Eureka', 'RabbitMQ'],
      shortDesc: 'SQL → Spring Boot → Microservices → API Gateway → Service Discovery.',
      certName: 'Chứng chỉ Java Spring Boot Microservices — UMI Academy',
      duration: 7800,
      matchers: [['sql', 'cơ sở dữ liệu'], ['spring boot', 'microservices']],
      prereqs: { 1: [0] },
      projectTitle: 'Xây dựng hệ thống Microservices với Spring Boot',
      projectObjectives: 'Thiết kế và xây dựng hệ thống gồm ít nhất 3 microservices với API Gateway, Service Discovery, kết nối CSDL và giao tiếp giữa các service.',
    },
    {
      title: 'Golang Backend Developer', desc: 'Lập trình Backend hiệu năng cao với ngôn ngữ Go.', diff: 'INTERMEDIATE',
      careerGoal: 'Lập trình Backend hiệu năng cao với Go — goroutines, channels và REST API',
      skills: ['Golang', 'Goroutines', 'Channels', 'REST API', 'SQL', 'Concurrency', 'HTTP Server', 'Testing'],
      shortDesc: 'SQL → Golang → Goroutines/Channels → REST API hiệu năng cao.',
      certName: 'Chứng chỉ Golang Backend Developer — UMI Academy',
      duration: 5400,
      matchers: [['sql', 'cơ sở dữ liệu'], ['golang']],
      prereqs: { 1: [0] },
      projectTitle: 'Xây dựng REST API hiệu năng cao với Golang',
      projectObjectives: 'Phát triển một REST API server bằng Go với goroutines, kết nối CSDL, middleware, authentication và benchmark hiệu suất.',
    },
    {
      title: 'C++ cho Game & Hệ thống', desc: 'Nền tảng C++ cho phát triển Game và phần mềm cốt lõi.', diff: 'BEGINNER',
      careerGoal: 'Nắm vững C++ để phát triển Game, phần mềm hệ thống và ứng dụng hiệu năng cao',
      skills: ['C++', 'OOP', 'Pointers', 'Memory Management', 'Data Structures', 'STL', 'Game Loop', 'File I/O'],
      shortDesc: 'C++ cơ bản → OOP → Memory Management → Cấu trúc dữ liệu → Game.',
      certName: 'Chứng chỉ C++ Game & System Programming — UMI Academy',
      duration: 6000,
      matchers: [['c++'], ['cấu trúc', 'giải thuật']],
      prereqs: { 1: [0] },
      projectTitle: 'Phát triển ứng dụng/Game console với C++',
      projectObjectives: 'Xây dựng một ứng dụng hoặc game console bằng C++ sử dụng OOP, quản lý bộ nhớ, cấu trúc dữ liệu và file I/O.',
    },
    {
      title: 'Cấu trúc dữ liệu & Thuật toán', desc: 'Nền tảng CS vững chắc để vượt qua mọi bài phỏng vấn.', diff: 'ALL',
      careerGoal: 'Nắm vững thuật toán và cấu trúc dữ liệu — nền tảng cho mọi lập trình viên chuyên nghiệp',
      skills: ['Algorithms', 'Data Structures', 'Problem Solving', 'Big O Notation', 'Dynamic Programming', 'Graph Theory', 'Sorting', 'Searching'],
      shortDesc: 'C++ nền tảng → CTDL & Thuật toán → Problem Solving → Phỏng vấn IT.',
      certName: 'Chứng chỉ Cấu trúc Dữ liệu & Thuật toán — UMI Academy',
      duration: 5400,
      matchers: [['c++'], ['cấu trúc', 'giải thuật']],
      prereqs: { 1: [0] },
      projectTitle: 'Giải bộ bài tập thuật toán và phân tích độ phức tạp',
      projectObjectives: 'Giải ít nhất 20 bài toán thuật toán (sorting, searching, DP, graph), phân tích độ phức tạp thời gian/không gian và viết báo cáo giải pháp.',
    },
  ],

  // =====================================================================================
  // THIẾT KẾ
  // =====================================================================================
  'Thiết kế': [
    {
      title: 'UI/UX Designer Chuyên nghiệp', desc: 'Trở thành nhà thiết kế giao diện và trải nghiệm người dùng.', diff: 'ALL',
      careerGoal: 'Trở thành UI/UX Designer — thiết kế giao diện đẹp và trải nghiệm người dùng tuyệt vời',
      skills: ['Figma', 'User Research', 'Wireframing', 'Prototyping', 'Design System', 'Usability Testing', 'Photoshop'],
      shortDesc: 'Figma → Wireframe → Prototype → User Testing → Design System.',
      certName: 'Chứng chỉ UI/UX Designer Chuyên nghiệp — UMI Academy',
      duration: 6000,
      matchers: [['figma'], ['photoshop']],
      prereqs: {},
      projectTitle: 'Thiết kế UI/UX hoàn chỉnh cho ứng dụng Mobile',
      projectObjectives: 'Nghiên cứu người dùng, tạo wireframe, thiết kế UI hoàn chỉnh trên Figma, làm prototype tương tác và thực hiện usability test.',
    },
    {
      title: 'Graphic Designer Cơ bản', desc: 'Nền tảng thiết kế đồ họa với Photoshop và Illustrator.', diff: 'BEGINNER',
      careerGoal: 'Làm chủ thiết kế đồ họa cơ bản với Photoshop và Illustrator',
      skills: ['Photoshop', 'Illustrator', 'Color Theory', 'Typography', 'Layout Design', 'Logo Design', 'Print Design'],
      shortDesc: 'Photoshop → Illustrator → Logo → Banner → Print Design.',
      certName: 'Chứng chỉ Graphic Designer — UMI Academy',
      duration: 5400,
      matchers: [['photoshop'], ['illustrator']],
      prereqs: {},
      projectTitle: 'Thiết kế bộ nhận diện thương hiệu cơ bản',
      projectObjectives: 'Thiết kế logo, namecard, banner, letterhead cho một thương hiệu giả định sử dụng Photoshop và Illustrator.',
    },
    {
      title: 'Chuyên gia Adobe Photoshop', desc: 'Làm chủ công cụ chỉnh sửa ảnh mạnh mẽ nhất thế giới.', diff: 'INTERMEDIATE',
      careerGoal: 'Thành thạo Photoshop từ cơ bản đến nâng cao cho chỉnh sửa ảnh và thiết kế',
      skills: ['Photoshop', 'Photo Retouching', 'Compositing', 'Masking', 'Color Correction', 'Digital Painting'],
      shortDesc: 'Photoshop từ cơ bản đến chỉnh sửa ảnh chuyên nghiệp.',
      certName: 'Chứng chỉ Adobe Photoshop Expert — UMI Academy',
      duration: 3600,
      matchers: [['photoshop']],
      prereqs: {},
      projectTitle: 'Bộ sưu tập chỉnh sửa ảnh và photo manipulation',
      projectObjectives: 'Tạo bộ 5 tác phẩm: 2 retouching chân dung, 2 photo manipulation sáng tạo, 1 composite poster chuyên nghiệp.',
    },
    {
      title: 'Chuyên gia Illustrator', desc: 'Sáng tạo logo và đồ họa vector chuyên nghiệp.', diff: 'INTERMEDIATE',
      careerGoal: 'Thành thạo Illustrator cho thiết kế vector, logo và minh họa chuyên nghiệp',
      skills: ['Illustrator', 'Vector Graphics', 'Logo Design', 'Icon Design', 'Typography', 'Brand Identity'],
      shortDesc: 'Illustrator → Vector → Logo → Icon → Brand Identity.',
      certName: 'Chứng chỉ Adobe Illustrator Expert — UMI Academy',
      duration: 3600,
      matchers: [['illustrator']],
      prereqs: {},
      projectTitle: 'Thiết kế bộ logo và hệ thống icon vector',
      projectObjectives: 'Thiết kế 3 mẫu logo khác nhau và bộ 10 icon nhất quán cho một sản phẩm số, xuất file vector chuẩn.',
    },
    {
      title: 'Motion Graphics Cơ Bản', desc: 'Tạo hiệu ứng hình ảnh và chuyển động bắt mắt.', diff: 'ADVANCED',
      careerGoal: 'Tạo motion graphics, animation và VFX chuyên nghiệp với After Effects',
      skills: ['After Effects', 'Motion Graphics', 'Keyframe Animation', 'VFX', 'Expressions', 'Text Animation'],
      shortDesc: 'After Effects → Keyframe → Motion Graphics → VFX cơ bản.',
      certName: 'Chứng chỉ Motion Graphics Designer — UMI Academy',
      duration: 4200,
      matchers: [['after effects']],
      prereqs: {},
      projectTitle: 'Sản xuất video motion graphics 30 giây',
      projectObjectives: 'Tạo một video motion graphics 30 giây cho một sản phẩm/thương hiệu với logo animation, text effects, transitions và nhạc nền.',
    },
    {
      title: 'Video Editor Chuyên Nghiệp', desc: 'Dựng phim và chỉnh sửa video đỉnh cao.', diff: 'INTERMEDIATE',
      careerGoal: 'Trở thành Video Editor chuyên nghiệp — dựng phim, chỉnh màu, hiệu ứng',
      skills: ['Premiere Pro', 'Video Editing', 'Color Grading', 'Sound Design', 'Transitions', 'Storytelling'],
      shortDesc: 'Premiere Pro → Cắt ghép → Chỉnh màu → Hiệu ứng → Export.',
      certName: 'Chứng chỉ Video Editor Chuyên Nghiệp — UMI Academy',
      duration: 4200,
      matchers: [['premiere']],
      prereqs: {},
      projectTitle: 'Sản xuất video short film / quảng cáo 1 phút',
      projectObjectives: 'Dựng và chỉnh sửa hoàn chỉnh một video quảng cáo hoặc short film 1 phút với cắt ghép, chỉnh màu, hiệu ứng âm thanh và xuất file chất lượng cao.',
    },
    {
      title: '3D Artist với Blender', desc: 'Thiết kế nhân vật và không gian 3D ấn tượng.', diff: 'ADVANCED',
      careerGoal: 'Tạo mô hình 3D, nhân vật và không gian ấn tượng với Blender',
      skills: ['Blender', '3D Modeling', 'Sculpting', 'Texturing', 'Rigging', 'Rendering', 'Animation'],
      shortDesc: 'Blender → 3D Modeling → Sculpting → Texturing → Rendering.',
      certName: 'Chứng chỉ 3D Artist — UMI Academy',
      duration: 5400,
      matchers: [['blender']],
      prereqs: {},
      projectTitle: 'Tạo mô hình 3D nhân vật hoặc không gian hoàn chỉnh',
      projectObjectives: 'Modeling, texturing và rendering một nhân vật 3D hoặc một cảnh nội thất/ngoại thất hoàn chỉnh với Blender.',
    },
    {
      title: 'Thiết kế Bao bì Sản phẩm', desc: 'Nghệ thuật thiết kế bao bì tăng tỷ lệ chuyển đổi.', diff: 'ALL',
      careerGoal: 'Thiết kế bao bì sản phẩm chuyên nghiệp, tăng giá trị thương hiệu',
      skills: ['Illustrator', 'Photoshop', 'Packaging Design', 'Print Production', 'Dieline', 'Mockup'],
      shortDesc: 'Illustrator → Photoshop → Dieline → Bao bì → Mockup.',
      certName: 'Chứng chỉ Packaging Designer — UMI Academy',
      duration: 4800,
      matchers: [['illustrator'], ['photoshop']],
      prereqs: {},
      projectTitle: 'Thiết kế bộ bao bì sản phẩm hoàn chỉnh',
      projectObjectives: 'Thiết kế bao bì cho một sản phẩm: nghiên cứu thị trường, tạo dieline, thiết kế đồ họa, mockup 3D và file in ấn.',
    },
    {
      title: 'Typography Masterclass', desc: 'Làm chủ nghệ thuật chữ trong thiết kế.', diff: 'INTERMEDIATE',
      careerGoal: 'Thành thạo typography — nghệ thuật sắp chữ trong thiết kế đồ họa',
      skills: ['Typography', 'Font Pairing', 'Hierarchy', 'Illustrator', 'Photoshop', 'Layout Design'],
      shortDesc: 'Cơ bản Typography → Font Pairing → Hierarchy → Layout.',
      certName: 'Chứng chỉ Typography Master — UMI Academy',
      duration: 3600,
      matchers: [['illustrator'], ['photoshop']],
      prereqs: {},
      projectTitle: 'Thiết kế bộ poster typography sáng tạo',
      projectObjectives: 'Tạo bộ 5 poster typography sáng tạo thể hiện kỹ năng font pairing, hierarchy, layout và ứng dụng trong thiết kế thực tế.',
    },
    {
      title: 'Creative Director Pathway', desc: 'Lộ trình thăng tiến thành Giám đốc Sáng tạo.', diff: 'ADVANCED',
      careerGoal: 'Trở thành Creative Director — lãnh đạo đội ngũ sáng tạo và định hướng thương hiệu',
      skills: ['Figma', 'Photoshop', 'Illustrator', 'After Effects', 'Art Direction', 'Brand Strategy', 'Team Leadership'],
      shortDesc: 'Figma → Photoshop → Illustrator → After Effects → Art Direction.',
      certName: 'Chứng chỉ Creative Director — UMI Academy',
      duration: 10800,
      matchers: [['figma'], ['photoshop'], ['illustrator'], ['after effects']],
      prereqs: { 2: [0, 1], 3: [2] },
      projectTitle: 'Xây dựng chiến lược sáng tạo cho thương hiệu',
      projectObjectives: 'Xây dựng bộ chiến lược sáng tạo hoàn chỉnh: brand guidelines, key visuals, social media templates, video teaser và presentation.',
    },
  ],

  // =====================================================================================
  // MARKETING
  // =====================================================================================
  'Marketing': [
    {
      title: 'Digital Marketing Full-stack', desc: 'Nắm vững toàn bộ các kênh tiếp thị kỹ thuật số.', diff: 'ALL',
      careerGoal: 'Trở thành Digital Marketer toàn diện — nắm vững mọi kênh tiếp thị số',
      skills: ['Facebook Ads', 'Google Ads', 'SEO', 'Content Marketing', 'Email Marketing', 'TikTok Marketing', 'Analytics'],
      shortDesc: 'Digital Marketing → SEO → Content → TikTok → Email → Analytics.',
      certName: 'Chứng chỉ Digital Marketing Full-stack — UMI Academy',
      duration: 10800,
      matchers: [['digital marketing', 'facebook'], ['seo'], ['content marketing'], ['tiktok']],
      prereqs: { 1: [0], 2: [0] },
      projectTitle: 'Lập kế hoạch Digital Marketing toàn diện',
      projectObjectives: 'Xây dựng kế hoạch digital marketing 360° cho một thương hiệu: quảng cáo, SEO, content, social media, email marketing và đo lường KPIs.',
    },
    {
      title: 'Chuyên gia Facebook Ads', desc: 'Tối ưu quảng cáo Facebook ra đơn hiệu quả.', diff: 'INTERMEDIATE',
      careerGoal: 'Thành thạo Facebook & Meta Ads — tối ưu chi phí và tăng chuyển đổi',
      skills: ['Facebook Ads Manager', 'Audience Targeting', 'A/B Testing', 'Pixel', 'Conversion Optimization', 'Reporting'],
      shortDesc: 'Facebook Ads Manager → Targeting → Pixel → Tối ưu → Reporting.',
      certName: 'Chứng chỉ Facebook Ads Specialist — UMI Academy',
      duration: 3600,
      matchers: [['digital marketing', 'facebook']],
      prereqs: {},
      projectTitle: 'Thiết lập và tối ưu chiến dịch Facebook Ads',
      projectObjectives: 'Lên kế hoạch, thiết lập, chạy và tối ưu một chiến dịch Facebook Ads thực tế với targeting, A/B testing và báo cáo ROI.',
    },
    {
      title: 'Google Ads Master', desc: 'Thống trị nền tảng tìm kiếm lớn nhất thế giới.', diff: 'INTERMEDIATE',
      careerGoal: 'Làm chủ Google Ads — Search, Display và Shopping Ads',
      skills: ['Google Ads', 'Keyword Research', 'Search Ads', 'Display Ads', 'Bidding Strategy', 'Quality Score'],
      shortDesc: 'Google Ads → Keyword Research → Search/Display → Bidding → Tối ưu.',
      certName: 'Chứng chỉ Google Ads Master — UMI Academy',
      duration: 4200,
      matchers: [['digital marketing', 'facebook', 'google ads'], ['seo']],
      prereqs: {},
      projectTitle: 'Thiết lập chiến dịch Google Ads đa kênh',
      projectObjectives: 'Nghiên cứu từ khóa, thiết lập campaign Search + Display, tối ưu bidding và viết báo cáo hiệu suất chi tiết.',
    },
    {
      title: 'SEO Specialist', desc: 'Đưa website lên Top 1 Google bền vững.', diff: 'ADVANCED',
      careerGoal: 'Trở thành SEO Specialist — tối ưu website lên top Google bền vững',
      skills: ['On-page SEO', 'Off-page SEO', 'Technical SEO', 'Keyword Research', 'Link Building', 'Content SEO', 'Google Search Console'],
      shortDesc: 'SEO Audit → On-page → Off-page → Technical SEO → Content SEO.',
      certName: 'Chứng chỉ SEO Specialist — UMI Academy',
      duration: 4800,
      matchers: [['seo'], ['content marketing']],
      prereqs: { 1: [0] },
      projectTitle: 'Audit SEO và xây dựng chiến lược SEO cho website',
      projectObjectives: 'Thực hiện SEO audit toàn diện cho một website thật, lên chiến lược on-page/off-page, tối ưu content và đo lường kết quả.',
    },
    {
      title: 'Content Creator triệu view', desc: 'Kỹ năng sáng tạo nội dung thu hút trên MXH.', diff: 'BEGINNER',
      careerGoal: 'Trở thành Content Creator — sáng tạo nội dung thu hút triệu view trên mạng xã hội',
      skills: ['Content Creation', 'Copywriting', 'Storytelling', 'Video Script', 'Social Media Strategy', 'CapCut'],
      shortDesc: 'Copywriting → Storytelling → Content Planning → Social Media.',
      certName: 'Chứng chỉ Content Creator — UMI Academy',
      duration: 4200,
      matchers: [['content marketing'], ['tiktok']],
      prereqs: {},
      projectTitle: 'Xây dựng chiến lược content và tạo bộ nội dung mẫu',
      projectObjectives: 'Lên kế hoạch content 1 tháng, viết 10 bài copywriting, tạo 3 video script và xuất bản trên nền tảng social media thật.',
    },
    {
      title: 'TikTok Marketing & Xây Kênh', desc: 'Chiến lược lên xu hướng và bán hàng trên TikTok.', diff: 'ALL',
      careerGoal: 'Xây dựng kênh TikTok triệu follower và bán hàng hiệu quả trên nền tảng',
      skills: ['TikTok Algorithm', 'Video Content', 'Trending Strategy', 'TikTok Shop', 'CapCut Editing', 'Hashtag Strategy'],
      shortDesc: 'TikTok Algorithm → Tạo Video → Trending → TikTok Shop → Analytics.',
      certName: 'Chứng chỉ TikTok Marketing Specialist — UMI Academy',
      duration: 3600,
      matchers: [['tiktok'], ['content marketing']],
      prereqs: {},
      projectTitle: 'Xây dựng và phát triển kênh TikTok từ 0',
      projectObjectives: 'Tạo kênh TikTok, sản xuất 10 video theo trend, phân tích algorithm, báo cáo tăng trưởng và chiến lược monetization.',
    },
    {
      title: 'Email Marketing Tự động hóa', desc: 'Xây dựng phễu bán hàng qua Email.', diff: 'INTERMEDIATE',
      careerGoal: 'Xây dựng hệ thống email marketing tự động hóa — phễu bán hàng và nuôi dưỡng lead',
      skills: ['Email Marketing', 'Marketing Automation', 'Lead Nurturing', 'A/B Testing', 'Segmentation', 'Mailchimp'],
      shortDesc: 'Email Marketing → Automation → Phễu bán hàng → A/B Testing.',
      certName: 'Chứng chỉ Email Marketing Automation — UMI Academy',
      duration: 3000,
      matchers: [['email marketing']],
      prereqs: {},
      projectTitle: 'Thiết lập hệ thống Email Marketing tự động hóa',
      projectObjectives: 'Xây dựng phễu email gồm welcome series, nurture sequence, re-engagement campaign với A/B testing và báo cáo metrics.',
    },
    {
      title: 'Data Analytics for Marketing', desc: 'Đo lường và tối ưu chiến dịch với dữ liệu thực.', diff: 'ADVANCED',
      careerGoal: 'Trở thành Marketing Analyst — đo lường, phân tích và tối ưu chiến dịch bằng dữ liệu',
      skills: ['Google Analytics 4', 'Data Analysis', 'Attribution Modeling', 'Conversion Tracking', 'Dashboard', 'A/B Testing'],
      shortDesc: 'Google Analytics 4 → Tracking → Attribution → Dashboard → Tối ưu.',
      certName: 'Chứng chỉ Marketing Data Analyst — UMI Academy',
      duration: 4200,
      matchers: [['google analytics'], ['seo']],
      prereqs: {},
      projectTitle: 'Phân tích dữ liệu marketing và tạo dashboard báo cáo',
      projectObjectives: 'Thiết lập GA4 tracking cho website, phân tích phễu chuyển đổi, tạo dashboard tổng hợp và đề xuất tối ưu dựa trên dữ liệu.',
    },
    {
      title: 'Brand Management', desc: 'Quản trị và định vị thương hiệu chuyên nghiệp.', diff: 'INTERMEDIATE',
      careerGoal: 'Quản trị thương hiệu chuyên nghiệp — định vị, xây dựng và bảo vệ thương hiệu',
      skills: ['Brand Positioning', 'Brand Identity', 'Brand Voice', 'Market Research', 'Competitive Analysis', 'PR Strategy'],
      shortDesc: 'Brand Positioning → Identity → Content → PR → Crisis Management.',
      certName: 'Chứng chỉ Brand Manager — UMI Academy',
      duration: 4800,
      matchers: [['digital marketing', 'facebook'], ['content marketing']],
      prereqs: {},
      projectTitle: 'Xây dựng chiến lược thương hiệu toàn diện',
      projectObjectives: 'Phân tích thị trường, xây dựng brand positioning, brand identity guidelines, brand voice và kế hoạch truyền thông.',
    },
    {
      title: 'PR & Media Relations', desc: 'Chiến lược quan hệ công chúng và xử lý khủng hoảng.', diff: 'ADVANCED',
      careerGoal: 'Trở thành PR Specialist — xây dựng quan hệ truyền thông và xử lý khủng hoảng',
      skills: ['Public Relations', 'Media Relations', 'Press Release', 'Crisis Management', 'Event PR', 'Stakeholder Communication'],
      shortDesc: 'PR Strategy → Media Relations → Press Release → Crisis Management.',
      certName: 'Chứng chỉ PR & Media Specialist — UMI Academy',
      duration: 4200,
      matchers: [['content marketing'], ['digital marketing', 'facebook']],
      prereqs: {},
      projectTitle: 'Xây dựng chiến lược PR và kế hoạch xử lý khủng hoảng',
      projectObjectives: 'Viết press release, lên kế hoạch media outreach, xây dựng kịch bản xử lý khủng hoảng truyền thông và đánh giá hiệu quả PR.',
    },
  ],

  // =====================================================================================
  // KINH DOANH
  // =====================================================================================
  'Kinh doanh': [
    {
      title: 'Khởi nghiệp từ số 0', desc: 'Hướng dẫn từng bước xây dựng doanh nghiệp mới.', diff: 'ALL',
      careerGoal: 'Khởi nghiệp thành công — từ ý tưởng đến doanh nghiệp vận hành',
      skills: ['Business Model Canvas', 'MVP', 'Lean Startup', 'Market Research', 'Fundraising', 'Financial Planning'],
      shortDesc: 'Ý tưởng → Business Model → MVP → Tài chính → Gọi vốn.',
      certName: 'Chứng chỉ Khởi nghiệp & Startup — UMI Academy',
      duration: 5400,
      matchers: [['khởi nghiệp', 'lean startup'], ['tài chính']],
      prereqs: {},
      projectTitle: 'Xây dựng Business Plan cho ý tưởng khởi nghiệp',
      projectObjectives: 'Phát triển business plan hoàn chỉnh: Business Model Canvas, phân tích thị trường, kế hoạch tài chính 3 năm và pitch deck.',
    },
    {
      title: 'Giám đốc Kinh doanh', desc: 'Nâng cao năng lực quản lý và thúc đẩy doanh thu.', diff: 'ADVANCED',
      careerGoal: 'Trở thành Giám đốc Kinh doanh — quản lý đội ngũ và thúc đẩy doanh thu',
      skills: ['Sales Management', 'B2B Sales', 'Team Leadership', 'Financial Management', 'KPIs', 'Negotiation', 'HR Management'],
      shortDesc: 'Bán hàng B2B → Tài chính → Quản trị Nhân sự → Lãnh đạo.',
      certName: 'Chứng chỉ Giám đốc Kinh doanh — UMI Academy',
      duration: 7800,
      matchers: [['b2b'], ['tài chính'], ['nhân sự']],
      prereqs: { 1: [0], 2: [0, 1] },
      projectTitle: 'Xây dựng chiến lược kinh doanh và kế hoạch doanh thu',
      projectObjectives: 'Lập chiến lược kinh doanh tổng thể: phân tích thị trường, kế hoạch doanh thu, xây dựng KPIs cho team và ngân sách 12 tháng.',
    },
    {
      title: 'Kỹ năng Bán hàng B2B', desc: 'Trở thành Best Seller với kỹ năng đàm phán đỉnh cao.', diff: 'BEGINNER',
      careerGoal: 'Thành thạo bán hàng B2B — chốt deal và xây dựng quan hệ khách hàng doanh nghiệp',
      skills: ['B2B Sales', 'Consultative Selling', 'Negotiation', 'CRM', 'Pipeline Management', 'Closing Techniques'],
      shortDesc: 'Kỹ thuật bán hàng B2B → Đàm phán → CRM → Chốt sale.',
      certName: 'Chứng chỉ B2B Sales Professional — UMI Academy',
      duration: 3600,
      matchers: [['b2b']],
      prereqs: {},
      projectTitle: 'Xây dựng quy trình bán hàng B2B từ A-Z',
      projectObjectives: 'Thiết kế quy trình bán hàng B2B: prospecting, approach, presentation, handling objections, closing và follow-up.',
    },
    {
      title: 'Bán hàng trên TMĐT', desc: 'Xây dựng đế chế bán lẻ trên Shopee/Lazada.', diff: 'ALL',
      careerGoal: 'Xây dựng và phát triển kinh doanh trên sàn TMĐT — Shopee, Lazada, TikTok Shop',
      skills: ['E-commerce', 'Product Listing', 'SEO Sản phẩm', 'Advertising', 'Inventory Management', 'Customer Service'],
      shortDesc: 'Setup gian hàng → SEO sản phẩm → Quảng cáo → Quản lý kho → Tối ưu.',
      certName: 'Chứng chỉ E-Commerce Specialist — UMI Academy',
      duration: 3000,
      matchers: [['shopee', 'lazada', 'thương mại điện tử']],
      prereqs: {},
      projectTitle: 'Xây dựng gian hàng TMĐT và chiến lược bán hàng',
      projectObjectives: 'Thiết lập gian hàng, tối ưu listing sản phẩm, chạy quảng cáo nội sàn, phân tích đối thủ và lên kế hoạch tăng trưởng.',
    },
    {
      title: 'Tài chính Doanh nghiệp', desc: 'Làm chủ dòng tiền và kiểm soát rủi ro tài chính.', diff: 'INTERMEDIATE',
      careerGoal: 'Quản lý tài chính doanh nghiệp — đọc báo cáo, quản lý dòng tiền và kiểm soát rủi ro',
      skills: ['Financial Statements', 'Cash Flow Management', 'Budgeting', 'Risk Management', 'Financial Modeling', 'Tax Planning'],
      shortDesc: 'Báo cáo tài chính → Dòng tiền → Ngân sách → Quản lý rủi ro.',
      certName: 'Chứng chỉ Tài chính Doanh nghiệp — UMI Academy',
      duration: 3600,
      matchers: [['tài chính']],
      prereqs: {},
      projectTitle: 'Phân tích tài chính và lập ngân sách doanh nghiệp',
      projectObjectives: 'Đọc và phân tích 3 loại báo cáo tài chính, lập ngân sách 12 tháng, tính ROI/NPV cho dự án đầu tư và lên kế hoạch quản lý rủi ro.',
    },
    {
      title: 'Quản trị Nhân sự (HR)', desc: 'Thu hút, đào tạo và giữ chân nhân tài.', diff: 'INTERMEDIATE',
      careerGoal: 'Trở thành HR Manager — tuyển dụng, đào tạo và phát triển nhân tài',
      skills: ['Recruitment', 'Training & Development', 'Performance Management', 'KPI', 'Compensation & Benefits', 'Company Culture'],
      shortDesc: 'Tuyển dụng → Đào tạo → KPI → Văn hóa doanh nghiệp.',
      certName: 'Chứng chỉ Quản trị Nhân sự — UMI Academy',
      duration: 4200,
      matchers: [['nhân sự']],
      prereqs: {},
      projectTitle: 'Xây dựng hệ thống quản trị nhân sự cho doanh nghiệp nhỏ',
      projectObjectives: 'Thiết kế quy trình tuyển dụng, chương trình đào tạo, hệ thống KPIs và chính sách phúc lợi cho doanh nghiệp 20-50 nhân viên.',
    },
    {
      title: 'Business Intelligence', desc: 'Phân tích dữ liệu để ra quyết định chiến lược.', diff: 'ADVANCED',
      careerGoal: 'Trở thành Business Analyst — phân tích dữ liệu kinh doanh để ra quyết định chiến lược',
      skills: ['Business Analysis', 'Data-driven Decision', 'Dashboard', 'Financial Analysis', 'Market Intelligence', 'Strategic Planning'],
      shortDesc: 'Tài chính → Phân tích dữ liệu → Dashboard → Ra quyết định chiến lược.',
      certName: 'Chứng chỉ Business Intelligence Analyst — UMI Academy',
      duration: 5400,
      matchers: [['tài chính'], ['khởi nghiệp', 'lean startup']],
      prereqs: {},
      projectTitle: 'Phân tích dữ liệu kinh doanh và tạo dashboard BI',
      projectObjectives: 'Thu thập dữ liệu kinh doanh, phân tích trends, tạo dashboard trực quan và đưa ra khuyến nghị chiến lược dựa trên dữ liệu.',
    },
    {
      title: 'Kỹ năng Đàm phán', desc: 'Kỹ thuật tâm lý học để chiến thắng mọi cuộc đàm phán.', diff: 'ALL',
      careerGoal: 'Thành thạo kỹ năng đàm phán — chiến thắng trong mọi thương lượng kinh doanh',
      skills: ['Negotiation', 'Psychology', 'Win-Win Strategy', 'BATNA', 'Communication', 'Conflict Resolution'],
      shortDesc: 'Kỹ thuật bán hàng → Tâm lý đàm phán → BATNA → Chốt deal.',
      certName: 'Chứng chỉ Đàm phán Chuyên nghiệp — UMI Academy',
      duration: 4200,
      matchers: [['b2b'], ['tài chính']],
      prereqs: {},
      projectTitle: 'Thực hành đàm phán qua các case study thực tế',
      projectObjectives: 'Phân tích 5 case study đàm phán thực tế, lập chiến lược BATNA, thực hành role-play và viết báo cáo rút kinh nghiệm.',
    },
    {
      title: 'Quản lý Chuỗi cung ứng', desc: 'Tối ưu hóa quy trình vận hành và logistics.', diff: 'ADVANCED',
      careerGoal: 'Quản lý chuỗi cung ứng và logistics — tối ưu vận hành từ nhà cung cấp đến khách hàng',
      skills: ['Supply Chain Management', 'Logistics', 'Inventory Management', 'Procurement', 'Quality Control', 'ERP'],
      shortDesc: 'Tài chính → TMĐT/Logistics → Quản lý kho → Tối ưu chuỗi cung ứng.',
      certName: 'Chứng chỉ Supply Chain Manager — UMI Academy',
      duration: 5400,
      matchers: [['tài chính'], ['shopee', 'lazada', 'thương mại điện tử']],
      prereqs: {},
      projectTitle: 'Thiết kế và tối ưu chuỗi cung ứng cho doanh nghiệp',
      projectObjectives: 'Phân tích chuỗi cung ứng hiện tại, xác định điểm nghẽn, đề xuất giải pháp tối ưu logistics/inventory và tính toán chi phí.',
    },
    {
      title: 'Lãnh đạo trong kỷ nguyên số', desc: 'Chuyển đổi số doanh nghiệp thành công.', diff: 'INTERMEDIATE',
      careerGoal: 'Lãnh đạo chuyển đổi số — ứng dụng công nghệ để nâng tầm doanh nghiệp',
      skills: ['Digital Transformation', 'Change Management', 'Technology Strategy', 'HR Management', 'Innovation', 'Agile'],
      shortDesc: 'Nhân sự → Khởi nghiệp/Đổi mới → Chuyển đổi số → Lãnh đạo.',
      certName: 'Chứng chỉ Digital Leadership — UMI Academy',
      duration: 4800,
      matchers: [['nhân sự'], ['khởi nghiệp', 'lean startup']],
      prereqs: {},
      projectTitle: 'Lập kế hoạch chuyển đổi số cho doanh nghiệp',
      projectObjectives: 'Đánh giá mức độ số hóa hiện tại, xác định cơ hội chuyển đổi số, lập roadmap triển khai và kế hoạch quản lý thay đổi.',
    },
  ],

  // =====================================================================================
  // NGOẠI NGỮ
  // =====================================================================================
  'Ngoại ngữ': [
    {
      title: 'Tiếng Anh Giao Tiếp', desc: 'Nghe nói trôi chảy trong môi trường quốc tế.', diff: 'ALL',
      careerGoal: 'Giao tiếp tiếng Anh tự tin trong cuộc sống và công việc hàng ngày',
      skills: ['English Speaking', 'Pronunciation', 'Daily Conversation', 'Vocabulary', 'Grammar', 'Listening Comprehension'],
      shortDesc: 'Phát âm → Từ vựng → Ngữ pháp → Giao tiếp hàng ngày.',
      certName: 'Chứng chỉ Tiếng Anh Giao Tiếp B1 — UMI Academy',
      duration: 4200,
      matchers: [['mất gốc', 'tiếng anh giao tiếp']],
      prereqs: {},
      projectTitle: 'Thực hành giao tiếp tiếng Anh qua tình huống thực tế',
      projectObjectives: 'Quay 5 video giao tiếp tiếng Anh trong các tình huống: giới thiệu bản thân, mua sắm, du lịch, phỏng vấn, và thuyết trình.',
    },
    {
      title: 'Luyện Thi IELTS 7.0+', desc: 'Lộ trình tối ưu chinh phục chứng chỉ IELTS.', diff: 'ADVANCED',
      careerGoal: 'Đạt IELTS 7.0+ — chinh phục chứng chỉ tiếng Anh quốc tế uy tín nhất',
      skills: ['IELTS Reading', 'IELTS Writing', 'IELTS Listening', 'IELTS Speaking', 'Academic Vocabulary', 'Test Strategy'],
      shortDesc: 'Listening → Reading → Writing Task 1&2 → Speaking → Mock Test.',
      certName: 'Chứng chỉ IELTS Preparation — UMI Academy',
      duration: 6000,
      matchers: [['ielts']],
      prereqs: {},
      projectTitle: 'Hoàn thành bộ đề thi IELTS mô phỏng',
      projectObjectives: 'Làm 3 bộ đề IELTS mô phỏng đầy đủ 4 kỹ năng, viết 5 bài Writing Task 2, ghi âm 3 phần Speaking Part 2 và tự đánh giá.',
    },
    {
      title: 'Tiếng Anh Chuyên Ngành IT', desc: 'Thuật ngữ và giao tiếp tiếng Anh cho Lập trình viên.', diff: 'INTERMEDIATE',
      careerGoal: 'Thành thạo tiếng Anh chuyên ngành IT — đọc tài liệu, code review, phỏng vấn IT bằng tiếng Anh',
      skills: ['IT Vocabulary', 'Code Comments', 'Technical Documentation', 'IT Job Interview', 'Standup Meeting', 'Code Review'],
      shortDesc: 'Từ vựng IT → Đọc tài liệu → Code review → Phỏng vấn IT bằng tiếng Anh.',
      certName: 'Chứng chỉ English for IT Professionals — UMI Academy',
      duration: 3000,
      matchers: [['chuyên ngành it']],
      prereqs: {},
      projectTitle: 'Viết documentation và phỏng vấn IT bằng tiếng Anh',
      projectObjectives: 'Viết README tiếng Anh cho project, tham gia mock standup meeting, thực hành code review bằng tiếng Anh và phỏng vấn IT mô phỏng.',
    },
    {
      title: 'Business English', desc: 'Kỹ năng viết email và đàm phán kinh doanh.', diff: 'INTERMEDIATE',
      careerGoal: 'Thành thạo tiếng Anh thương mại — email, meeting, negotiation, presentation',
      skills: ['Business Email', 'Meeting English', 'Negotiation', 'Presentation Skills', 'Professional Vocabulary', 'Business Writing'],
      shortDesc: 'Giao tiếp cơ bản → Email → Meeting → Thuyết trình → Đàm phán.',
      certName: 'Chứng chỉ Business English — UMI Academy',
      duration: 4800,
      matchers: [['mất gốc', 'tiếng anh giao tiếp'], ['chuyên ngành it']],
      prereqs: { 1: [0] },
      projectTitle: 'Thực hành Business English qua tình huống doanh nghiệp',
      projectObjectives: 'Viết 5 email business, quay video thuyết trình 5 phút, thực hành meeting mô phỏng và viết proposal bằng tiếng Anh.',
    },
    {
      title: 'Tiếng Nhật N5-N4', desc: 'Bắt đầu hành trình chinh phục tiếng Nhật.', diff: 'BEGINNER',
      careerGoal: 'Đạt trình độ tiếng Nhật N5-N4 — giao tiếp cơ bản và đọc Kanji đơn giản',
      skills: ['Hiragana', 'Katakana', 'Kanji N5', 'Grammar N5', 'Daily Conversation', 'JLPT N5 Test'],
      shortDesc: 'Hiragana/Katakana → Kanji → Ngữ pháp N5 → Giao tiếp cơ bản.',
      certName: 'Chứng chỉ Tiếng Nhật N5-N4 — UMI Academy',
      duration: 4200,
      matchers: [['tiếng nhật']],
      prereqs: {},
      projectTitle: 'Luyện thi JLPT N5 và giao tiếp tiếng Nhật cơ bản',
      projectObjectives: 'Hoàn thành 3 bộ đề JLPT N5, viết 5 đoạn văn ngắn bằng tiếng Nhật, ghi âm hội thoại giao tiếp cơ bản.',
    },
    {
      title: 'Luyện thi JLPT N3-N2', desc: 'Lộ trình cấp tốc lấy bằng tiếng Nhật cao cấp.', diff: 'ADVANCED',
      careerGoal: 'Đạt JLPT N3-N2 — tiếng Nhật trình độ trung-cao cấp cho công việc và du học',
      skills: ['Kanji N3-N2', 'Grammar N3-N2', 'Reading Comprehension', 'Listening N2', 'Business Japanese', 'Keigo'],
      shortDesc: 'Kanji nâng cao → Ngữ pháp N3-N2 → Đọc hiểu → Business Japanese.',
      certName: 'Chứng chỉ JLPT N3-N2 Preparation — UMI Academy',
      duration: 7200,
      matchers: [['tiếng nhật']],
      prereqs: {},
      projectTitle: 'Hoàn thành bộ đề JLPT N3 mô phỏng',
      projectObjectives: 'Làm 3 bộ đề JLPT N3, viết bài luận tiếng Nhật 400 chữ, đọc hiểu bài báo và ghi âm presentation bằng tiếng Nhật.',
    },
    {
      title: 'Tiếng Hàn & TOPIK', desc: 'Phát âm chuẩn xác và thi đạt chứng chỉ tiếng Hàn.', diff: 'ALL',
      careerGoal: 'Đạt chứng chỉ TOPIK — tiếng Hàn từ cơ bản đến trung cấp',
      skills: ['Hangul', 'Korean Grammar', 'TOPIK Preparation', 'Korean Conversation', 'Korean Vocabulary', 'Korean Writing'],
      shortDesc: 'Hangul → Ngữ pháp → Từ vựng → Giao tiếp → Luyện thi TOPIK.',
      certName: 'Chứng chỉ Tiếng Hàn TOPIK — UMI Academy',
      duration: 4200,
      matchers: [['topik', 'tiếng hàn']],
      prereqs: {},
      projectTitle: 'Luyện thi TOPIK I và thực hành giao tiếp tiếng Hàn',
      projectObjectives: 'Làm 3 bộ đề TOPIK I, viết 5 bài viết ngắn, ghi âm 5 đoạn hội thoại và thuyết trình 3 phút bằng tiếng Hàn.',
    },
    {
      title: 'Tiếng Trung Giao tiếp', desc: 'Giao tiếp lưu loát và luyện thi HSK.', diff: 'BEGINNER',
      careerGoal: 'Giao tiếp tiếng Trung cơ bản và chuẩn bị cho kỳ thi HSK',
      skills: ['Pinyin', 'Chinese Characters', 'HSK Vocabulary', 'Chinese Grammar', 'Business Chinese', 'Daily Conversation'],
      shortDesc: 'Pinyin → Hán tự → Ngữ pháp → Giao tiếp → Thương mại.',
      certName: 'Chứng chỉ Tiếng Trung Giao tiếp HSK — UMI Academy',
      duration: 4200,
      matchers: [['tiếng trung']],
      prereqs: {},
      projectTitle: 'Luyện thi HSK và giao tiếp tiếng Trung thương mại',
      projectObjectives: 'Hoàn thành 3 bộ đề HSK, viết 5 email giao dịch tiếng Trung, ghi âm hội thoại thương mại cơ bản.',
    },
    {
      title: 'Tiếng Tây Ban Nha', desc: 'Làm quen với ngôn ngữ phổ biến thứ 2 thế giới.', diff: 'BEGINNER',
      careerGoal: 'Giao tiếp tiếng Tây Ban Nha cơ bản — ngôn ngữ phổ biến thứ 2 thế giới',
      skills: ['Spanish Alphabet', 'Basic Grammar', 'Daily Conversation', 'Pronunciation', 'Vocabulary', 'Spanish Culture'],
      shortDesc: 'Bảng chữ cái → Phát âm → Ngữ pháp cơ bản → Giao tiếp.',
      certName: 'Chứng chỉ Tiếng Tây Ban Nha Cơ bản — UMI Academy',
      duration: 3600,
      matchers: [['mất gốc', 'tiếng anh giao tiếp']],
      prereqs: {},
      projectTitle: 'Thực hành giao tiếp tiếng Tây Ban Nha cơ bản',
      projectObjectives: 'Ghi âm 5 đoạn hội thoại, viết 5 bài tự giới thiệu, và làm bộ flashcard 200 từ vựng tiếng Tây Ban Nha cơ bản.',
    },
    {
      title: 'Tiếng Pháp Du học', desc: 'Lộ trình chuẩn bị ngôn ngữ để đi du học Pháp.', diff: 'INTERMEDIATE',
      careerGoal: 'Chuẩn bị tiếng Pháp cho du học — đạt trình độ B1 để xin visa và học tập tại Pháp',
      skills: ['French Grammar', 'French Conversation', 'DELF Preparation', 'Academic French', 'French Culture', 'Writing Skills'],
      shortDesc: 'Phát âm → Ngữ pháp → Giao tiếp → Luyện thi DELF → Du học.',
      certName: 'Chứng chỉ Tiếng Pháp Du học B1 — UMI Academy',
      duration: 5400,
      matchers: [['mất gốc', 'tiếng anh giao tiếp'], ['ielts']],
      prereqs: {},
      projectTitle: 'Chuẩn bị hồ sơ ngôn ngữ cho du học Pháp',
      projectObjectives: 'Viết lettre de motivation bằng tiếng Pháp, ghi âm phỏng vấn Campus France mô phỏng, hoàn thành 2 bộ đề DELF B1.',
    },
  ],

  // =====================================================================================
  // KỸ NĂNG MỀM
  // =====================================================================================
  'Kỹ năng mềm': [
    {
      title: 'Nghệ thuật Thuyết trình', desc: 'Tự tin nói trước đám đông và truyền cảm hứng.', diff: 'ALL',
      careerGoal: 'Trở thành người thuyết trình tự tin — nói trước đám đông và truyền cảm hứng',
      skills: ['Public Speaking', 'Slide Design', 'Body Language', 'Storytelling', 'Audience Engagement', 'Stage Presence'],
      shortDesc: 'Vượt qua nỗi sợ → Slide → Body Language → Storytelling → Thuyết trình.',
      certName: 'Chứng chỉ Nghệ thuật Thuyết trình — UMI Academy',
      duration: 2400,
      matchers: [['thuyết trình']],
      prereqs: {},
      projectTitle: 'Thuyết trình 10 phút trước đám đông',
      projectObjectives: 'Chuẩn bị và ghi hình bài thuyết trình 10 phút về chủ đề tự chọn, có slide, sử dụng storytelling và body language hiệu quả.',
    },
    {
      title: 'Quản trị Thời gian', desc: 'Xây dựng thói quen làm việc hiệu quả X2 năng suất.', diff: 'BEGINNER',
      careerGoal: 'Quản lý thời gian hiệu quả — tăng năng suất gấp đôi và giảm stress',
      skills: ['Time Management', 'Pomodoro', 'Eisenhower Matrix', 'Goal Setting', 'Habit Building', 'Productivity Tools'],
      shortDesc: 'Pomodoro → Ma trận Eisenhower → Lập kế hoạch → Thói quen.',
      certName: 'Chứng chỉ Quản trị Thời gian — UMI Academy',
      duration: 1800,
      matchers: [['thời gian']],
      prereqs: {},
      projectTitle: 'Xây dựng hệ thống quản lý thời gian cá nhân',
      projectObjectives: 'Thực hành Pomodoro 2 tuần, ghi nhật ký thời gian, tạo kế hoạch tuần/tháng và viết báo cáo cải thiện năng suất.',
    },
    {
      title: 'Tư duy Phản biện', desc: 'Rèn luyện khả năng lập luận và giải quyết vấn đề.', diff: 'INTERMEDIATE',
      careerGoal: 'Rèn luyện tư duy phản biện — phân tích vấn đề đa chiều và ra quyết định đúng đắn',
      skills: ['Critical Thinking', 'Logical Reasoning', 'Fallacy Detection', 'Argument Analysis', 'Decision Making', 'Problem Analysis'],
      shortDesc: 'Nhận diện ngụy biện → Lập luận logic → Phân tích vấn đề → Ra quyết định.',
      certName: 'Chứng chỉ Tư duy Phản biện — UMI Academy',
      duration: 3000,
      matchers: [['phản biện'], ['giải quyết vấn đề']],
      prereqs: {},
      projectTitle: 'Phân tích case study bằng tư duy phản biện',
      projectObjectives: 'Phân tích 5 case study từ nhiều góc độ, nhận diện ngụy biện logic, viết bài lập luận và đề xuất giải pháp.',
    },
    {
      title: 'Trí tuệ Cảm xúc (EQ)', desc: 'Quản trị cảm xúc và thấu hiểu người khác.', diff: 'ALL',
      careerGoal: 'Nâng cao trí tuệ cảm xúc — quản trị cảm xúc bản thân và thấu hiểu người khác',
      skills: ['Emotional Intelligence', 'Self-awareness', 'Empathy', 'Anger Management', 'Active Listening', 'Social Skills'],
      shortDesc: 'Nhận thức cảm xúc → Quản lý → Thấu cảm → Kỹ năng xã hội.',
      certName: 'Chứng chỉ Trí tuệ Cảm xúc (EQ) — UMI Academy',
      duration: 2400,
      matchers: [['cảm xúc']],
      prereqs: {},
      projectTitle: 'Nhật ký cảm xúc và kế hoạch phát triển EQ',
      projectObjectives: 'Ghi nhật ký cảm xúc 2 tuần, phân tích mô hình phản ứng, thực hành active listening và viết kế hoạch phát triển EQ.',
    },
    {
      title: 'Làm việc Nhóm', desc: 'Kỹ năng phối hợp và xử lý xung đột nội bộ.', diff: 'BEGINNER',
      careerGoal: 'Làm việc nhóm hiệu quả — phối hợp, giao tiếp và xử lý xung đột',
      skills: ['Teamwork', 'Communication', 'Conflict Resolution', 'Collaboration', 'Feedback', 'Meeting Facilitation'],
      shortDesc: 'Giao tiếp nhóm → Phân vai → Xử lý xung đột → Phối hợp hiệu quả.',
      certName: 'Chứng chỉ Làm việc Nhóm Hiệu quả — UMI Academy',
      duration: 2400,
      matchers: [['thuyết trình'], ['cảm xúc']],
      prereqs: {},
      projectTitle: 'Thực hiện dự án nhóm và báo cáo quy trình phối hợp',
      projectObjectives: 'Thực hiện dự án nhóm 3-5 người, ghi chép quy trình phối hợp, xử lý ít nhất 1 xung đột và viết báo cáo bài học rút ra.',
    },
    {
      title: 'Design Thinking', desc: 'Phá vỡ lối mòn, sáng tạo giải pháp đột phá.', diff: 'INTERMEDIATE',
      careerGoal: 'Áp dụng Design Thinking — giải quyết vấn đề sáng tạo lấy người dùng làm trung tâm',
      skills: ['Design Thinking', 'Empathy Mapping', 'Ideation', 'Prototyping', 'User Testing', 'Innovation'],
      shortDesc: 'Empathize → Define → Ideate → Prototype → Test.',
      certName: 'Chứng chỉ Design Thinking Practitioner — UMI Academy',
      duration: 3000,
      matchers: [['phản biện'], ['giải quyết vấn đề']],
      prereqs: {},
      projectTitle: 'Giải quyết vấn đề thực tế bằng Design Thinking',
      projectObjectives: 'Áp dụng 5 bước Design Thinking để giải quyết một vấn đề thực tế: empathy map, persona, ideation, prototype và user test.',
    },
    {
      title: 'Thương hiệu Cá nhân', desc: 'Định vị bản thân và tạo ảnh hưởng trong ngành.', diff: 'ADVANCED',
      careerGoal: 'Xây dựng thương hiệu cá nhân — định vị bản thân và tạo ảnh hưởng trong ngành',
      skills: ['Personal Branding', 'Content Creation', 'Networking', 'LinkedIn Strategy', 'Public Speaking', 'Thought Leadership'],
      shortDesc: 'Thuyết trình → Lãnh đạo → LinkedIn → Content → Networking.',
      certName: 'Chứng chỉ Personal Branding — UMI Academy',
      duration: 3600,
      matchers: [['thuyết trình'], ['lãnh đạo']],
      prereqs: {},
      projectTitle: 'Xây dựng và triển khai thương hiệu cá nhân trên LinkedIn',
      projectObjectives: 'Tối ưu profile LinkedIn, viết 10 bài thought leadership, xây dựng content calendar 1 tháng và phân tích tăng trưởng.',
    },
    {
      title: 'Creative Writing', desc: 'Trình bày ý tưởng mạch lạc và cuốn hút.', diff: 'BEGINNER',
      careerGoal: 'Viết sáng tạo — trình bày ý tưởng rõ ràng, mạch lạc và cuốn hút người đọc',
      skills: ['Creative Writing', 'Storytelling', 'Blog Writing', 'Editing', 'Content Structure', 'Persuasive Writing'],
      shortDesc: 'Storytelling → Cấu trúc bài viết → Blog → Chỉnh sửa.',
      certName: 'Chứng chỉ Creative Writing — UMI Academy',
      duration: 2400,
      matchers: [['thuyết trình']],
      prereqs: {},
      projectTitle: 'Viết bộ sưu tập bài viết sáng tạo',
      projectObjectives: 'Viết 5 bài blog dài (800+ từ), 3 bài storytelling ngắn, 1 bài essay thuyết phục và tự chỉnh sửa, hoàn thiện.',
    },
    {
      title: 'Quản lý Căng thẳng', desc: 'Cân bằng công việc và cuộc sống.', diff: 'ALL',
      careerGoal: 'Quản lý căng thẳng hiệu quả — cân bằng công việc-cuộc sống và duy trì sức khỏe tinh thần',
      skills: ['Stress Management', 'Mindfulness', 'Work-life Balance', 'Meditation', 'Time Boundaries', 'Self-care'],
      shortDesc: 'Nhận diện stress → Mindfulness → Work-life Balance → Self-care.',
      certName: 'Chứng chỉ Quản lý Căng thẳng — UMI Academy',
      duration: 2400,
      matchers: [['cảm xúc'], ['thời gian']],
      prereqs: {},
      projectTitle: 'Xây dựng chương trình quản lý stress cá nhân 30 ngày',
      projectObjectives: 'Thực hành mindfulness 2 tuần, viết nhật ký stress, thiết lập work-life boundaries và báo cáo thay đổi sau 30 ngày.',
    },
    {
      title: 'Kỹ năng Lãnh đạo', desc: 'Phát triển tố chất lãnh đạo ở mọi cấp độ.', diff: 'ADVANCED',
      careerGoal: 'Phát triển tố chất lãnh đạo — truyền cảm hứng, tạo động lực và dẫn dắt đội nhóm',
      skills: ['Leadership', 'Team Building', 'Motivation', 'Decision Making', 'Delegation', 'Negotiation', 'Vision Setting'],
      shortDesc: 'Lãnh đạo → Đàm phán → Xây dựng đội nhóm → Truyền cảm hứng.',
      certName: 'Chứng chỉ Kỹ năng Lãnh đạo — UMI Academy',
      duration: 4200,
      matchers: [['lãnh đạo'], ['đàm phán']],
      prereqs: {},
      projectTitle: 'Phân tích phong cách lãnh đạo và xây dựng kế hoạch phát triển',
      projectObjectives: 'Đánh giá phong cách lãnh đạo cá nhân, phân tích 3 case study lãnh đạo nổi tiếng, xây dựng kế hoạch phát triển leadership 6 tháng.',
    },
  ],
};

// ==================== Pipeline category map ====================

const pipelineByCategory: Record<string, (topic: string) => any[]> = {
  'Lập trình': devPipeline,
  'Thiết kế': designPipeline,
  'Marketing': marketingPipeline,
  'Kinh doanh': businessPipeline,
  'Ngoại ngữ': languagePipeline,
  'Kỹ năng mềm': softSkillPipeline,
};

// ==================== Main Seed Function ====================

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
        break;
      } else {
        console.log('course-service returned 0 courses. Retrying in 5s...');
      }
    } catch (err) {
      console.error(`Failed to connect to course-service. Retries left: ${retries - 1}. Waiting 5s...`);
    }
    await new Promise(resolve => setTimeout(resolve, 5000));
    retries--;
  }

  if (courses.length === 0) {
    console.error('CRITICAL WARNING: Could not fetch courses. Falling back to empty arrays.');
  }

  const fallbackIds = ['65f1234567890abcdef00001', '65f1234567890abcdef00002'];
  const defaultCreatorId = '65abcdef1234567890abcde1';

  console.log('Clearing existing paths and final projects...');
  await prisma.finalProject.deleteMany({});
  await prisma.learningPath.deleteMany({});

  console.log('Seeding 60 enriched learning paths with final projects...');

  let pathCount = 0;
  let projectCount = 0;

  for (const [categoryName, paths] of Object.entries(pathsData)) {
    const pipelineFactory = pipelineByCategory[categoryName] || devPipeline;

    for (let i = 0; i < paths.length; i++) {
      const def = paths[i];

      // --- Match courses by keyword ---
      const usedIds = new Set<string>();
      const matchedCourseIds: string[] = [];

      for (const keywords of def.matchers) {
        const matched = findCourse(courses, keywords, usedIds);
        if (matched) {
          matchedCourseIds.push(matched.id);
          usedIds.add(matched.id);
        }
      }

      const courseIdsToUse = matchedCourseIds.length > 0 ? matchedCourseIds : fallbackIds;

      // --- Build prerequisiteRules from index map ---
      let prerequisiteRules: any[] | undefined = undefined;
      if (def.prereqs && Object.keys(def.prereqs).length > 0 && matchedCourseIds.length > 1) {
        prerequisiteRules = [];
        for (const [idx, reqIndices] of Object.entries(def.prereqs)) {
          const courseIdx = parseInt(idx);
          if (courseIdx < matchedCourseIds.length) {
            const requiredIds = (reqIndices as number[])
              .filter(ri => ri < matchedCourseIds.length)
              .map(ri => matchedCourseIds[ri]);
            if (requiredIds.length > 0) {
              prerequisiteRules.push({
                courseId: matchedCourseIds[courseIdx],
                requiredCourseIds: requiredIds,
              });
            }
          }
        }
      }

      const slug = createSlug(`${def.title}-${Math.random().toString(36).substring(2, 6)}`);

      // --- Create LearningPath ---
      const learningPath = await prisma.learningPath.create({
        data: {
          title: def.title,
          description: def.desc,
          slug,
          category: categoryName,
          difficulty: def.diff as any,
          courseIds: courseIdsToUse,
          imageUrl: images[i % images.length],
          status: 'PUBLISHED',
          recommended: i === 0,
          careerGoal: def.careerGoal,
          skills: def.skills,
          shortDescription: def.shortDesc,
          totalDurationMinutes: def.duration,
          prerequisiteRules: prerequisiteRules || undefined,
          completionRule: 'ALL_COURSES',
        },
      });
      pathCount++;

      // --- Create FinalProject for this path ---
      const pipeline = pipelineFactory(def.title);
      await prisma.finalProject.create({
        data: {
          learningPathId: learningPath.id,
          title: def.projectTitle,
          description: `Bài kiểm tra cuối kỳ cho lộ trình "${def.title}". Hoàn thành project này để nhận "${def.certName}".`,
          instructions: `Hãy hoàn thành project theo các yêu cầu bên dưới. Bạn có thể nộp bài dưới dạng file PDF, link GitHub hoặc link Demo.\n\nSau khi hoàn thành tất cả khóa học trong lộ trình và đạt ≥ 80% điểm final project, bạn sẽ nhận được "${def.certName}".`,
          objectives: def.projectObjectives,
          maxScore: 100,
          passingScore: 80,
          maxAttempts: 3,
          evaluationPipeline: pipeline,
          createdBy: defaultCreatorId,
        },
      });
      projectCount++;
    }
  }

  console.log(`Successfully seeded ${pathCount} learning paths and ${projectCount} final projects!`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
