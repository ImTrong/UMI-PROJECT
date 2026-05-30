// config/multer.config.ts
// Multer configuration for video file uploads.
// Stores uploaded files in a temp directory for FFmpeg processing.

import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { v4 as uuidv4 } from 'uuid';

// ============================================
// Upload Directory
// ============================================

const UPLOAD_DIR = process.env.VIDEO_UPLOAD_DIR || '/tmp/video-uploads';

// Ensure upload directory exists
if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

// ============================================
// Storage Configuration
// ============================================

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, UPLOAD_DIR);
  },
  filename: (_req, file, cb) => {
    // Generate unique filename to avoid collisions
    const ext = path.extname(file.originalname);
    const uniqueName = `${uuidv4()}${ext}`;
    cb(null, uniqueName);
  },
});

// ============================================
// File Filter
// ============================================

const fileFilter = (_req: any, file: Express.Multer.File, cb: multer.FileFilterCallback) => {
  const allowedMimeTypes = [
    'video/mp4',
    'video/quicktime',     // .mov
    'video/x-msvideo',     // .avi
    'video/x-matroska',    // .mkv
    'video/webm',          // .webm
  ];

  if (allowedMimeTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error(`Invalid file type: ${file.mimetype}. Allowed: mp4, mov, avi, mkv, webm`));
  }
};

// ============================================
// Multer Instance
// ============================================

/** Max file size: 2GB */
const MAX_FILE_SIZE = parseInt(process.env.MAX_VIDEO_SIZE_MB || '2048', 10) * 1024 * 1024;

export const videoUpload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: MAX_FILE_SIZE,
  },
});
