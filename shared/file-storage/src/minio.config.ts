export const minioConfig = {
  endPoint: process.env.MINIO_ENDPOINT || 'minio',
  port: parseInt(process.env.MINIO_PORT || '9000'),
  useSSL: process.env.MINIO_USE_SSL === 'true',
  accessKey: process.env.MINIO_ACCESS_KEY || 'minioadmin',
  secretKey: process.env.MINIO_SECRET_KEY || 'minioadmin123',
  publicUrl: process.env.MINIO_PUBLIC_URL || 'http://localhost:9000',
  buckets: {
    assignments: 'assignments',
    quizAttachments: 'quiz-attachments'
  }
};
