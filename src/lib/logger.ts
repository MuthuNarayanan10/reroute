import pino from 'pino';

export const logger = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  base: { service: process.env.SERVICE_NAME ?? 'reroute' },
  redact: {
    // Never log secrets or raw customer PII.
    paths: [
      'req.headers.authorization',
      'req.headers["x-shopify-hmac-sha256"]',
      '*.accessToken',
      '*.access_token',
      '*.phone',
      '*.email',
      '*.address1',
      '*.address2',
    ],
    censor: '[redacted]',
  },
  transport:
    process.env.NODE_ENV === 'development' ? { target: 'pino-pretty', options: { colorize: true } } : undefined,
});
