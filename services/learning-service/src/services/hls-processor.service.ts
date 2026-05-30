// services/hls-processor.service.ts
// FFmpeg-based video processor that converts MP4 → HLS (.m3u8 + .ts segments)
// and uploads the result to MinIO private bucket.

import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { minioInternalClient, BUCKETS } from '../config/minio.config';
import {
  VideoProcessJobData,
  VideoProcessResult,
  HLSOutputPaths,
  DEFAULT_FFMPEG_CONFIG,
  FFmpegConfig,
} from '../types/hls.types';
import logger from '../utils/logger';

// ============================================
// HLS Processor Service
// ============================================

export class HLSProcessorService {
  private static readonly TEMP_BASE_DIR = process.env.HLS_TEMP_DIR || '/tmp/hls-processing';

  /**
   * Main entry: convert a video file to HLS and upload to MinIO.
   *
   * Steps:
   * 1. Create temp output directory
   * 2. Run FFmpeg to generate .m3u8 + .ts files
   * 3. Upload all files to MinIO under {courseId}/{lessonId}/
   * 4. Clean up temp files
   * 5. Return the HLS path for database storage
   */
  static async processVideo(jobData: VideoProcessJobData): Promise<VideoProcessResult> {
    const { inputFilePath, courseId, lessonId, originalFileName } = jobData;

    logger.info(`[HLS] Starting processing: course=${courseId}, lesson=${lessonId}, file=${originalFileName}`);

    // Validate input file exists
    if (!fs.existsSync(inputFilePath)) {
      throw new Error(`Input video file not found: ${inputFilePath}`);
    }

    // Build output paths
    const outputPaths = this.buildOutputPaths(courseId, lessonId);

    try {
      // Step 1: Ensure temp directory
      this.ensureDirectory(outputPaths.localOutputDir);

      // Step 2: Run FFmpeg conversion
      const durationSeconds = await this.runFFmpeg(inputFilePath, outputPaths, DEFAULT_FFMPEG_CONFIG, courseId, lessonId);

      // Step 3: Upload all HLS files to MinIO
      const { segmentCount, totalSizeBytes } = await this.uploadHLSToMinIO(
        outputPaths.localOutputDir,
        outputPaths.prefix
      );

      logger.info(`[HLS] ✅ Processing complete: ${segmentCount} segments, ${(totalSizeBytes / 1024 / 1024).toFixed(2)}MB`);

      return {
        hlsPath: outputPaths.playlistPath,
        segmentCount,
        durationSeconds,
        totalSizeBytes,
      };
    } finally {
      // Step 4: Cleanup temp files (always, even on error)
      this.cleanupTempFiles(outputPaths.localOutputDir, inputFilePath);
    }
  }

  // ============================================
  // Private Helpers
  // ============================================

  /**
   * Build MinIO and local filesystem paths for HLS output.
   */
  private static buildOutputPaths(courseId: string, lessonId: string): HLSOutputPaths {
    const prefix = `${courseId}/${lessonId}`;
    const localOutputDir = path.join(this.TEMP_BASE_DIR, courseId, lessonId);

    return {
      prefix,
      playlistPath: `${prefix}/master.m3u8`,
      localOutputDir,
    };
  }

  /**
   * Ensure a directory exists, creating it recursively if needed.
   */
  private static ensureDirectory(dirPath: string): void {
    if (!fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath, { recursive: true });
    }
  }

  /**
   * Run FFmpeg to convert input video to HLS format.
   * Returns the video duration in seconds.
   *
   * FFmpeg command equivalent:
   *   ffmpeg -i input.mp4 \
   *     -codec:v libx264 -crf 23 -preset fast -profile:v main -level 3.1 \
   *     -codec:a aac -b:a 128k -ar 44100 \
   *     -start_number 0 -hls_time 10 -hls_list_size 0 \
   *     -hls_segment_filename 'output/%03d.ts' \
   *     -f hls output/master.m3u8
   */
  private static runFFmpeg(
    inputPath: string,
    outputPaths: HLSOutputPaths,
    config: FFmpegConfig,
    courseId: string,
    lessonId: string
  ): Promise<number> {
    return new Promise((resolve, reject) => {
      const playlistOutput = path.join(outputPaths.localOutputDir, 'master.m3u8');
      const segmentPattern = path.join(outputPaths.localOutputDir, '%03d.ts');
      const keyInfoFile = path.join(outputPaths.localOutputDir, 'key_info_file.txt');
      const keyFile = path.join(outputPaths.localOutputDir, 'encryption.key');

      // Generate AES-128 Key (16 bytes)
      const crypto = require('crypto');
      const key = crypto.randomBytes(16);
      const iv = crypto.randomBytes(16).toString('hex');
      
      fs.writeFileSync(keyFile, key);
      
      // key_info_file format:
      // URI for key (used by player)
      // Path to key file (used by ffmpeg)
      // IV (optional)
      const keyUri = `hls_key`; // A placeholder that we'll rewrite in HLSStreamService
      fs.writeFileSync(keyInfoFile, `${keyUri}\n${keyFile}\n${iv}`);

      const args = [
        '-i', inputPath,
        '-codec:v', config.videoCodec,
        '-crf', config.crf.toString(),
        '-preset', config.preset,
        '-profile:v', config.profile,
        '-level', config.level,
        '-codec:a', config.audioCodec,
        '-b:a', config.audioBitrate,
        '-ar', config.audioSampleRate.toString(),
        '-start_number', '0',
        '-hls_time', config.segmentDuration.toString(),
        '-hls_list_size', '0',          // Keep all segments in playlist
        '-hls_key_info_file', keyInfoFile,
        '-hls_segment_filename', segmentPattern,
        '-f', 'hls',
        playlistOutput,
        '-y',                            // Overwrite output files
      ];

      logger.info(`[HLS] FFmpeg command: ffmpeg ${args.join(' ')}`);

      const ffmpeg = spawn('ffmpeg', args);
      let stderr = '';
      let duration = 0;

      ffmpeg.stderr.on('data', (data: Buffer) => {
        const output = data.toString();
        stderr += output;

        // Parse duration from FFmpeg output
        const durationMatch = output.match(/Duration:\s*(\d+):(\d+):(\d+)/);
        if (durationMatch) {
          const hours = parseInt(durationMatch[1], 10);
          const minutes = parseInt(durationMatch[2], 10);
          const seconds = parseInt(durationMatch[3], 10);
          duration = hours * 3600 + minutes * 60 + seconds;
        }

        // Log progress
        const timeMatch = output.match(/time=\s*(\d+):(\d+):(\d+)/);
        if (timeMatch && duration > 0) {
          const currentTime =
            parseInt(timeMatch[1], 10) * 3600 +
            parseInt(timeMatch[2], 10) * 60 +
            parseInt(timeMatch[3], 10);
          const progress = Math.min(100, Math.round((currentTime / duration) * 100));
          logger.debug(`[HLS] FFmpeg progress: ${progress}%`);
        }
      });

      ffmpeg.on('close', (code) => {
        if (code === 0) {
          logger.info(`[HLS] FFmpeg completed successfully (duration: ${duration}s)`);
          resolve(duration);
        } else {
          logger.error(`[HLS] FFmpeg exited with code ${code}`);
          logger.error(`[HLS] FFmpeg stderr: ${stderr.slice(-2000)}`);
          reject(new Error(`FFmpeg process exited with code ${code}`));
        }
      });

      ffmpeg.on('error', (err) => {
        logger.error(`[HLS] FFmpeg spawn error:`, err);
        reject(new Error(`Failed to start FFmpeg: ${err.message}`));
      });
    });
  }

  /**
   * Upload all HLS files (.m3u8 + .ts) from local temp dir to MinIO.
   * Returns the number of segments and total size.
   */
  private static async uploadHLSToMinIO(
    localDir: string,
    minioPrefix: string
  ): Promise<{ segmentCount: number; totalSizeBytes: number }> {
    const bucket = BUCKETS.COURSE_VIDEOS;
    const files = fs.readdirSync(localDir);
    let segmentCount = 0;
    let totalSizeBytes = 0;

    logger.info(`[HLS] Uploading ${files.length} files to MinIO: ${bucket}/${minioPrefix}/`);

    // Upload files in parallel with concurrency limit
    const CONCURRENCY = 5;
    for (let i = 0; i < files.length; i += CONCURRENCY) {
      const batch = files.slice(i, i + CONCURRENCY);
      await Promise.all(
        batch.map(async (fileName) => {
          const localPath = path.join(localDir, fileName);
          const minioKey = `${minioPrefix}/${fileName}`;
          const stat = fs.statSync(localPath);

          totalSizeBytes += stat.size;

          // Determine content type
          let contentType = 'application/octet-stream';
          if (fileName.endsWith('.m3u8')) {
            contentType = 'application/vnd.apple.mpegurl';
          } else if (fileName.endsWith('.ts')) {
            contentType = 'video/mp2t';
            segmentCount++;
          } else if (fileName.endsWith('.key')) {
            contentType = 'application/octet-stream';
          }

          // Ignore txt files (e.g. key_info_file.txt)
          if (fileName.endsWith('.txt')) {
            return;
          }

          // Upload to MinIO
          await minioInternalClient.fPutObject(bucket, minioKey, localPath, {
            'Content-Type': contentType,
          });

          logger.debug(`[HLS] Uploaded: ${minioKey} (${(stat.size / 1024).toFixed(1)}KB)`);
        })
      );
    }

    logger.info(`[HLS] Upload complete: ${segmentCount} segments, ${files.length} total files`);
    return { segmentCount, totalSizeBytes };
  }

  /**
   * Clean up temporary files after processing.
   */
  private static cleanupTempFiles(outputDir: string, inputFile: string): void {
    try {
      // Remove output directory and all contents
      if (fs.existsSync(outputDir)) {
        fs.rmSync(outputDir, { recursive: true, force: true });
        logger.debug(`[HLS] Cleaned up temp output: ${outputDir}`);
      }

      // Remove the uploaded input file
      if (fs.existsSync(inputFile)) {
        fs.unlinkSync(inputFile);
        logger.debug(`[HLS] Cleaned up input file: ${inputFile}`);
      }
    } catch (error) {
      // Non-critical: log but don't throw
      logger.warn(`[HLS] Cleanup warning:`, error);
    }
  }

  /**
   * Delete all HLS files for a lesson from MinIO.
   * Used when re-processing or deleting a lesson.
   */
  static async deleteHLSFromMinIO(courseId: string, lessonId: string): Promise<void> {
    const bucket = BUCKETS.COURSE_VIDEOS;
    const prefix = `${courseId}/${lessonId}/`;

    try {
      const objectsList: string[] = [];
      const stream = minioInternalClient.listObjects(bucket, prefix, true);

      await new Promise<void>((resolve, reject) => {
        stream.on('data', (obj) => {
          if (obj.name) objectsList.push(obj.name);
        });
        stream.on('error', reject);
        stream.on('end', resolve);
      });

      if (objectsList.length > 0) {
        await minioInternalClient.removeObjects(bucket, objectsList);
        logger.info(`[HLS] Deleted ${objectsList.length} files from ${bucket}/${prefix}`);
      }
    } catch (error) {
      logger.error(`[HLS] Failed to delete HLS files from MinIO:`, error);
      throw error;
    }
  }
}
