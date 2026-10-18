import dotenv from 'dotenv';
import pino, { type Logger, type LoggerOptions } from 'pino';

// `server.ts` calls dotenv.config() after its imports are evaluated, so the
// logger loads the same file first; otherwise LOG_LEVEL/NODE_ENV from .env
// would not be visible when the logger is created.
dotenv.config({ path: process.env.NODE_ENV === 'test' ? '.env.test' : '.env', quiet: true });

const nodeEnv = process.env.NODE_ENV ?? 'development';
const isTest = nodeEnv === 'test';
const isDevelopment = nodeEnv !== 'production' && !isTest;

/** pino throws on unknown levels, so an invalid LOG_LEVEL falls back to the default. */
const LEVELS = new Set(['trace', 'debug', 'info', 'warn', 'error', 'fatal', 'silent']);

function resolveLevel(): string {
  const configured = process.env.LOG_LEVEL?.trim().toLowerCase();
  if (configured && LEVELS.has(configured)) return configured;
  if (isTest) return 'silent';
  return isDevelopment ? 'debug' : 'info';
}

function prettyTransport(): LoggerOptions['transport'] | undefined {
  if (!isDevelopment) return undefined;
  try {
    // Dev-only dependency: the runtime image installs production deps only.
    require.resolve('pino-pretty');
  } catch {
    return undefined;
  }
  return {
    target: 'pino-pretty',
    options: {
      colorize: true,
      translateTime: 'SYS:standard',
      singleLine: true,
      ignore: 'pid,hostname',
    },
  };
}

const options: LoggerOptions = {
  level: resolveLevel(),
  base: { service: 'story-creator' },
  timestamp: pino.stdTimeFunctions.isoTime,
  formatters: {
    // String levels let VictoriaLogs filter with `level:error`.
    level: (label) => ({ level: label }),
  },
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers["x-api-key"]',
      'req.headers.cookie',
      'res.headers["set-cookie"]',
      'req.body.password',
      'password',
      '*.password',
    ],
    remove: true,
  },
};

const transport = prettyTransport();

/** Structured JSON logger. Writes one line per record to stdout. */
export const logger: Logger = transport ? pino({ ...options, transport }) : pino(options);

/** Module-scoped child logger, mirroring Python's `logging.getLogger(__name__)`. */
export function createLogger(moduleName: string): Logger {
  return logger.child({ module: moduleName });
}
