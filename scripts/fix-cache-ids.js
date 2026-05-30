const fs = require('fs');
const path = require('path');

const backendServices = [
  'auth-service',
  'user-service',
  'course-service',
  'order-service',
  'payment-service',
  'learning-service'
];

const basePath = 'd:\\HK\\HK8\\Cong_nghe_moi\\UMI-PROJECT\\services';

// Fix backend services
for (const service of backendServices) {
  const dockerfilePath = path.join(basePath, service, 'Dockerfile');
  if (!fs.existsSync(dockerfilePath)) continue;

  let content = fs.readFileSync(dockerfilePath, 'utf8');

  // Replace shared cache mount
  content = content.replace(/RUN --mount=type=cache,target=\/root\/\.npm npm install/g, `RUN --mount=type=cache,id=npm-shared,target=/root/.npm npm install`);
  
  // Replace service cache mount
  content = content.replace(/RUN --mount=type=cache,target=\/root\/\.npm if/g, `RUN --mount=type=cache,id=npm-${service},target=/root/.npm if`);

  fs.writeFileSync(dockerfilePath, content);
  console.log(`Fixed ${service}`);
}

// Fix frontend services
const frontendServices = ['frontend', 'admin-frontend'];
const rootPath = 'd:\\HK\\HK8\\Cong_nghe_moi\\UMI-PROJECT';

for (const service of frontendServices) {
  const dockerfilePath = path.join(rootPath, service, 'Dockerfile');
  if (!fs.existsSync(dockerfilePath)) continue;

  let content = fs.readFileSync(dockerfilePath, 'utf8');
  content = content.replace(/RUN --mount=type=cache,target=\/root\/\.npm npm install/g, `RUN --mount=type=cache,id=npm-${service},target=/root/.npm npm install`);

  fs.writeFileSync(dockerfilePath, content);
  console.log(`Fixed ${service}`);
}
