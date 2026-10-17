import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import ApiKey, { IApiKey } from '../models/ApiKey';

/** Prefix of every StoryCreator API key. Stored in cleartext so lookups stay index-friendly. */
const KEY_PREFIX = 'stc_live_';
/** 8 random characters after the fixed prefix are enough to locate a key. */
const PREFIX_LENGTH = KEY_PREFIX.length + 8;
/** 24 random bytes → 32 base64url characters. */
const SECRET_BYTES = 24;
/** Avoid a database write on every request from the same key. */
const LAST_USED_TOUCH_MS = 5 * 60 * 1000;

export const API_KEY_SCOPE = 'stories:read';
export const MAX_API_KEYS_PER_USER = 5;

export interface ApiKeyIdentity {
  id: string;
  ownerId: string;
  scopes: string[];
}

export interface GeneratedKeyMaterial {
  rawKey: string;
  prefix: string;
  keyHash: string;
}

export function hashApiKey(rawKey: string): string {
  return createHash('sha256').update(rawKey).digest('hex');
}

export function generateKeyMaterial(): GeneratedKeyMaterial {
  const rawKey = `${KEY_PREFIX}${randomBytes(SECRET_BYTES).toString('base64url')}`;
  return {
    rawKey,
    prefix: rawKey.slice(0, PREFIX_LENGTH),
    keyHash: hashApiKey(rawKey),
  };
}

function looksLikeApiKey(rawKey: string): boolean {
  if (!rawKey.startsWith(KEY_PREFIX)) return false;
  return rawKey.length > PREFIX_LENGTH + 8 && rawKey.length <= 128;
}

/**
 * Resolves a raw API key to its identity, or `null` if it is unknown.
 * Uses a prefix index lookup followed by a constant-time hash comparison.
 */
export async function authenticateApiKey(rawKey: string): Promise<ApiKeyIdentity | null> {
  const candidate = typeof rawKey === 'string' ? rawKey.trim() : '';
  if (!looksLikeApiKey(candidate)) return null;

  const prefix = candidate.slice(0, PREFIX_LENGTH);
  const record: IApiKey | null = await ApiKey.findOne({ prefix }).select('+keyHash');
  if (!record) return null;

  const expected = Buffer.from(record.keyHash, 'hex');
  const actual = Buffer.from(hashApiKey(candidate), 'hex');
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;

  const lastUsed = record.lastUsedAt ? record.lastUsedAt.getTime() : 0;
  if (Date.now() - lastUsed > LAST_USED_TOUCH_MS) {
    // Fire-and-forget: usage tracking must never fail the request.
    void ApiKey.updateOne({ _id: record._id }, { $set: { lastUsedAt: new Date() } }).catch((error) => {
      console.error('[apiKey] Failed to update lastUsedAt:', error);
    });
  }

  return {
    id: record._id.toString(),
    ownerId: record.ownerId.toString(),
    scopes: record.scopes ?? [],
  };
}

export type CreateApiKeyResult =
  | { ok: true; rawKey: string; apiKey: IApiKey }
  | { ok: false; code: 'API_KEY_LIMIT_REACHED' };

/** Creates a key for a user, retrying on the (astronomically unlikely) prefix/hash collision. */
export async function createApiKeyForUser(ownerId: string, name: string): Promise<CreateApiKeyResult> {
  const existing = await ApiKey.countDocuments({ ownerId });
  if (existing >= MAX_API_KEYS_PER_USER) {
    return { ok: false, code: 'API_KEY_LIMIT_REACHED' };
  }

  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    const material = generateKeyMaterial();
    try {
      const apiKey = await ApiKey.create({
        name,
        prefix: material.prefix,
        keyHash: material.keyHash,
        ownerId,
        scopes: [API_KEY_SCOPE],
      });
      return { ok: true, rawKey: material.rawKey, apiKey };
    } catch (error) {
      if ((error as { code?: number }).code === 11000) {
        lastError = error;
        continue;
      }
      throw error;
    }
  }

  throw lastError ?? new Error('Failed to generate a unique API key');
}
