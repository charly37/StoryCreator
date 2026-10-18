import express, { Request, Response } from 'express';
import path from 'path';
import { randomUUID } from 'node:crypto';
import session from 'express-session';
import MongoStore from 'connect-mongo';
import cors from 'cors';
import { rateLimit, ipKeyGenerator } from 'express-rate-limit';
import pinoHttp from 'pino-http';
import dotenv from 'dotenv';
import connectDB from './config/database';
import { logger } from './config/logger';
import authRoutes from './routes/auth';
import storyRoutes from './routes/stories';
import apiKeyRoutes from './routes/apiKeys';
import publicApiRoutes from './routes/publicApi';
import { requireApiKey } from './middleware/requireApiKey';

const envFile = process.env.NODE_ENV === 'test' ? '.env.test' : '.env';
dotenv.config({ path: envFile, quiet: true });

const app = express();
const PORT = parseInt(process.env.PORT || '3000', 10);

const configuredRateLimit = parseInt(process.env.PUBLIC_API_RATE_LIMIT_PER_MIN || '60', 10);
const PUBLIC_API_RATE_LIMIT_PER_MIN =
  Number.isFinite(configuredRateLimit) && configuredRateLimit > 0 ? configuredRateLimit : 60;

// Rate limits are per API key; the IP fallback only applies if the key was not resolved.
const publicApiLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: PUBLIC_API_RATE_LIMIT_PER_MIN,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  keyGenerator: (req) => req.apiKey?.id ?? ipKeyGenerator(req.ip || ''),
  handler: (_req, res) => {
    res.status(429).json({
      error: { code: 'RATE_LIMITED', message: 'Too many requests. Please retry later.' },
    });
  },
});

connectDB().then(() => {
  app.listen(PORT, '0.0.0.0', () => {
    logger.info({ port: PORT, nodeEnv: process.env.NODE_ENV ?? 'development' }, 'Server listening');
  });
}).catch((err) => {
  logger.fatal({ err }, 'Failed to initialise');
  process.exit(1);
});

app.set('trust proxy', 1);
app.disable('x-powered-by');

// No access logs (autoLogging: false); pino-http only attaches `req.id`/`req.log`
// so error records can carry a request correlation id.
app.use(
  pinoHttp<Request, Response>({
    logger,
    autoLogging: false,
    genReqId: (req, res) => {
      const incoming = req.headers['x-request-id'];
      const id = typeof incoming === 'string' && incoming.trim() !== '' ? incoming.trim() : randomUUID();
      res.setHeader('X-Request-Id', id);
      return id;
    },
    customProps: (req) => (req.apiKey ? { apiKeyId: req.apiKey.id } : {}),
  })
);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(
  session({
    secret: process.env.SESSION_SECRET || 'change-this-secret-in-production',
    resave: false,
    saveUninitialized: false,
    store: MongoStore.create({
      mongoUrl: process.env.MONGODB_URI,
      touchAfter: 24 * 3600,
    }),
    cookie: {
      maxAge: 1000 * 60 * 60 * 24 * 7,
      httpOnly: true,
      secure: false,
      sameSite: 'lax',
    },
  })
);

app.use('/api/auth', authRoutes);
app.use('/api/stories', storyRoutes);
app.use('/api/keys', apiKeyRoutes);

app.get('/api/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok' });
});

// Public API v1 — key required. CORS handles (and terminates) OPTIONS preflight,
// so unauthenticated browsers can negotiate before sending the keyed request.
app.use(
  '/api/v1',
  cors({
    origin: '*',
    methods: ['GET', 'POST'],
    allowedHeaders: ['Authorization', 'X-API-Key', 'Content-Type', 'Idempotency-Key'],
    maxAge: 86400,
  }),
  requireApiKey,
  publicApiLimiter,
  publicApiRoutes
);

app.use(express.static(path.join(__dirname, '../public')));

// SPA catch-all — must be last
app.get('/{*path}', (_req: Request, res: Response) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

export default app;
