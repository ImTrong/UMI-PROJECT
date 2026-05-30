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

for (const service of backendServices) {
  const dockerfilePath = path.join(basePath, service, 'Dockerfile');
  if (!fs.existsSync(dockerfilePath)) continue;

  let content = fs.readFileSync(dockerfilePath, 'utf8');

  // Replace npm-shared with a unique ID per service to prevent lock contention during concurrent builds
  content = content.replace(/id=npm-shared,/g, `id=npm-shared-${service},`);

  fs.writeFileSync(dockerfilePath, content);
  console.log(`Fixed shared cache ID for ${service}`);
}
