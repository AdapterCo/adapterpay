import pino, { type Logger } from 'pino';

/** Caminhos sempre removidos dos logs estruturados. Tokens MP nunca devem aparecer em logs. */
export const LOG_REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'res.headers["set-cookie"]',
  '*.password',
  '*.passwordHash',
  '*.access_token',
  '*.refresh_token',
  '*.accessToken',
  '*.refreshToken',
  '*.accessTokenEnc',
  '*.refreshTokenEnc',
  '*.client_secret',
  '*.mfaSecretEnc',
  '*.token',
  '*.code_verifier',
];

export function createLogger(name: string, level = process.env.LOG_LEVEL ?? 'info'): Logger {
  return pino({
    name,
    level,
    redact: { paths: LOG_REDACT_PATHS, censor: '[REDACTED]' },
    base: { service: name },
    timestamp: pino.stdTimeFunctions.isoTime,
    formatters: {
      level: (label) => ({ level: label }),
    },
  });
}

export type { Logger };
