// config/minio.config.ts
// MinIO client configuration for video streaming presigned URL generation.
// This client connects to the INTERNAL MinIO endpoint (within Docker network)
// for server-side operations, while presigned URLs use the PUBLIC endpoint
// so the browser can access them.

import * as Minio from 'minio';
import logger from '../utils/logger';

// ============================================
// MinIO Configuration Constants
// ============================================

export const MINIO_CONFIG = {
  /** Internal MinIO endpoint (Docker service name) */
  endPoint: process.env.MINIO_ENDPOINT || 'minio',
  /** MinIO S3 API port */
  port: parseInt(process.env.MINIO_PORT || '9000', 10),
  /** Whether to use SSL for MinIO connection */
  useSSL: process.env.MINIO_USE_SSL === 'true',
  /** MinIO access key (username) */
  accessKey: process.env.MINIO_ACCESS_KEY || 'minioadmin',
  /** MinIO secret key (password) */
  secretKey: process.env.MINIO_SECRET_KEY || 'minioadmin123',
  /** Public URL for presigned URL generation (accessible from browser) */
  publicUrl: process.env.MINIO_PUBLIC_URL || 'http://localhost:9000',
} as const;

// ============================================
// Bucket Names
// ============================================

export const BUCKETS = {
  /** Private bucket for course videos - NO public access */
  COURSE_VIDEOS: process.env.MINIO_VIDEO_BUCKET || 'course-videos',
  /** Existing public buckets */
  COURSES: 'courses',
  ASSIGNMENTS: 'assignments',
  QUIZ_ATTACHMENTS: 'quiz-attachments',
  CERTIFICATES: 'certificates',
} as const;

// ============================================
// Presigned URL Configuration
// ============================================

export const PRESIGNED_URL_CONFIG = {
  /** Presigned URL expiry in seconds (60 seconds for security) */
  VIDEO_EXPIRY_SECONDS: parseInt(process.env.PRESIGNED_URL_EXPIRY || '60', 10),
  /** Maximum allowed expiry (prevent misconfiguration) */
  MAX_EXPIRY_SECONDS: 300,
} as const;

// ============================================
// MinIO Client Instances
// ============================================

/**
 * Internal MinIO client - connects to MinIO within Docker network.
 * Used for bucket management, file stat checks, etc.
 */
const internalClient = new Minio.Client({
  endPoint: MINIO_CONFIG.endPoint,
  port: MINIO_CONFIG.port,
  useSSL: MINIO_CONFIG.useSSL,
  accessKey: MINIO_CONFIG.accessKey,
  secretKey: MINIO_CONFIG.secretKey,
});

/**
 * Public MinIO client - uses public URL for presigned URL generation.
 * The presigned URL must embed the public Host header so browsers
 * can use it directly without SignatureDoesNotMatch errors.
 */
function createPublicClient(): Minio.Client {
  const publicUrlObj = new URL(MINIO_CONFIG.publicUrl);
  return new Minio.Client({
    endPoint: publicUrlObj.hostname,
    port: parseInt(publicUrlObj.port || (publicUrlObj.protocol === 'https:' ? '443' : '80'), 10),
    useSSL: publicUrlObj.protocol === 'https:',
    accessKey: MINIO_CONFIG.accessKey,
    secretKey: MINIO_CONFIG.secretKey,
    region: 'us-east-1', // Prevents internal bucket location network check
  });
}

const publicClient = createPublicClient();

// ============================================
// Initialization
// ============================================

/**
 * Ensure the private course-videos bucket exists.
 * This bucket MUST NOT have public access policy.
 * Only presigned URLs can access its contents.
 */
export async function initializeVideosBucket(): Promise<void> {
  try {
    const bucketName = BUCKETS.COURSE_VIDEOS;
    const exists = await internalClient.bucketExists(bucketName);

    if (!exists) {
      await internalClient.makeBucket(bucketName);
      logger.info(`✅ Created private bucket: ${bucketName}`);
    }

    // IMPORTANT: Do NOT set any public access policy on this bucket.
    // The bucket remains private by default - only presigned URLs can access it.
    logger.info(`✅ Private video bucket "${bucketName}" is ready (no public access)`);
  } catch (error) {
    logger.error('❌ Failed to initialize video bucket:', error);
    throw error;
  }
}

/**
 * Ensure the certificates bucket exists and is public.
 * Certificates need to be publicly verifiable via link or QR code.
 */
export async function initializeCertificatesBucket(): Promise<void> {
  try {
    const bucketName = BUCKETS.CERTIFICATES;
    const exists = await internalClient.bucketExists(bucketName);

    if (!exists) {
      await internalClient.makeBucket(bucketName);
      logger.info(`✅ Created bucket: ${bucketName}`);
    }

    // Set public read policy for certificates
    const policy = {
      Version: "2012-10-17",
      Statement: [
        {
          Effect: "Allow",
          Principal: { AWS: ["*"] },
          Action: ["s3:GetObject"],
          Resource: [`arn:aws:s3:::${bucketName}/*`]
        }
      ]
    };
    await internalClient.setBucketPolicy(bucketName, JSON.stringify(policy));
    logger.info(`✅ Public certificates bucket "${bucketName}" is ready`);
  } catch (error) {
    logger.error('❌ Failed to initialize certificates bucket:', error);
    throw error;
  }
}

// ============================================
// Exports
// ============================================

export { internalClient as minioInternalClient, publicClient as minioPublicClient };
