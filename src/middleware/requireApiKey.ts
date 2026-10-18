import { Request, Response, NextFunction } from 'express';
import { authenticateApiKey } from '../services/apiKeyService';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      apiKey?: {
        id: string;
        ownerId: string;
        name: string;
        scopes: string[];
      };
    }
  }
}

function sendError(res: Response, status: number, code: string, message: string): void {
  res.status(status).json({ error: { code, message } });
}

/** Accepts `Authorization: Bearer <key>` and, as a convenience, `X-API-Key: <key>`. */
function extractRawKey(req: Request): string | null {
  const authorization = req.headers.authorization;
  if (typeof authorization === 'string') {
    const match = /^Bearer\s+(.+)$/i.exec(authorization.trim());
    if (match) return match[1].trim();
  }

  const headerKey = req.headers['x-api-key'];
  if (typeof headerKey === 'string' && headerKey.trim() !== '') {
    return headerKey.trim();
  }

  return null;
}

/** Authenticates the key and attaches its identity to `req`. Does not check scopes. */
export async function requireApiKey(req: Request, res: Response, next: NextFunction): Promise<void> {
  const rawKey = extractRawKey(req);
  if (!rawKey) {
    sendError(res, 401, 'MISSING_API_KEY', 'Provide an API key via Authorization: Bearer <key>');
    return;
  }

  try {
    const identity = await authenticateApiKey(rawKey);
    if (!identity) {
      sendError(res, 401, 'INVALID_API_KEY', 'The provided API key is not valid');
      return;
    }

    req.apiKey = identity;
    next();
  } catch (error) {
    req.log.error({ err: error }, '[apiKey] Authentication failed');
    sendError(res, 500, 'SERVER_ERROR', 'Server error while authenticating the API key');
  }
}

/** Route-level scope guard; must run after `requireApiKey`. */
export function requireScope(scope: string) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.apiKey) {
      sendError(res, 401, 'MISSING_API_KEY', 'Provide an API key via Authorization: Bearer <key>');
      return;
    }
    if (!req.apiKey.scopes.includes(scope)) {
      sendError(res, 403, 'INSUFFICIENT_SCOPE', `This key is missing the "${scope}" scope`);
      return;
    }
    next();
  };
}
