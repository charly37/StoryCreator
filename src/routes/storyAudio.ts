import express, { Request, Response } from 'express';
import mongoose from 'mongoose';
import path from 'path';
import Story from '../models/Story';
import TtsRender, { TTS_VARIANTS, TtsVariant, ITtsRender } from '../models/TtsRender';

/**
 * Audio delivery for a story. Mounted at `/api/stories/:id/audio` so the same
 * draft/publish rule as `GET /api/stories/:id` decides who may listen:
 * unpublished audio is author-only.
 *
 * `res.sendFile` gives conditional requests, ETag and HTTP Range support (needed for
 * seeking in an audio element) for free — which is why this is a route rather than a
 * static directory, unlike PortugueseLearning where every MP3 is public.
 */
const router = express.Router({ mergeParams: true });

const AUDIO_ROOT = path.resolve(process.env.AUDIO_PATH || path.join(__dirname, '../../audio'));

function isVariant(value: string): value is TtsVariant {
  return (TTS_VARIANTS as string[]).includes(value);
}

function serializeRender(storyId: string, render: ITtsRender) {
  return {
    variant: render.variant,
    durationMs: render.durationMs,
    sizeBytes: render.sizeBytes,
    createdAt: render.createdAt,
    url: `/api/stories/${storyId}/audio/${render.variant}`,
  };
}

/** Loads the story and applies the same visibility rule as the story endpoint. */
async function loadReadableStory(req: Request, res: Response) {
  const { id } = req.params;
  if (!mongoose.isValidObjectId(id)) {
    res.status(400).json({ message: 'Invalid story id', code: 'INVALID_STORY_ID' });
    return null;
  }

  const story = await Story.findById(id).select('authorId published');
  if (!story) {
    res.status(404).json({ message: 'Story not found' });
    return null;
  }
  if (!story.published && story.authorId.toString() !== req.session.userId) {
    res.status(403).json({ message: 'Story not published' });
    return null;
  }
  return story;
}

// GET /api/stories/:id/audio — what is available for this story
router.get('/', async (req: Request, res: Response) => {
  try {
    const story = await loadReadableStory(req, res);
    if (!story) return;

    // A re-render inserts a new row keyed by a new story hash, so "newest per
    // variant" is always the render matching the current text.
    const renders = await TtsRender.find({ storyId: story._id }).sort({ createdAt: -1 });
    const latest = new Map<string, ITtsRender>();
    for (const render of renders) {
      if (!latest.has(render.variant)) latest.set(render.variant, render);
    }

    res.json({
      storyId: story._id.toString(),
      variants: Array.from(latest.values()).map((render) => serializeRender(story._id.toString(), render)),
    });
  } catch (error) {
    req.log.error({ err: error }, 'Error listing story audio');
    res.status(500).json({ message: 'Server error listing audio' });
  }
});

// GET /api/stories/:id/audio/:variant — stream the audio file
router.get('/:variant', async (req: Request, res: Response) => {
  try {
    const variant = String(req.params.variant ?? '');
    if (!isVariant(variant)) {
      res.status(400).json({
        message: `variant must be one of ${TTS_VARIANTS.join(', ')}`,
        code: 'INVALID_VARIANT',
      });
      return;
    }

    const story = await loadReadableStory(req, res);
    if (!story) return;

    const render = await TtsRender.findOne({ storyId: story._id, variant }).sort({ createdAt: -1 });
    if (!render) {
      res.status(404).json({ message: 'Audio not generated yet', code: 'AUDIO_NOT_READY' });
      return;
    }

    // Keys are versioned by story hash, so the bytes at a URL never change.
    res.sendFile(render.key, { root: AUDIO_ROOT, maxAge: '7d', immutable: true }, (error) => {
      if (error && !res.headersSent) {
        req.log.error({ err: error, storyId: story._id.toString(), variant }, 'Error sending audio');
        res.status(404).json({ message: 'Audio file missing', code: 'AUDIO_MISSING' });
      }
    });
  } catch (error) {
    req.log.error({ err: error }, 'Error streaming story audio');
    res.status(500).json({ message: 'Server error streaming audio' });
  }
});

// Terminal handler: unknown audio paths answer JSON instead of the SPA.
router.use((_req: Request, res: Response) => {
  res.status(404).json({ message: 'Not found' });
});

export default router;
