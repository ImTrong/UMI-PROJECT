const fs = require('fs');
const path = require('path');

const services = [
  'auth-service',
  'user-service',
  'course-service',
  'order-service',
  'payment-service',
  'learning-service'
];

const basePath = 'd:\\HK\\HK8\\Cong_nghe_moi\\UMI-PROJECT\\services';

for (const service of services) {
  const dockerfilePath = path.join(basePath, service, 'Dockerfile');
  if (!fs.existsSync(dockerfilePath)) continue;

  let content = fs.readFileSync(dockerfilePath, 'utf8');

  // Skip if already optimized
  if (content.includes('COPY shared/file-storage/package*.json ./shared/file-storage/')) {
    console.log(`${service} already optimized`);
    continue;
  }

  // Replace Stage 1 logic
  const stage1Regex = /# Copy root package files \(if workspace\)\s+COPY package\*\.json \.\/\s+# Copy shared module\s+COPY shared\/file-storage \.\/shared\/file-storage\s+# Build shared module\s+WORKDIR \/app\/shared\/file-storage\s+RUN npm install && npm run build\s+# Copy package files first to cache npm install\s+WORKDIR \/app\/services\/[a-zA-Z0-9-]+\s+COPY services\/[a-zA-Z0-9-]+\/package\*\.json \.\/\s+# Install service dependencies\s+RUN apk add --no-cache openssl libc6-compat\s+RUN if \[ -f package-lock\.json \]; then npm ci; else npm install; fi\s+# Copy service code\s+WORKDIR \/app\s+COPY services\/[a-zA-Z0-9-]+ \.\/services\/[a-zA-Z0-9-]+\s+WORKDIR \/app\/services\/[a-zA-Z0-9-]+/m;

  const newLogic = `# 1. Cache shared module dependencies
COPY shared/file-storage/package*.json ./shared/file-storage/
WORKDIR /app/shared/file-storage
RUN --mount=type=cache,target=/root/.npm npm install

# 2. Cache service dependencies
WORKDIR /app/services/${service}
COPY services/${service}/package*.json ./
RUN apk add --no-cache openssl libc6-compat
RUN --mount=type=cache,target=/root/.npm if [ -f package-lock.json ]; then npm ci; else npm install; fi

# 3. Build shared module
WORKDIR /app
COPY shared/file-storage ./shared/file-storage
WORKDIR /app/shared/file-storage
RUN npm run build

# 4. Copy service code
WORKDIR /app
COPY services/${service} ./services/${service}
WORKDIR /app/services/${service}`;

  if (stage1Regex.test(content)) {
    content = content.replace(stage1Regex, newLogic);
    fs.writeFileSync(dockerfilePath, content);
    console.log(`Optimized ${service}`);
  } else {
    console.log(`Regex did not match for ${service}, dumping snippet:`);
    console.log(content.substring(0, 1000));
  }
}
