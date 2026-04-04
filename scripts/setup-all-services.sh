#!/bin/bash

echo "🚀 Setting up all services with seed data..."

# Màu sắc cho output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Function to run seed for a service
run_seed() {
    local service=$1
    echo -e "${YELLOW}📦 Seeding ${service}...${NC}"
    
    cd services/${service}
    
    if [ -f "prisma/seed.ts" ]; then
        npx prisma db push --force-reset
        npx ts-node prisma/seed.ts
        echo -e "${GREEN}✅ ${service} seeded successfully${NC}"
    else
        echo -e "${RED}❌ No seed file found for ${service}${NC}"
    fi
    
    cd ../..
    echo ""
}

# Check if services are running
echo -e "${YELLOW}Checking services...${NC}"

# Run seeds for each service
run_seed "auth-service"
run_seed "user-service"

echo -e "${GREEN}🎉 All services seeded successfully!${NC}"
echo ""
echo "Default admin credentials:"
echo "  Email: admin@elearning.local"
echo "  Password: Admin123456"
echo ""
echo "To login, run:"
echo "curl -X POST http://localhost:3001/api/auth/login \\"
echo "  -H \"Content-Type: application/json\" \\"
echo "  -d '{\"email\":\"admin@elearning.local\",\"password\":\"Admin123456\"}'"
