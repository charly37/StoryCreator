import express, { Request, Response, NextFunction } from 'express';
import mongoose from 'mongoose';
import Story from '../models/Story';
import User from '../models/User';
import TtsRequest, { TTS_LANGUAGES, TtsLanguage } from '../models/TtsRequest';

const router = express.Router();

/** Upper bound for the batched status lookup used by the My Stories list. */
const MAX_STATUS_LOOKUP_IDS = 50;

function requireAuth(req: Request, res: Response, next: NextFunction): void {
  if (!req.session.userId) {
    res.status(401).json({ message: 'Authentication required' });
    return;
  }
  next();
}

/** Mirrors the creator gate in `routes/stories.ts` — audio generation costs money. */
async function requireCreatePermission(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const user = await User.findById(req.session.userId).select('canCreateStories');
    if (!user || !user.canCreateStories) {
      res.status(403).json({ message: 'Creator access required', code: 'CREATOR_ACCESS_REQUIRED' });
      return;
    }
    next();
  } catch (error) {
    req.log.error({ err: error }, 'Error checking creator permission');
    res.status(500).json({ message: 'Server error checking permissions' });
  }
}

function isTtsLanguage(value: unknown): value is TtsLanguage {
  return typeof value === 'string' && (TTS_LANGUAGES as string[]).includes(value);
}

/** Never exposes the raw Mongoose document. */
function serializeRequest(doc: {
  _id: unknown;
  storyId: unknown;
  lang: string;
  status: string;
  phase?: string;
  progress?: { done?: number; total?: number };
  error?: string;
  requestedAt: Date;
}) {
  return {
    id: String(doc._id),
    storyId: String(doc.storyId),
    lang: doc.lang,
    status: doc.status,
    phase: doc.phase ?? '',
    progress: { done: doc.progress?.done ?? 0, total: doc.progress?.total ?? 0 },
    error: doc.error ?? '',
    requestedAt: doc.requestedAt,
  };
}

/**
 * Create (or re-queue) one request. The unique `{storyId, lang}` index makes this
 * idempotent; a concurrent insert of the same pair falls back to an update.
 */
async function upsertRequest(storyId: string, lang: TtsLanguage, requestedBy: string) {
  const filter = { storyId: new mongoose.Types.ObjectId(storyId), lang };
  const update = {
    $set: {
      status: 'queued' as const,
      phase: 'synthesize' as const,
      requestedBy: new mongoose.Types.ObjectId(requestedBy),
      requestedAt: new Date(),
      error: '',
      // A fresh request is a fresh set of attempts; otherwise a previously failed
      // job would be re-queued and immediately marked failed again.
      attempts: 0,
    },
    // The previous run's manifest and progress describe older text; the worker
    // rebuilds them. Clips themselves stay cached on disk by content hash.
    $unset: { clips: '', storyHash: '', progress: '', startedAt: '', finishedAt: '' },
  };

  try {
    return await TtsRequest.findOneAndUpdate(filter, update, {
      upsert: true,
      returnDocument: 'after',
    });
  } catch (error) {
    // Duplicate key: another request for the same story+language won the race.
    if ((error as { code?: number }).code === 11000) {
      return TtsRequest.findOneAndUpdate(filter, update, { returnDocument: 'after' });
    }
    throw error;
  }
}

// POST /api/tts-requests — queue a text-to-speech request for one of the caller's stories
router.post('/', requireAuth, requireCreatePermission, async (req: Request, res: Response) => {
  try {
    const rawStoryId = req.body?.storyId;
    if (typeof rawStoryId !== 'string' || !mongoose.isValidObjectId(rawStoryId)) {
      return res.status(400).json({ message: 'A valid storyId is required', code: 'INVALID_STORY_ID' });
    }

    const rawLanguages = req.body?.languages;
    let languages: TtsLanguage[];
    if (rawLanguages === undefined) {
      languages = [...TTS_LANGUAGES];
    } else if (Array.isArray(rawLanguages) && rawLanguages.length > 0 && rawLanguages.every(isTtsLanguage)) {
      languages = Array.from(new Set(rawLanguages));
    } else {
      return res.status(400).json({
        message: `languages must be a non-empty subset of ${TTS_LANGUAGES.join(', ')}`,
        code: 'INVALID_LANGUAGES',
      });
    }

    const story = await Story.findById(rawStoryId).select('authorId sentenceCount');
    if (!story) {
      return res.status(404).json({ message: 'Story not found' });
    }
    if (story.authorId.toString() !== req.session.userId) {
      return res.status(403).json({ message: 'Not authorized' });
    }
    if (story.sentenceCount === 0) {
      return res.status(400).json({
        message: 'Cannot generate audio for a story with no sentences',
        code: 'NO_CHAPTERS',
      });
    }

    const requestedBy = req.session.userId as string;
    const requests = await Promise.all(
      languages.map((lang) => upsertRequest(rawStoryId, lang, requestedBy))
    );

    res.status(202).json({
      message: 'Audio request queued',
      requests: requests.filter(Boolean).map((doc) => serializeRequest(doc!)),
    });
  } catch (error) {
    req.log.error({ err: error }, 'Error creating TTS request');
    res.status(500).json({ message: 'Server error creating audio request' });
  }
});

// GET /api/tts-requests?storyIds=a,b,c — batched status lookup for the caller's own requests
router.get('/', requireAuth, async (req: Request, res: Response) => {
  try {
    const raw = req.query.storyIds;
    if (typeof raw !== 'string' || raw.trim() === '') {
      return res.status(400).json({ message: 'storyIds is required', code: 'INVALID_STORY_ID' });
    }

    const ids = Array.from(
      new Set(
        raw
          .split(',')
          .map((value) => value.trim())
          .filter((value) => value !== '')
      )
    );
    if (ids.length > MAX_STATUS_LOOKUP_IDS) {
      return res.status(400).json({
        message: `At most ${MAX_STATUS_LOOKUP_IDS} story ids can be queried at once`,
        code: 'TOO_MANY_IDS',
      });
    }
    if (!ids.every((id) => mongoose.isValidObjectId(id))) {
      return res.status(400).json({ message: 'One or more story ids are invalid', code: 'INVALID_STORY_ID' });
    }

    const requests = await TtsRequest.find({
      storyId: { $in: ids.map((id) => new mongoose.Types.ObjectId(id)) },
      requestedBy: new mongoose.Types.ObjectId(req.session.userId as string),
    }).select('storyId lang status phase progress error requestedAt');

    res.json({ data: requests.map(serializeRequest) });
  } catch (error) {
    req.log.error({ err: error }, 'Error fetching TTS requests');
    res.status(500).json({ message: 'Server error fetching audio requests' });
  }
});

// Terminal handler: unknown /api/tts-requests/* paths answer JSON instead of the SPA.
router.use((_req: Request, res: Response) => {
  res.status(404).json({ message: 'Not found' });
});

export default router;
