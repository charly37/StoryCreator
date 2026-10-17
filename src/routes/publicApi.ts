import express, { Request, Response } from 'express';
import mongoose from 'mongoose';
import Story from '../models/Story';
import { LANGUAGES } from '../client/utils/languages';
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

// Everything the summary needs; chapter bodies are excluded from list responses.
const LIST_PROJECTION =
  'title chapters.title sentenceCount nativeLanguage learningLanguage level topic authorName isAIGenerated createdAt updatedAt';

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

// GET /api/v1/stories — published stories with filters and pagination
router.get('/stories', async (req: Request, res: Response) => {
  try {
    const nativeLang = readString(req.query.nativeLang);
    const learningLang = readString(req.query.learningLang);
    const level = readString(req.query.level);
    const search = readString(req.query.search);
    const sort = readString(req.query.sort);
    const pageParam = readString(req.query.page);
    const limitParam = readString(req.query.limit);

    if (
      nativeLang === null ||
      learningLang === null ||
      level === null ||
      search === null ||
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
        { topic: pattern },
      ];
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
    console.error('[publicApi] Error fetching stories:', error);
    sendError(res, 500, 'SERVER_ERROR', 'Server error fetching stories');
  }
});

// GET /api/v1/metadata — filter values and pagination limits
router.get('/metadata', (_req: Request, res: Response) => {
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

// GET /api/v1/stories/:id — published stories only; drafts are indistinguishable from missing
router.get('/stories/:id', async (req: Request, res: Response) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return sendError(res, 400, 'INVALID_PARAMETER', 'Invalid story id');
    }

    const story = await Story.findOne({ _id: req.params.id, published: true }).lean();
    if (!story) {
      return sendError(res, 404, 'NOT_FOUND', 'Story not found');
    }

    res.json({ data: toPublicStoryDetail(story as unknown as StoryLike) });
  } catch (error) {
    console.error('[publicApi] Error fetching story:', error);
    sendError(res, 500, 'SERVER_ERROR', 'Server error fetching story');
  }
});

// Terminal 404 so unknown /api/v1 paths never reach the SPA catch-all.
router.use((req: Request, res: Response) => {
  sendError(res, 404, 'NOT_FOUND', `Unknown API endpoint: ${req.method} ${req.originalUrl}`);
});

export default router;
