import pino from 'pino';
import { config } from './config';

// Redaction list: anything that could leak a credential, secret, or PII
// into log output. This is intentionally broad — better to over-redact
// than to leak a password hash or bearer token into a log aggregator.
const REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.body.password',
  'req.body.newPassword',
  'req.body.accessToken',
  'req.body.refreshToken',
  'req.body.token',
  'res.headers["set-cookie"]',
  '*.password',
  '*.password_hash',
  '*.passwordHash',
  '*.token',
  '*.tokenHash',
  '*.accessToken',
  '*.refreshToken',
];

export const logger = pino({
  level: config.NODE_ENV === 'test' ? 'silent' : process.env.LOG_LEVEL ?? 'info',
  redact: {
    paths: REDACT_PATHS,
    censor: '[REDACTED]',
  },
  transport:
    config.NODE_ENV === 'development'
      ? { target: 'pino-pretty', options: { colorize: true, translateTime: 'HH:MM:ss' } }
      : undefined,
});
