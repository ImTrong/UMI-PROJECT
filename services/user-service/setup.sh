#!/bin/bash

echo "Setting up User Service..."

# Check if Node.js is installed
if ! command -v node &> /dev/null; then
    echo "Node.js is not installed. Please install Node.js 18+"
    exit 1
fi

# Install dependencies
echo "Installing dependencies..."
npm install

# Generate Prisma client
echo "Generating Prisma client..."
npm run prisma:generate

# Push schema to database
echo "Pushing schema to database..."
npm run prisma:push

# Create .env file if it doesn't exist
if [ ! -f .env ]; then
    echo "Creating .env file..."
    cat > .env << EOL
PORT=3002
NODE_ENV=development

DATABASE_URL="mongodb://admin:securepassword123@localhost:27017/user_db?authSource=admin"

AUTH_SERVICE_URL="http://localhost:3001"
CORS_ORIGIN="http://localhost:3000,http://localhost:5173"

RATE_LIMIT_WINDOW_MS=900000
RATE_LIMIT_MAX_REQUESTS=100
EOL
    echo ".env file created successfully"
fi

echo "User Service setup complete!"

# Start development server
echo "Starting development server..."
npm run dev
