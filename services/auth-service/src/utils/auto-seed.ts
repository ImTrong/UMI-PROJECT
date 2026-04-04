import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

export async function autoSeedAdmin() {
  // Chỉ chạy trong development mode
  if (process.env.NODE_ENV !== 'development') {
    console.log('Auto-seed skipped: Not in development mode');
    return;
  }

  const adminEmail = process.env.ADMIN_EMAIL || 'admin@elearning.local';
  const adminPassword = process.env.ADMIN_PASSWORD || 'Admin123456';

  // Kiểm tra nếu đã có admin
  const adminCount = await prisma.user.count({
    where: { email: adminEmail }
  });

  if (adminCount === 0) {
    console.log('🔧 No admin found. Creating default admin...');
    
    const hashedPassword = await bcrypt.hash(adminPassword, 10);
    
    await prisma.user.create({
      data: {
        email: adminEmail,
        password: hashedPassword,
        fullName: 'System Administrator',
        emailVerified: true,
        isActive: true,
      }
    });
    
    console.log(`✅ Default admin created: ${adminEmail} / ${adminPassword}`);
  }
}
