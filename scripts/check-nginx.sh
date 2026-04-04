#!/bin/bash
# scripts/check-nginx.sh

echo "Checking Nginx configuration..."

# Validate nginx.conf
docker run --rm -v $(pwd)/nginx:/etc/nginx:ro nginx:alpine nginx -t

if [ $? -eq 0 ]; then
    echo "✅ Nginx configuration is valid"
else
    echo "❌ Nginx configuration has errors"
    exit 1
fi

echo "Testing connectivity to services..."

# Test health endpoints
SERVICES=(
    "auth-service:3001/api/auth/health"
    "user-service:3002/api/users/health"
    "course-service:3003/api/courses/health"
    "order-service:3004/api/orders/health"
    "payment-service:3005/api/payments/health"
    "learning-service:3006/api/learning/health"
)

for service in "${SERVICES[@]}"; do
    echo -n "Testing $service... "
    
    # Note: This assumes the network name. Adjust if needed.
    # The user request used umi-project_elearning-network
    NETWORK_NAME=$(docker network ls --format "{{.Name}}" | grep "elearning-network" | head -n 1)
    
    if [ -z "$NETWORK_NAME" ]; then
        NETWORK_NAME="umi-project_elearning-network"
    fi

    docker run --rm --network "$NETWORK_NAME" \
        curlimages/curl:latest -s -o /dev/null -w "%{http_code}" \
        http://$service
    
    if [ $? -eq 0 ]; then
        echo "✅ OK"
    else
        echo "❌ Failed"
    fi
done

echo "✅ Nginx setup complete!"
