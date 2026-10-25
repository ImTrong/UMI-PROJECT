import { PrismaClient } from '@prisma/client';
import { createHmac, timingSafeEqual } from 'crypto';
import logger from '../utils/logger';
import { checkServiceToken } from '../utils/service-token';

const prisma = new PrismaClient();

let fileStorage: any = null;
try {
  fileStorage = require('@umi/file-storage').fileStorage;
} catch {
  logger.warn('FileStorageService not available for learning-path images');
}

/**
 * FIX-INS-14 - learning-path images (LearningPath.imageUrl / bannerUrl) belong to the learning-service, which owns LearningPath.
 *
 *   Upload   POST /api/learning/admin/paths/upload-url (ADMIN). Bucket fixed here (learning-path-assets), image types only; the
 *            storage builds the key. Stored value: /api/learning/path-images/<key>.
 *   Legacy   images uploaded before through the course-service are stored as /api/courses/files/download?bucket=courses&key=<key>;
 *            the course-service no longer serves them (no course references them, FIX-INS-07). They are served here as
 *            /api/learning/path-images/legacy/<key> from the courses bucket - stored data is left as it is (no migration).
 *   Read     GET /api/learning/path-images[/legacy]/:key - <img> sends no Authorization header, so: an image referenced by a
 *            PUBLISHED path is served to anyone (it is shown in the public list); any other one only with a short-lived HMAC
 *            signature (exp + sig) that the API adds when it returns the path to a caller allowed to see it (ADMIN API, upload
 *            preview, or a learner allowed by PathAccessService) - see resolveRead. No bucket / key from the client is trusted on
 *            its own, no bearer token in the URL.
 *   Write    signed / legacy display URLs sent back by the admin form are normalised to the stored form.
 */
export const PATH_IMAGE_BUCKET = 'learning-path-assets';
const LEGACY_BUCKET = 'courses';
const CANONICAL_PREFIX = '/api/learning/path-images/';
const LEGACY_PREFIX = '/api/learning/path-images/legacy/';
const LEGACY_STORED_PREFIX = '/api/courses/files/download?bucket=courses&key=';
const SIGNED_TTL_SECONDS = 15 * 60;
const IMAGE_TYPES: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif' };
const KEY_PATTERN = /^[0-9]{10,16}-[A-Za-z0-9-]{1,64}\.(png|jpe?g|webp|gif)$/;

export type PathImageKind = 'current' | 'legacy';

export class PathImageError extends Error {
  constructor(message: string, public readonly statusCode: number) {
    super(message);
    this.name = 'PathImageError';
  }
}

/**
 * The HMAC key: PATH_IMAGE_SIGNING_SECRET, read from the environment at call time - the SAME value on every learning-service
 * instance and across restarts (docker-compose passes it, no default). Usable only if it is a printable secret of at least 32
 * characters, not a publicly known default and not one of the service credentials. There is NO fallback (no random per-process
 * key, no default): without a usable value nothing is signed or accepted - upload-url answers 500, images of non-PUBLISHED paths
 * are not displayable (published ones still are) - and the reason is logged.
 */
export const PATH_IMAGE_SIGNING_SECRET = 'PATH_IMAGE_SIGNING_SECRET';
export const MIN_SIGNING_SECRET_LENGTH = 32;
const OTHER_SECRETS = ['INTERNAL_SERVICE_TOKEN', 'COURSE_LEARNING_TOKEN', 'ORDER_LEARNING_TOKEN', 'AI_LEARNING_TOKEN'];
export type SigningSecretCheck = { ok: true; value: string } | { ok: false; reason: string };

export function readSigningSecret(): SigningSecretCheck {
  const check = checkServiceToken(PATH_IMAGE_SIGNING_SECRET, process.env[PATH_IMAGE_SIGNING_SECRET]);
  if (!check.ok) return check;
  if (check.value.length < MIN_SIGNING_SECRET_LENGTH) return { ok: false, reason: `${PATH_IMAGE_SIGNING_SECRET} is shorter than ${MIN_SIGNING_SECRET_LENGTH} characters` };
  if (OTHER_SECRETS.some((name) => process.env[name] === check.value)) return { ok: false, reason: `${PATH_IMAGE_SIGNING_SECRET} must differ from the service credentials` };
  return check;
}

let lastReportedReason = '';
function signingSecret(): string | null {
  const check = readSigningSecret();
  if (check.ok) {
    lastReportedReason = '';
    return check.value;
  }
  if (check.reason !== lastReportedReason) {
    lastReportedReason = check.reason;
    logger.error(`Learning-path image signing disabled: ${check.reason}`);
  }
  return null;
}

// report a missing / unusable secret at startup, not only at the first image request
signingSecret();

const mac = (secret: string, kind: PathImageKind, key: string, exp: number) => createHmac('sha256', secret).update(`${kind}:${key}:${exp}`).digest('hex');

export class PathImageService {
  static isValidKey(key: unknown): key is string {
    return typeof key === 'string' && KEY_PATTERN.test(key);
  }

  /** The stored value -> { kind, key } when it is one of our image forms; null for anything else (external URL, empty...). */
  static parseStored(url: unknown): { kind: PathImageKind; key: string } | null {
    if (typeof url !== 'string') return null;
    if (url.startsWith(LEGACY_STORED_PREFIX)) {
      const key = url.slice(LEGACY_STORED_PREFIX.length);
      return this.isValidKey(key) ? { kind: 'legacy', key } : null;
    }
    if (url.startsWith(CANONICAL_PREFIX) && !url.startsWith(LEGACY_PREFIX)) {
      const key = url.slice(CANONICAL_PREFIX.length);
      return this.isValidKey(key) ? { kind: 'current', key } : null;
    }
    return null;
  }

  static storedForm(kind: PathImageKind, key: string): string {
    return kind === 'legacy' ? `${LEGACY_STORED_PREFIX}${key}` : `${CANONICAL_PREFIX}${key}`;
  }

  /** A signed display URL, or null when no usable signing secret is configured. */
  static signedUrl(kind: PathImageKind, key: string, now = Date.now()): string | null {
    const secret = signingSecret();
    if (!secret) return null;
    const exp = Math.floor(now / 1000) + SIGNED_TTL_SECONDS;
    return `${kind === 'legacy' ? LEGACY_PREFIX : CANONICAL_PREFIX}${key}?exp=${exp}&sig=${mac(secret, kind, key, exp)}`;
  }

  static verifySignature(kind: PathImageKind, key: string, exp: unknown, sig: unknown, now = Date.now()): boolean {
    if (typeof exp !== 'string' || typeof sig !== 'string' || !/^\d{1,12}$/.test(exp) || !/^[0-9a-f]{64}$/.test(sig)) return false;
    const expNum = Number(exp);
    const nowSec = Math.floor(now / 1000);
    if (expNum < nowSec || expNum > nowSec + SIGNED_TTL_SECONDS + 60) return false;
    const secret = signingSecret();
    if (!secret) return false;
    return timingSafeEqual(Buffer.from(mac(secret, kind, key, expNum), 'hex'), Buffer.from(sig, 'hex'));
  }

  /** What the client gets for a stored image of a path with `status` (already authorised for this caller). */
  static presentUrl(url: unknown, status: string | null | undefined): any {
    const parsed = this.parseStored(url);
    if (!parsed) return url;
    const unsigned = parsed.kind === 'legacy' ? `${LEGACY_PREFIX}${parsed.key}` : `${CANONICAL_PREFIX}${parsed.key}`;
    if (status === 'PUBLISHED') return unsigned;
    // without a signing secret the URL stays unsigned: it is refused when read (nothing leaks), the path itself still loads
    return this.signedUrl(parsed.kind, parsed.key) ?? unsigned;
  }

  static presentPath<T extends Record<string, any> | null | undefined>(path: T): T {
    if (!path) return path;
    return { ...path, imageUrl: this.presentUrl(path.imageUrl, path.status), bannerUrl: this.presentUrl(path.bannerUrl, path.status) };
  }

  /** A display URL sent back by the admin form -> the stored form; anything else unchanged. */
  static normalizeIncoming(url: unknown): unknown {
    if (typeof url !== 'string') return url;
    const bare = url.split('?')[0];
    if (bare.startsWith(LEGACY_PREFIX)) {
      const key = bare.slice(LEGACY_PREFIX.length);
      if (!this.isValidKey(key)) throw new PathImageError('Invalid image URL', 400);
      return this.storedForm('legacy', key);
    }
    if (bare.startsWith(CANONICAL_PREFIX)) {
      const key = bare.slice(CANONICAL_PREFIX.length);
      if (!this.isValidKey(key)) throw new PathImageError('Invalid image URL', 400);
      return this.storedForm('current', key);
    }
    return url;
  }

  /** ADMIN upload URL for a new image; validated before storage is called. */
  static async createUploadUrl(fileName: unknown, contentType: unknown) {
    if (typeof fileName !== 'string' || typeof contentType !== 'string') throw new PathImageError('fileName and contentType are required', 400);
    const ext = fileName.includes('.') ? fileName.split('.').pop()!.toLowerCase() : '';
    if (!IMAGE_TYPES[ext] || IMAGE_TYPES[ext] !== contentType.toLowerCase()) {
      throw new PathImageError('Only PNG, JPEG, WEBP or GIF images are accepted', 400);
    }
    if (!fileStorage) throw new PathImageError('File storage service is not available', 503);
    // no preview URL can be signed without the secret: refuse before storage is called
    if (!readSigningSecret().ok) {
      signingSecret();
      throw new PathImageError('Image signing is not configured', 500);
    }
    const { uploadUrl, fileKey } = await fileStorage.getPresignedUploadUrl({ bucket: PATH_IMAGE_BUCKET, fileName: `image.${ext}`, mimeType: IMAGE_TYPES[ext] });
    if (!this.isValidKey(fileKey)) throw new PathImageError('Unexpected storage key', 500);
    // fileUrl is a signed preview (the path may still be a draft); saving the form stores the canonical form
    const fileUrl = this.signedUrl('current', fileKey);
    if (!fileUrl) throw new PathImageError('Image signing is not configured', 500);
    return { uploadUrl, fileKey, fileUrl };
  }

  /**
   * May this image be served? Returns the bucket to read from, or null (one answer for missing and forbidden).
   *   unsigned   only when a PUBLISHED learning path references exactly its stored form.
   *   signed     a valid signature (minted by this service for a caller allowed to see it). For the learning-path bucket that is
   *              enough - it is also the preview of an image just uploaded by an ADMIN, not saved on any path yet. A legacy image
   *              lives in the courses bucket (paid course files too), so it additionally needs a learning path referencing it.
   */
  static async resolveRead(kind: PathImageKind, key: unknown, exp: unknown, sig: unknown): Promise<{ bucket: string; key: string; contentType: string } | null> {
    if (!this.isValidKey(key)) return null;
    const signed = this.verifySignature(kind, key, exp, sig);
    if (!(signed && kind === 'current')) {
      const stored = this.storedForm(kind, key);
      const paths = await prisma.learningPath.findMany({ where: { OR: [{ imageUrl: stored }, { bannerUrl: stored }] }, select: { id: true, status: true, imageUrl: true, bannerUrl: true } });
      const referencing = paths.filter((p: any) => p.imageUrl === stored || p.bannerUrl === stored);
      if (referencing.length === 0) return null;
      if (!signed && !referencing.some((p: any) => p.status === 'PUBLISHED')) return null;
    }
    const ext = key.split('.').pop()!.toLowerCase();
    return { bucket: kind === 'legacy' ? LEGACY_BUCKET : PATH_IMAGE_BUCKET, key, contentType: IMAGE_TYPES[ext] };
  }

  static async openStream(bucket: string, key: string): Promise<NodeJS.ReadableStream> {
    if (!fileStorage) throw new PathImageError('File storage service is not available', 503);
    return fileStorage.getFileStream(bucket, key);
  }
}
