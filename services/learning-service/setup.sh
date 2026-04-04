#!/bin/bash
echo "Setting up Learning Service..."
npm install
npm run prisma:generate
npm run prisma:push
mkdir -p certificates
cat > .env << EOL
PORT=3006
NODE_ENV=development
DATABASE_URL="mongodb://admin:securepassword123@localhost:27017/learning_db?authSource=admin"
AUTH_SERVICE_URL="http://localhost:3001"
USER_SERVICE_URL="http://localhost:3002"
COURSE_SERVICE_URL="http://localhost:3003"
ORDER_SERVICE_URL="http://localhost:3004"
CORS_ORIGIN="http://localhost:3000,http://localhost:5173"
CERTIFICATE_STORAGE_PATH="./certificates"
BASE_URL="http://localhost:3006"
EOL
echo "Learning Service setup complete!"
npm run dev
