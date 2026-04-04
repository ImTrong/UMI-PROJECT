#!/bin/bash
# scripts/generate-ssl.sh

echo "Generating SSL certificates for development..."

# Create SSL directory
mkdir -p nginx/ssl

# Generate private key and self-signed certificate
openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
    -keyout nginx/ssl/key.pem \
    -out nginx/ssl/cert.pem \
    -subj "/C=VN/ST=HCMC/L=HCMC/O=E-Learning/CN=localhost"

echo "✅ SSL certificates generated"
echo "   - Key: nginx/ssl/key.pem"
echo "   - Cert: nginx/ssl/cert.pem"
