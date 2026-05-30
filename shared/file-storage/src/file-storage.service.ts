import * as Minio from 'minio';
import { v4 as uuidv4 } from 'uuid';
import { minioConfig } from './minio.config';

export interface UploadOptions {
  bucket: string;
  fileName: string;
  mimeType: string;
  size?: number;
}

export interface UploadResult {
  uploadUrl: string;
  fileKey: string;
  publicUrl: string;
}

export class FileStorageService {
  private client: Minio.Client;
  private initializedBuckets: Set<string> = new Set();

  constructor() {
    this.client = new Minio.Client({
      endPoint: minioConfig.endPoint,
      port: minioConfig.port,
      useSSL: minioConfig.useSSL,
      accessKey: minioConfig.accessKey,
      secretKey: minioConfig.secretKey
    });
  }

  /**
   * Generate presigned URL for direct frontend upload
   */
  async getPresignedUploadUrl(options: UploadOptions): Promise<UploadResult> {
    const { bucket, fileName, mimeType } = options;
    
    // Ensure bucket exists
    await this.ensureBucket(bucket);
    
    // Generate unique file key
    const extension = fileName.split('.').pop();
    const timestamp = Date.now();
    const uniqueId = uuidv4();
    const fileKey = `${timestamp}-${uniqueId}.${extension}`;
    
    // Generate presigned URL (15 minutes expiry)
    // Create a temporary client pointing to the public URL so the S3 signature
    // correctly embeds the public Host header, avoiding SignatureDoesNotMatch errors.
    const publicUrlObj = new URL(minioConfig.publicUrl || 'http://localhost:9000');
    const publicClient = new Minio.Client({
      endPoint: publicUrlObj.hostname,
      port: parseInt(publicUrlObj.port || (publicUrlObj.protocol === 'https:' ? '443' : '80')),
      useSSL: publicUrlObj.protocol === 'https:',
      accessKey: minioConfig.accessKey,
      secretKey: minioConfig.secretKey,
      region: 'us-east-1' // Prevents internal bucket location network check
    });

    const uploadUrl = await publicClient.presignedPutObject(
      bucket,
      fileKey,
      15 * 60 // 15 minutes
    );
    
    const publicUrl = `${minioConfig.publicUrl}/${bucket}/${fileKey}`;
    
    return { uploadUrl, fileKey, publicUrl };
  }

  /**
   * Generate presigned URL for downloading a private file
   */
  async getPresignedDownloadUrl(bucket: string, fileKey: string, expirySeconds: number = 3600): Promise<string> {
    const publicUrlObj = new URL(minioConfig.publicUrl || 'http://localhost:9000');
    const publicClient = new Minio.Client({
      endPoint: publicUrlObj.hostname,
      port: parseInt(publicUrlObj.port || (publicUrlObj.protocol === 'https:' ? '443' : '80')),
      useSSL: publicUrlObj.protocol === 'https:',
      accessKey: minioConfig.accessKey,
      secretKey: minioConfig.secretKey,
      region: 'us-east-1'
    });
    
    return await publicClient.presignedGetObject(bucket, fileKey, expirySeconds);
  }

  /**
   * Get file stream directly from MinIO
   */
  async getFileStream(bucket: string, fileKey: string): Promise<NodeJS.ReadableStream> {
    return await this.client.getObject(bucket, fileKey);
  }

  /**
   * Delete a file from storage
   */
  async deleteFile(bucket: string, fileKey: string): Promise<void> {
    try {
      await this.client.removeObject(bucket, fileKey);
    } catch (error) {
      console.error(`Failed to delete file ${fileKey} from ${bucket}:`, error);
      throw error;
    }
  }

  /**
   * Check if file exists
   */
  async fileExists(bucket: string, fileKey: string): Promise<boolean> {
    try {
      await this.client.statObject(bucket, fileKey);
      return true;
    } catch (error) {
      return false;
    }
  }

  /**
   * Get file metadata
   */
  async getFileInfo(bucket: string, fileKey: string) {
    return await this.client.statObject(bucket, fileKey);
  }

  /**
   * Copy file between buckets or rename
   */
  async copyFile(sourceBucket: string, sourceKey: string, destBucket: string, destKey: string): Promise<void> {
    const conds = new Minio.CopyConditions();
    await this.client.copyObject(destBucket, destKey, `/${sourceBucket}/${sourceKey}`, conds);
  }

  /**
   * Ensure bucket exists with proper policies
   */
  private async ensureBucket(bucket: string): Promise<void> {
    if (this.initializedBuckets.has(bucket)) return;
    
    const exists = await this.client.bucketExists(bucket);
    if (!exists) {
      await this.client.makeBucket(bucket);
    }
    
    // Set public read policy for avatars or public buckets
    if (bucket === 'avatars' || bucket === 'public') {
      try {
        const policy = {
          Version: "2012-10-17",
          Statement: [
            {
              Effect: "Allow",
              Principal: { AWS: ["*"] },
              Action: ["s3:GetObject"],
              Resource: [`arn:aws:s3:::${bucket}/*`]
            }
          ]
        };
        await this.client.setBucketPolicy(bucket, JSON.stringify(policy));
      } catch (e) {
        console.error(`Failed to set bucket policy for ${bucket}:`, e);
      }
    }
    
    this.initializedBuckets.add(bucket);
  }
}

// Singleton instance
export const fileStorage = new FileStorageService();
