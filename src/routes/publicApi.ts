import express, { Request, Response } from 'express';
import mongoose from 'mongoose';
import Story from '../models/Story';
import User from '../models/User';
import { LANGUAGES } from '../client/utils/languages';
import { requireScope } from '../middleware/requireApiKey';
import { API_KEY_SCOPE, API_KEY_WRITE_SCOPE } from '../services/apiKeyService';
import {
  ALLOWED_AI_MODELS,
  DEFAULT_AI_MODEL,
  startStoryGeneration,
} from '../services/storyGenerationService';
import {
  DEFAULT_SENTENCES_PER_CHAPTER,
  MAX_CHAPTERS_PER_STORY,
  MAX_TARGET_SENTENCES,
  clampInt,
  sanitizeAIGuideline,
  sanitizeCharacters,
  sanitizeLabels,
} from '../services/storyInput';
import { sanitizeTitle } from '../services/aiService';
import {
  toPublicStoryDetail,
  toPublicStorySummary,
  StoryLike,
} from '../serializers/publicStory';

const router = express.Router();

const LEVELS = ['beginner', 'intermediate', 'advanced'] as const;
const LANGUAGE_CODES = new Set(LANGUAGES.map((language) => language.code));
const DEFAULT_LIMIT = 12;
const MAX_LIMIT = 50;
const MAX_SEARCH_LENGTH = 100;
const MAX_USERNAME_LENGTH = 30;
const MAX_IDEMPOTENCY_KEY_LENGTH = 200;

// Everything the summary needs; chapter bodies are excluded from list responses.
const LIST_PROJECTION =
  'title chapters.title sentenceCount nativeLanguage learningLanguage level labels topic authorName creationSource createdViaApiKeyName isAIGenerated aiModel createdAt updatedAt';

function sendError(res: Response, status: number, code: string, message: string): void {
  res.status(status).json({ error: { code, message } });
}

/** Returns `undefined` when absent, `null` when present but not a plain string. */
function readString(value: unknown): string | undefined | null {
  if (value === undefined) return undefined;
  if (typeof value !== 'string') return null;
  return value;
}

function parseInteger(value: string): number | null {
  if (!/^\d+$/.test(value)) return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function generationState(story: { generating?: boolean; generationError?: string }): 'generating' | 'failed' | 'ready' {
  if (story.generating) return 'generating';
  if (story.generationError) return 'failed';
  return 'ready';
}

/** Idempotent replay: return the story that the original request created. */
function respondWithExistingGeneration(
  res: Response,
  story: { _id: unknown; generating?: boolean; generationError?: string; published?: boolean }
): void {
  const id = String(story._id);
  res.status(200).json({
    data: {
      id,
      status: generationState(story),
      published: story.published === true,
      pollUrl: `/api/v1/stories/${id}`,
    },
  });
}

// GET /api/v1/stories — published stories with filters and pagination
router.get('/stories', requireScope(API_KEY_SCOPE), async (req: Request, res: Response) => {
  try {
    const nativeLang = readString(req.query.nativeLang);
    const learningLang = readString(req.query.learningLang);
    const level = readString(req.query.level);
    const search = readString(req.query.search);
    const author = readString(req.query.author);
    const sort = readString(req.query.sort);
    const pageParam = readString(req.query.page);
    const limitParam = readString(req.query.limit);

    if (
      nativeLang === null ||
      learningLang === null ||
      level === null ||
      search === null ||
      author === null ||
      sort === null ||
      pageParam === null ||
      limitParam === null
    ) {
      return sendError(res, 400, 'INVALID_PARAMETER', 'Query parameters must be single string values');
    }
    if (nativeLang && !LANGUAGE_CODES.has(nativeLang)) {
      return sendError(res, 400, 'INVALID_PARAMETER', `Unknown nativeLang "${nativeLang}"`);
    }
    if (learningLang && !LANGUAGE_CODES.has(learningLang)) {
      return sendError(res, 400, 'INVALID_PARAMETER', `Unknown learningLang "${learningLang}"`);
    }
    if (level && !LEVELS.includes(level as (typeof LEVELS)[number])) {
      return sendError(res, 400, 'INVALID_PARAMETER', `level must be one of: ${LEVELS.join(', ')}`);
    }
    if (sort && sort !== 'newest' && sort !== 'oldest') {
      return sendError(res, 400, 'INVALID_PARAMETER', 'sort must be "newest" or "oldest"');
    }

    const trimmedSearch = search?.trim() ?? '';
    if (trimmedSearch.length > MAX_SEARCH_LENGTH) {
      return sendError(res, 400, 'INVALID_PARAMETER', `search cannot exceed ${MAX_SEARCH_LENGTH} characters`);
    }

    const trimmedAuthor = author?.trim() ?? '';
    if (trimmedAuthor.length > MAX_USERNAME_LENGTH) {
      return sendError(res, 400, 'INVALID_PARAMETER', `author cannot exceed ${MAX_USERNAME_LENGTH} characters`);
    }

    let page = 1;
    if (pageParam !== undefined) {
      const parsedPage = parseInteger(pageParam);
      if (parsedPage === null || parsedPage < 1) {
        return sendError(res, 400, 'INVALID_PARAMETER', 'page must be a positive integer');
      }
      page = parsedPage;
    }

    let limit = DEFAULT_LIMIT;
    if (limitParam !== undefined) {
      const parsedLimit = parseInteger(limitParam);
      if (parsedLimit === null || parsedLimit < 1) {
        return sendError(res, 400, 'INVALID_PARAMETER', 'limit must be a positive integer');
      }
      limit = Math.min(parsedLimit, MAX_LIMIT);
    }

    const filter: Record<string, unknown> = { published: true };
    if (nativeLang) filter.nativeLanguage = nativeLang;
    if (learningLang) filter.learningLanguage = learningLang;
    if (level) filter.level = level;
    if (trimmedSearch) {
      const pattern = { $regex: escapeRegex(trimmedSearch), $options: 'i' };
      filter.$or = [
        { 'title.lang1': pattern },
        { 'title.lang2': pattern },
        { labels: pattern },
        { topic: pattern },
      ];
    }
    if (trimmedAuthor) {
      // `authorName` on the story is denormalized, so resolve the account and match
      // on `authorId` (indexed) instead. Unknown usernames yield an empty page.
      const authorUser = await User.findOne({
        username: { $regex: `^${escapeRegex(trimmedAuthor)}$`, $options: 'i' },
      })
        .select('_id')
        .lean();
      if (!authorUser) {
        return res.json({
          data: [],
          pagination: { page, limit, total: 0, pages: 0, hasNext: false },
        });
      }
      filter.authorId = authorUser._id;
    }

    const sortSpec: Record<string, 1 | -1> = sort === 'oldest' ? { createdAt: 1 } : { createdAt: -1 };
    const skip = (page - 1) * limit;

    const [stories, total] = await Promise.all([
      Story.find(filter)
        .select(LIST_PROJECTION)
        .sort(sortSpec)
        .skip(skip)
        .limit(limit)
        .lean(),
      Story.countDocuments(filter),
    ]);

    const pages = Math.ceil(total / limit);

    res.json({
      data: stories.map((story) => toPublicStorySummary(story as unknown as StoryLike)),
      pagination: {
        page,
        limit,
        total,
        pages,
        hasNext: page < pages,
      },
    });
  } catch (error) {
    req.log.error({ err: error }, '[publicApi] Error fetching stories');
    sendError(res, 500, 'SERVER_ERROR', 'Server error fetching stories');
  }
});

// GET /api/v1/metadata — filter values and pagination limits
router.get('/metadata', requireScope(API_KEY_SCOPE), (_req: Request, res: Response) => {
  res.json({
    data: {
      languages: LANGUAGES,
      levels: LEVELS,
      pagination: {
        defaultLimit: DEFAULT_LIMIT,
        maxLimit: MAX_LIMIT,
      },
    },
  });
});

// POST /api/v1/stories — create a draft and start AI generation
router.post('/stories', requireScope(API_KEY_WRITE_SCOPE), async (req: Request, res: Response) => {
  try {
    const body = (req.body ?? {}) as Record<string, unknown>;

    // Title is optional: when omitted, AI generation supplies both languages.
    const title = sanitizeTitle(body.title);

    const nativeLanguage = typeof body.nativeLanguage === 'string' ? body.nativeLanguage.trim() : '';
    const learningLanguage = typeof body.learningLanguage === 'string' ? body.learningLanguage.trim() : '';
    if (!LANGUAGE_CODES.has(nativeLanguage)) {
      return sendError(res, 400, 'INVALID_PARAMETER', 'nativeLanguage must be a supported language code');
    }
    if (!LANGUAGE_CODES.has(learningLanguage)) {
      return sendError(res, 400, 'INVALID_PARAMETER', 'learningLanguage must be a supported language code');
    }
    if (nativeLanguage === learningLanguage) {
      return sendError(res, 400, 'INVALID_PARAMETER', 'nativeLanguage and learningLanguage must differ');
    }

    const level = typeof body.level === 'string' ? body.level : '';
    if (!LEVELS.includes(level as (typeof LEVELS)[number])) {
      return sendError(res, 400, 'INVALID_PARAMETER', `level must be one of: ${LEVELS.join(', ')}`);
    }

    const seed = typeof body.seed === 'string' ? body.seed.trim() : '';
    if (!seed) {
      return sendError(res, 400, 'INVALID_PARAMETER', 'seed is required');
    }

    const labels = sanitizeLabels(body.labels, body.topic);

    const aiModel =
      typeof body.aiModel === 'string' && body.aiModel.trim() !== '' ? body.aiModel.trim() : DEFAULT_AI_MODEL;
    if (!ALLOWED_AI_MODELS.includes(aiModel)) {
      return sendError(res, 400, 'INVALID_PARAMETER', `aiModel must be one of: ${ALLOWED_AI_MODELS.join(', ')}`);
    }

    const published = body.published === true;
    const targetChapters = clampInt(body.targetChapters, 1, MAX_CHAPTERS_PER_STORY, 1);

    const rawChapters = Array.isArray(body.chapters) ? body.chapters : [];
    if (rawChapters.length > MAX_CHAPTERS_PER_STORY) {
      return sendError(res, 400, 'INVALID_PARAMETER', `chapters cannot exceed ${MAX_CHAPTERS_PER_STORY} entries`);
    }

    const chapters = rawChapters.length > 0
      ? rawChapters.map((rawChapter) => {
          const chapter = (rawChapter ?? {}) as { title?: unknown; seed?: unknown; targetSentences?: unknown };
          return {
            title: sanitizeTitle(chapter.title),
            seed: typeof chapter.seed === 'string' ? chapter.seed : '',
            targetSentences: clampInt(
              chapter.targetSentences,
              1,
              MAX_TARGET_SENTENCES,
              DEFAULT_SENTENCES_PER_CHAPTER
            ),
            sentences: [],
          };
        })
      : Array.from({ length: targetChapters }, () => ({
          title: { lang1: '', lang2: '' },
          seed: '',
          targetSentences: DEFAULT_SENTENCES_PER_CHAPTER,
          sentences: [],
        }));

    const owner = await User.findById(req.apiKey!.ownerId).select('username canCreateStories');
    if (!owner) {
      return sendError(res, 401, 'INVALID_API_KEY', 'The API key owner no longer exists');
    }
    if (!owner.canCreateStories) {
      return sendError(res, 403, 'CREATOR_ACCESS_REQUIRED', 'Creator access is required to create stories');
    }

    const rawIdempotencyKey = req.header('Idempotency-Key');
    const idempotencyKey =
      typeof rawIdempotencyKey === 'string'
        ? rawIdempotencyKey.trim().slice(0, MAX_IDEMPOTENCY_KEY_LENGTH)
        : '';

    if (idempotencyKey) {
      const existing = await Story.findOne({ authorId: owner._id, idempotencyKey });
      if (existing) return respondWithExistingGeneration(res, existing);
    }

    const story = new Story({
      title,
      chapters,
      targetChapters,
      characters: sanitizeCharacters(body.characters),
      nativeLanguage,
      learningLanguage,
      level,
      labels,
      seed,
      aiGuideline: sanitizeAIGuideline(body.aiGuideline),
      aiModel,
      authorId: owner._id,
      authorName: owner.username,
      creationSource: 'api',
      createdViaApiKeyName: req.apiKey!.name,
      createdViaApiKeyId: req.apiKey!.id,
      published: false,
      publishWhenReady: published,
      ...(idempotencyKey ? { idempotencyKey } : {}),
    });

    try {
      await story.save();
    } catch (error) {
      // A concurrent request with the same Idempotency-Key won the unique index.
      if ((error as { code?: number }).code === 11000 && idempotencyKey) {
        const existing = await Story.findOne({ authorId: owner._id, idempotencyKey });
        if (existing) return respondWithExistingGeneration(res, existing);
      }
      throw error;
    }

    const started = await startStoryGeneration(story._id.toString(), aiModel);
    if (!started.ok) {
      await Story.updateOne({ _id: story._id }, { $set: { generating: false } });
      return sendError(res, 500, 'SERVER_ERROR', `Unable to start story generation (${started.code})`);
    }

    const id = story._id.toString();
    res.status(202)
      .location(`/api/v1/stories/${id}`)
      .json({
        data: {
          id,
          status: 'generating',
          published: false,
          pollUrl: `/api/v1/stories/${id}`,
        },
      });
  } catch (error) {
    req.log.error({ err: error }, '[publicApi] Error creating story');
    sendError(res, 500, 'SERVER_ERROR', 'Server error creating story');
  }
});

// GET /api/v1/stories/:id — published stories only; drafts are indistinguishable from missing
router.get('/stories/:id', requireScope(API_KEY_SCOPE), async (req: Request, res: Response) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return sendError(res, 400, 'INVALID_PARAMETER', 'Invalid story id');
    }

    const apiKey = req.apiKey!;
    const canReadOwnDrafts = apiKey.scopes.includes(API_KEY_WRITE_SCOPE);
    const story = await Story.findOne({
      _id: req.params.id,
      ...(canReadOwnDrafts
        ? { $or: [{ published: true }, { authorId: apiKey.ownerId }] }
        : { published: true }),
    }).lean();

    if (!story) {
      return sendError(res, 404, 'NOT_FOUND', 'Story not found');
    }

    // Write-scoped owners also see generation status for their own stories.
    const isOwnerView = canReadOwnDrafts && String(story.authorId) === apiKey.ownerId;
    res.json({
      data: toPublicStoryDetail(
        story as unknown as StoryLike,
        isOwnerView
          ? {
              published: story.published === true,
              generating: story.generating === true,
              generationError: story.generationError ?? '',
            }
          : undefined
      ),
    });
  } catch (error) {
    req.log.error({ err: error }, '[publicApi] Error fetching story');
    sendError(res, 500, 'SERVER_ERROR', 'Server error fetching story');
  }
});

// Terminal 404 so unknown /api/v1 paths never reach the SPA catch-all.
router.use((req: Request, res: Response) => {
  sendError(res, 404, 'NOT_FOUND', `Unknown API endpoint: ${req.method} ${req.originalUrl}`);
});

export default router;
