import winston from 'winston';
import { redactSecrets } from './log-redaction';

// RAG-SEC-LOG-01: every entry is sanitized (JWT, Bearer, API keys, secret query parameters, axios configs) before any
// transport writes it; the service name is part of each entry.

const logger = winston.createLogger({
  level: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
  defaultMeta: { service: 'learning-service' },
  format: winston.format.combine(
    winston.format.errors({ stack: true }),
    redactSecrets(),
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.simple()
      ),
    }),
    new winston.transports.File({
      filename: 'error.log',
      level: 'error',
    }),
    new winston.transports.File({
      filename: 'combined.log',
    }),
  ],
});

export default logger;
