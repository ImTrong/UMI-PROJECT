#!/bin/bash

echo "Setting up Auth Service..."

# Install dependencies
npm install

# Generate Prisma client
npm run prisma:generate

# Push schema to database
npm run prisma:push

echo "Auth Service setup complete!"

# Start development server
npm run dev
