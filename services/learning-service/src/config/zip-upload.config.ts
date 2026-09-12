import multer from 'multer';
import path from 'path';
import { ZIP_SECURITY_DEFAULTS } from '../utils/constants';

/**
 * Multer configuration for ZIP file uploads
 * Used for final project source code submissions
 */
const zipStorage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    const uploadDir = process.env.ZIP_UPLOAD_DIR || '/tmp/project-uploads';
    cb(null, uploadDir);
  },
  filename: (_req, file, cb) => {
    const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    const ext = path.extname(file.originalname);
    cb(null, `project-${uniqueSuffix}${ext}`);
  },
});

const zipFileFilter = (_req: any, file: Express.Multer.File, cb: multer.FileFilterCallback) => {
  const allowedMimes = ['application/zip', 'application/x-zip-compressed', 'application/x-zip'];
  const allowedExts = ['.zip'];
  const ext = path.extname(file.originalname).toLowerCase();

  if (allowedMimes.includes(file.mimetype) || allowedExts.includes(ext)) {
    cb(null, true);
  } else {
    cb(new Error('Chỉ chấp nhận file ZIP (.zip)'));
  }
};

export const zipUpload = multer({
  storage: zipStorage,
  fileFilter: zipFileFilter,
  limits: {
    fileSize: ZIP_SECURITY_DEFAULTS.MAX_ZIP_SIZE_MB * 1024 * 1024,
  },
});
