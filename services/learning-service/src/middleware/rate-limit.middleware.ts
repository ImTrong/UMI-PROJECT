import rateLimit from 'express-rate-limit';
import { HTTP_STATUS } from '../utils/constants';

// For normal HLS streaming, a player fetches 1 segment every ~10 seconds.
// Max 6 segments per minute.
// We allow up to 30 requests per minute to account for initial buffering, seeking, and different bitrates.
// If an IP requests more than 30 segments in 1 minute, it's likely a parallel downloader extension.
export const hlsRateLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 30, // Limit each IP to 30 requests per `window` (here, per minute)
  message: {
    error: 'Too many stream requests from this IP, please try again after a minute. Mass downloading is strictly prohibited.'
  },
  standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
  legacyHeaders: false, // Disable the `X-RateLimit-*` headers
  handler: (req, res, next, options) => {
    res.status(HTTP_STATUS.TOO_MANY_REQUESTS).json(options.message);
  }
});

// A slightly more relaxed limiter for normal files (PDFs, etc)
export const fileRateLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 20, // 20 files per minute
  message: {
    error: 'Too many file requests from this IP, please try again after a minute.'
  },
  standardHeaders: true,
  legacyHeaders: false,
});
