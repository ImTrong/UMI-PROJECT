import { PrismaClient } from '@prisma/client';
import axios from 'axios';

const prisma = new PrismaClient();

// Interface cho user từ auth service
interface AuthUser {
  id: string;
  email: string;
  fullName: string;
}

async function getUsersFromAuthService() {
  try {
    const authServiceUrl = process.env.AUTH_SERVICE_URL || 'http://localhost:3001';
    
    // Đăng nhập vào auth-service để lấy userIDs thật
    const accounts = [
      { email: 'admin@elearning.local', password: 'Admin123456' },
      { email: 'instructor@elearning.local', password: 'Instructor123' },
      { email: 'student@elearning.local', password: 'Student123' }
    ];
    
    const users = [];
    
    for (const account of accounts) {
      try {
        const response = await axios.post(`${authServiceUrl}/api/auth/login`, account);
        if (response.data && response.data.user) {
          users.push(response.data.user);
          console.log(`✅ Fetched valid auth ID for ${account.email}: ${response.data.user.id}`);
        }
      } catch (err: any) {
        console.log(`⚠️ Could not fetch user ${account.email} from auth service. It might not be seeded yet.`);
      }
    }
    
    return users;
  } catch (error) {
    console.error('Error fetching users from auth service:', error);
    return [];
  }
}

async function main() {
  console.log('🌱 Seeding user service database...');

  // Lấy danh sách users từ auth service (hoặc từ file config)
  const authUsers = await getUsersFromAuthService();

  for (const authUser of authUsers) {
    // Kiểm tra profile đã tồn tại chưa
    const existingProfile = await prisma.userProfile.findUnique({
      where: { email: authUser.email }
    });

    if (!existingProfile) {
      // Xác định role dựa trên email
      let role = 'STUDENT';
      if (authUser.email.includes('admin')) role = 'ADMIN';
      else if (authUser.email.includes('instructor')) role = 'INSTRUCTOR';

      // Tạo user profile
      const profile = await prisma.userProfile.create({
        data: {
          userId: authUser.id,
          email: authUser.email,
          fullName: authUser.fullName,
          role: role as any,
          isActive: true,
          bio: role === 'ADMIN' ? 'System Administrator' : 
               role === 'INSTRUCTOR' ? 'Experienced instructor' : 'Eager learner',
          preferences: {
            theme: 'light',
            notifications: true,
            language: 'en'
          },
          badges: role === 'ADMIN' ? ['admin'] : 
                  role === 'INSTRUCTOR' ? ['instructor'] : []
        }
      });

      console.log(`✅ Profile created for ${authUser.email} with role: ${role}`);

      // Tạo education background cho student/instructor
      if (role !== 'ADMIN') {
        await prisma.educationBackground.create({
          data: {
            userId: profile.id,
            institution: role === 'INSTRUCTOR' ? 'MIT University' : 'University of Technology',
            degree: role === 'INSTRUCTOR' ? 'Master of Science' : 'Bachelor of Science',
            fieldOfStudy: 'Computer Science',
            startDate: new Date('2020-09-01'),
            endDate: role === 'INSTRUCTOR' ? new Date('2022-06-01') : undefined,
            grade: '3.8',
          }
        });
        console.log(`   Added education for ${authUser.email}`);
      }

      // Tạo work experience cho instructor
      if (role === 'INSTRUCTOR') {
        await prisma.workExperience.create({
          data: {
            userId: profile.id,
            company: 'Tech Corp',
            position: 'Senior Software Engineer',
            startDate: new Date('2022-07-01'),
            current: true,
            description: 'Teaching and mentoring junior developers',
          }
        });
        console.log(`   Added work experience for ${authUser.email}`);
      }
    } else {
      console.log(`ℹ️ Profile already exists for ${authUser.email}`);
    }
  }

  // Hiển thị thông tin tài khoản
  console.log('\n📋 Default accounts created:');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('ADMIN ACCOUNT:');
  console.log('  Email: admin@elearning.local');
  console.log('  Password: Admin123456');
  console.log('  Role: ADMIN');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('INSTRUCTOR ACCOUNT:');
  console.log('  Email: instructor@elearning.local');
  console.log('  Password: Instructor123');
  console.log('  Role: INSTRUCTOR');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('STUDENT ACCOUNT:');
  console.log('  Email: student@elearning.local');
  console.log('  Password: Student123');
  console.log('  Role: STUDENT');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  console.log('✅ User service seeding completed!');
}

main()
  .catch((e) => {
    console.error('❌ Error seeding user service:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
