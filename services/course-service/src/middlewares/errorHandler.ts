import { Request, Response, NextFunction } from 'express';

export interface ApiError extends Error {
  status?: number;
  code?: string;
}

export const errorHandler = (
  err: ApiError,
  req: Request,
  res: Response,
  next: NextFunction
) => {
  const status = err.status || 500;
  const message = err.message || 'Internal Server Error';
  const code = err.code || 'INTERNAL_ERROR';

  console.error(`[COURSE-SERVICE] Error:`, {
    status,
    code,
    message,
    path: req.path,
    method: req.method,
    stack: err.stack,
  });

  res.status(status).json({
    error: {
      code,
      message,
      status,
      timestamp: new Date().toISOString(),
    },
  });
};
