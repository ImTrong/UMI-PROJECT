// types/hls.types.ts
// TypeScript types for the HLS video processing and streaming system.

// ============================================
// Video Processing Types
// ============================================

/** Status of a video processing job */
export enum VideoProcessingStatus {
  PENDING = 'PENDING',
  PROCESSING = 'PROCESSING',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
}

/** Data required to enqueue a video processing job */
export interface VideoProcessJobData {
  /** Original video file path on disk (temp) */
  inputFilePath: string;
  /** Course ID the lesson belongs to */
  courseId: string;
  /** Lesson ID being processed */
  lessonId: string;
  /** Original filename for logging */
  originalFileName: string;
  /** User (instructor) who uploaded the video */
  uploadedBy: string;
}

/** Result of a completed video processing job */
export interface VideoProcessResult {
  /** MinIO path to the master.m3u8 playlist */
  hlsPath: string;
  /** Number of .ts segments generated */
  segmentCount: number;
  /** Total duration in seconds */
  durationSeconds: number;
  /** Total size of all HLS files in bytes */
  totalSizeBytes: number;
}

// ============================================
// HLS File Structure
// ============================================

/**
 * HLS output directory structure in MinIO:
 *
 *   course-videos/
 *     {courseId}/
 *       {lessonId}/
 *         master.m3u8      ← main playlist
 *         000.ts           ← segment 0
 *         001.ts           ← segment 1
 *         002.ts           ← segment 2
 *         ...
 */

export interface HLSOutputPaths {
  /** MinIO prefix: {courseId}/{lessonId}/ */
  prefix: string;
  /** Full path to master.m3u8 */
  playlistPath: string;
  /** Local temp directory where FFmpeg outputs files */
  localOutputDir: string;
}

// ============================================
// FFmpeg Configuration
// ============================================

export interface FFmpegConfig {
  /** Duration of each .ts segment in seconds */
  segmentDuration: number;
  /** Video codec (e.g., 'libx264') */
  videoCodec: string;
  /** Audio codec (e.g., 'aac') */
  audioCodec: string;
  /** Constant Rate Factor for quality (18=high, 23=medium, 28=low) */
  crf: number;
  /** H.264 preset (ultrafast, fast, medium, slow) */
  preset: string;
  /** H.264 profile */
  profile: string;
  /** H.264 level */
  level: string;
  /** Audio bitrate */
  audioBitrate: string;
  /** Audio sample rate */
  audioSampleRate: number;
}

export const DEFAULT_FFMPEG_CONFIG: FFmpegConfig = {
  segmentDuration: 10,
  videoCodec: 'libx264',
  audioCodec: 'aac',
  crf: 23,
  preset: 'fast',
  profile: 'main',
  level: '3.1',
  audioBitrate: '128k',
  audioSampleRate: 44100,
};

// ============================================
// HLS Streaming Response Types
// ============================================

/** Response for GET /api/learning/lessons/:lessonId/hls */
export interface HLSStreamResponse {
  /** Presigned URL to the master.m3u8 playlist */
  streamUrl: string;
  /** URL expiry in seconds */
  expiresIn: number;
  /** Lesson metadata */
  lesson: {
    id: string;
    title: string;
    duration: number;
    order: number;
  };
  /** HLS-specific metadata */
  hls: {
    /** Whether HLS processing is complete */
    ready: boolean;
    /** Number of segments */
    segmentCount?: number;
  };
}

/** Response for POST /api/learning/lessons/:lessonId/upload-video */
export interface VideoUploadResponse {
  message: string;
  jobId: string;
  status: VideoProcessingStatus;
}

/** Response for GET /api/learning/video-jobs/:jobId/status */
export interface VideoJobStatusResponse {
  jobId: string;
  status: VideoProcessingStatus;
  progress?: number;
  hlsPath?: string;
  error?: string;
  createdAt: string;
  updatedAt: string;
}

// ============================================
// Multer File Type Extension
// ============================================

export interface UploadedVideoFile {
  fieldname: string;
  originalname: string;
  encoding: string;
  mimetype: string;
  destination: string;
  filename: string;
  path: string;
  size: number;
}
