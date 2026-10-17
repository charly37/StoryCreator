import express, { Request, Response, NextFunction } from 'express';
import mongoose from 'mongoose';
import ApiKey, { IApiKey } from '../models/ApiKey';
import User from '../models/User';
import {
  createApiKeyForUser,
  MAX_API_KEYS_PER_USER,
  API_KEY_SCOPE,
} from '../services/apiKeyService';

const router = express.Router();

const MAX_NAME_LENGTH = 50;

function requireAuth(req: Request, res: Response, next: NextFunction): void {
  if (!req.session.userId) {
    res.status(401).json({ message: 'Authentication required' });
    return;
  }
  next();
}

/** Mirrors the creator gate in `routes/stories.ts` — only creators may mint API keys. */
async function requireCreatePermission(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const user = await User.findById(req.session.userId).select('canCreateStories');
    if (!user || !user.canCreateStories) {
      res.status(403).json({ message: 'Creator access required', code: 'CREATOR_ACCESS_REQUIRED' });
      return;
    }
    next();
  } catch (error) {
    console.error('Error checking creator permission:', error);
    res.status(500).json({ message: 'Server error checking permissions' });
  }
}

/** Never exposes `keyHash` or `ownerId`. */
function serializeApiKey(apiKey: IApiKey) {
  return {
    id: apiKey._id.toString(),
    name: apiKey.name,
    prefix: apiKey.prefix,
    scopes: apiKey.scopes,
    createdAt: apiKey.createdAt,
    lastUsedAt: apiKey.lastUsedAt ?? null,
  };
}

// GET /api/keys — list the current user's keys
router.get('/', requireAuth, async (req: Request, res: Response) => {
  try {
    const keys = await ApiKey.find({ ownerId: req.session.userId }).sort({ createdAt: -1 });
    res.json({ keys: keys.map(serializeApiKey), maxKeys: MAX_API_KEYS_PER_USER });
  } catch (error) {
    console.error('Error fetching API keys:', error);
    res.status(500).json({ message: 'Server error fetching API keys' });
  }
});

// POST /api/keys — create a key; the raw secret is returned exactly once
router.post('/', requireAuth, requireCreatePermission, async (req: Request, res: Response) => {
  try {
    const rawName = req.body?.name;
    if (typeof rawName !== 'string' || rawName.trim() === '') {
      return res.status(400).json({ message: 'A key name is required' });
    }
    const name = rawName.trim();
    if (name.length > MAX_NAME_LENGTH) {
      return res.status(400).json({ message: `Key name cannot exceed ${MAX_NAME_LENGTH} characters` });
    }

    const result = await createApiKeyForUser(req.session.userId as string, name);
    if (!result.ok) {
      return res.status(400).json({
        message: `You can have at most ${MAX_API_KEYS_PER_USER} API keys. Revoke one to create another.`,
        code: result.code,
      });
    }

    res.status(201).json({
      key: result.rawKey,
      apiKey: {
        ...serializeApiKey(result.apiKey),
        scopes: [API_KEY_SCOPE],
      },
      warning: 'Store this key now. It cannot be retrieved again.',
    });
  } catch (error) {
    console.error('Error creating API key:', error);
    res.status(500).json({ message: 'Server error creating API key' });
  }
});

// DELETE /api/keys/:id — revoke (hard delete) a key owned by the current user
router.delete('/:id', requireAuth, async (req: Request, res: Response) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(404).json({ message: 'API key not found' });
    }

    const result = await ApiKey.deleteOne({ _id: req.params.id, ownerId: req.session.userId });
    if (result.deletedCount === 0) {
      return res.status(404).json({ message: 'API key not found' });
    }

    res.status(204).end();
  } catch (error) {
    console.error('Error revoking API key:', error);
    res.status(500).json({ message: 'Server error revoking API key' });
  }
});

export default router;
