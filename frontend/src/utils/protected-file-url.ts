/**
 * FIX-INS-07: the course-service's file download (GET /api/courses/files/download) only serves a paid lesson's video / document
 * to its learner, instructor or an admin. FIX-INS-08: the learning-service's (GET /api/learning/files/download) only serves a
 * submission file to its submitter, its graders or an admin. <video>, <img>, <a href> and PDF viewers cannot send an
 * Authorization header, so - like the Learning page already does for PDFs - the signed-in user's access token is added as
 * `token` to these two kinds of URL. Every other URL (thumbnails, external links, blob: URLs) is returned unchanged.
 */
const PROTECTED_DOWNLOADS = ['/api/courses/files/download', '/api/learning/files/download'];
export function withAccessToken(url: string | null | undefined): string {
  if (!url) return '';
  if (!PROTECTED_DOWNLOADS.some((prefix) => url.startsWith(prefix))) return url;
  let token: string | null = null;
  try {
    token = localStorage.getItem('accessToken');
  } catch {
    token = null;
  }
  if (!token) return url;
  return `${url}${url.includes('?') ? '&' : '?'}token=${encodeURIComponent(token)}`;
}
