import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Seeding auth service database...');

  const adminEmail = process.env.ADMIN_EMAIL || 'admin@elearning.local';
  const adminPassword = process.env.ADMIN_PASSWORD || 'Admin123456';
  const adminFullName = process.env.ADMIN_FULL_NAME || 'System Administrator';

  // Kiểm tra admin đã tồn tại chưa
  const existingAdmin = await prisma.user.findUnique({
    where: { email: adminEmail }
  });

  if (!existingAdmin) {
    // Hash password
    const hashedPassword = await bcrypt.hash(adminPassword, 10);

    // Tạo admin user
    const admin = await prisma.user.create({
      data: {
        email: adminEmail,
        password: hashedPassword,
        fullName: adminFullName,
        emailVerified: true,
        isActive: true,
        lastLogin: new Date(),
      }
    });

    console.log(`✅ Admin user created in auth service:`);
    console.log(`   Email: ${admin.email}`);
    console.log(`   ID: ${admin.id}`);
    
    // Tạo refresh token cho admin (optional)
    // Không cần thiết vì khi login sẽ tạo mới
  } else {
    console.log(`ℹ️ Admin user already exists: ${existingAdmin.email}`);
  }

  // Tạo một số user test (optional)
  const testUsers = [
    {
      email: 'instructor@elearning.local',
      password: 'Instructor123',
      fullName: 'John Instructor',
    },
    {
      email: 'student@elearning.local',
      password: 'Student123',
      fullName: 'Jane Student',
    }
  ];

  for (const userData of testUsers) {
    const existingUser = await prisma.user.findUnique({
      where: { email: userData.email }
    });

    if (!existingUser) {
      const hashedPassword = await bcrypt.hash(userData.password, 10);
      const user = await prisma.user.create({
        data: {
          email: userData.email,
          password: hashedPassword,
          fullName: userData.fullName,
          emailVerified: true,
          isActive: true,
        }
      });
      console.log(`✅ Test user created: ${user.email}`);
    }
  }

  console.log('✅ Auth service seeding completed!');
}

main()
  .catch((e) => {
    console.error('❌ Error seeding auth service:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
