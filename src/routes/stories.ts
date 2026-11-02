import express, { Request, Response, NextFunction } from 'express';
import Story from '../models/Story';
import User from '../models/User';
import { aiService, sanitizeSentences, sanitizeTitle } from '../services/aiService';
import {
  ALLOWED_AI_MODELS,
  skipValidation,
  startChapterGeneration,
  startOutlineGeneration,
  startStoryGeneration,
  startValidation,
  StagedStartFailure,
  ValidationModeArg,
} from '../services/storyGenerationService';
import { sweepStalledJob } from '../services/storyJobService';
import {
  DEFAULT_AI_MODEL,
  EFFORT_ORDER,
  findModelSpec,
  isEffortSupportedBy,
  isReasoningEffort,
  isSelectableModel,
  normalizeEffort,
  type ReasoningEffort,
} from '../shared/aiModels';
import {
  DEFAULT_SENTENCES_PER_CHAPTER,
  MAX_CHAPTERS_PER_STORY,
  sanitizeAIGuideline,
  sanitizeCharacters,
  sanitizeGenerationMode,
  sanitizeLabels,
  sanitizeSynopsis,
  sanitizeValidationMode,
} from '../services/storyInput';

const router = express.Router();

function requireAuth(req: Request, res: Response, next: NextFunction): void {
  if (!req.session.userId) {
    res.status(401).json({ message: 'Authentication required' });
    return;
  }
  next();
}

/** Gates story creation and AI authoring endpoints behind the per-user creator permission. */
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

// GET /api/stories/mine — must be before /:id
router.get('/mine', requireAuth, async (req: Request, res: Response) => {
  try {
    const stories = await Story.find({ authorId: req.session.userId })
      .select('-chapters.sentences')
      .sort({ updatedAt: -1 });
    res.json(stories);
  } catch (error) {
    req.log.error({ err: error }, 'Error fetching user stories');
    res.status(500).json({ message: 'Server error fetching stories' });
  }
});

// GET /api/stories — public browse with filters
router.get('/', async (req: Request, res: Response) => {
  try {
    const { nativeLang, learningLang, level, search, page = '1' } = req.query;
    const limit = 12;
    const skip = (parseInt(page as string, 10) - 1) * limit;

    const filter: Record<string, unknown> = { published: true };
    if (nativeLang) filter.nativeLanguage = nativeLang;
    if (learningLang) filter.learningLanguage = learningLang;
    if (level) filter.level = level;
    if (search) {
      filter.$or = [
        { 'title.lang1': { $regex: search, $options: 'i' } },
        { 'title.lang2': { $regex: search, $options: 'i' } },
        { labels: { $regex: search, $options: 'i' } },
        { topic: { $regex: search, $options: 'i' } },
      ];
    }

    const [stories, total] = await Promise.all([
      Story.find(filter).select('-chapters.sentences').sort({ createdAt: -1 }).skip(skip).limit(limit),
      Story.countDocuments(filter),
    ]);

    res.json({ stories, total, page: parseInt(page as string, 10), pages: Math.ceil(total / limit) });
  } catch (error) {
    req.log.error({ err: error }, 'Error fetching stories');
    res.status(500).json({ message: 'Server error fetching stories' });
  }
});

// GET /api/stories/:id
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const story = await Story.findById(req.params.id);
    if (!story) return res.status(404).json({ message: 'Story not found' });
    if (!story.published && story.authorId.toString() !== req.session.userId) {
      return res.status(403).json({ message: 'Story not published' });
    }
    // Release a staged job whose heartbeat went quiet (crashed/restarted process).
    await sweepStalledJob(story);
    res.json(story);
  } catch (error) {
    req.log.error({ err: error }, 'Error fetching story');
    res.status(500).json({ message: 'Server error fetching story' });
  }
});

// POST /api/stories
router.post('/', requireAuth, requireCreatePermission, async (req: Request, res: Response) => {
  try {
    const { nativeLanguage, learningLanguage, level, labels, topic } = req.body;

    if (!nativeLanguage || !learningLanguage) {
      return res.status(400).json({ message: 'Both languages are required' });
    }
    if (nativeLanguage === learningLanguage) {
      return res.status(400).json({ message: 'Native and learning languages must be different' });
    }
    if (!['beginner', 'intermediate', 'advanced'].includes(level)) {
      return res.status(400).json({ message: 'Invalid level' });
    }

    const author = await User.findById(req.session.userId).select('username');
    if (!author) return res.status(401).json({ message: 'User not found' });

    const rawChapters = Array.isArray(req.body.chapters) ? req.body.chapters : [];
    const targetChapters = Math.min(Math.max(parseInt(req.body.targetChapters, 10) || 1, 1), 10);

    const chapters = rawChapters.length > 0
      ? rawChapters.map((c: { title?: unknown; seed?: string; targetSentences?: number }) => ({
          title: sanitizeTitle(c.title),
          seed: c.seed ?? '',
          targetSentences: Math.min(Math.max(parseInt(String(c.targetSentences), 10) || DEFAULT_SENTENCES_PER_CHAPTER, 1), 100),
          sentences: [],
        }))
      : Array.from({ length: targetChapters }, () => ({ title: { lang1: '', lang2: '' }, seed: '', targetSentences: DEFAULT_SENTENCES_PER_CHAPTER, sentences: [] }));

    const outlineSelection = resolveModelSelection(
      req.body?.outlineAiModel,
      req.body?.outlineReasoningEffort
    );
    if (!outlineSelection.ok) {
      return res.status(400).json({ message: outlineSelection.message, code: 'INVALID_MODEL' });
    }

    const story = new Story({
      title: sanitizeTitle(req.body.title),
      chapters,
      targetChapters,
      characters: sanitizeCharacters(req.body.characters),
      nativeLanguage,
      learningLanguage,
      level,
      labels: sanitizeLabels(labels, topic),
      seed: req.body.seed || '',
      aiGuideline: sanitizeAIGuideline(req.body.aiGuideline),
      generationMode: sanitizeGenerationMode(req.body.generationMode),
      ...(outlineSelection.model ? { outlineAiModel: outlineSelection.model } : {}),
      ...(outlineSelection.effort ? { outlineReasoningEffort: outlineSelection.effort } : {}),
      outline: { synopsis: sanitizeSynopsis(req.body.synopsis) },
      authorId: req.session.userId,
      authorName: author.username,
      published: false,
    });

    await story.save();
    res.status(201).json(story);
  } catch (error) {
    req.log.error({ err: error }, 'Error creating story');
    res.status(500).json({ message: 'Server error creating story' });
  }
});

// PUT /api/stories/:id
router.put('/:id', requireAuth, async (req: Request, res: Response) => {
  try {
    const story = await Story.findById(req.params.id);
    if (!story) return res.status(404).json({ message: 'Story not found' });
    if (story.authorId.toString() !== req.session.userId) {
      return res.status(403).json({ message: 'Not authorized' });
    }

    const { title, nativeLanguage, learningLanguage, level, labels, topic } = req.body;

    if (nativeLanguage && learningLanguage && nativeLanguage === learningLanguage) {
      return res.status(400).json({ message: 'Native and learning languages must be different' });
    }

    if (title !== undefined) story.title = sanitizeTitle(title);
    if (nativeLanguage) story.nativeLanguage = nativeLanguage;
    if (learningLanguage) story.learningLanguage = learningLanguage;
    if (level) story.level = level;
    if (labels !== undefined || topic !== undefined) {
      story.labels = sanitizeLabels(labels, topic);
    }
    if (req.body.seed !== undefined) story.seed = req.body.seed;
    if (req.body.aiModel !== undefined || req.body.aiReasoningEffort !== undefined) {
      // Changing the model resets the thinking level: the old one may not exist
      // on the new model, and an unintended tier would cost the author money.
      const selection = resolveModelSelection(
        req.body.aiModel ?? story.aiModel,
        req.body.aiReasoningEffort ?? (req.body.aiModel !== undefined ? '' : story.aiReasoningEffort)
      );
      if (!selection.ok) {
        return res.status(400).json({ message: selection.message, code: 'INVALID_MODEL' });
      }
      if (selection.model) story.aiModel = selection.model;
      story.aiReasoningEffort = selection.effort ?? '';
    }
    if (req.body.aiGuideline !== undefined) story.aiGuideline = sanitizeAIGuideline(req.body.aiGuideline);
    if (req.body.characters !== undefined) story.characters = sanitizeCharacters(req.body.characters);
    if (req.body.outlineAiModel !== undefined || req.body.outlineReasoningEffort !== undefined) {
      const selection = resolveModelSelection(
        req.body.outlineAiModel ?? story.outlineAiModel,
        req.body.outlineReasoningEffort ??
          (req.body.outlineAiModel !== undefined ? '' : story.outlineReasoningEffort)
      );
      if (!selection.ok) {
        return res.status(400).json({ message: selection.message, code: 'INVALID_MODEL' });
      }
      if (selection.model) story.outlineAiModel = selection.model;
      story.outlineReasoningEffort = selection.effort ?? '';
    }
    if (req.body.synopsis !== undefined) {
      // `set()` with a dotted path keeps this safe for documents created before
      // the outline sub-document existed.
      story.set('outline.synopsis', sanitizeSynopsis(req.body.synopsis));
    }
    if (req.body.validationMode !== undefined) {
      story.validationMode = sanitizeValidationMode(req.body.validationMode);
    }
    if (req.body.targetChapters !== undefined) {
      story.targetChapters = Math.min(Math.max(parseInt(req.body.targetChapters, 10) || 1, 1), 10);
    }

    // Update chapter metadata (seed + targetSentences) without touching sentence content
    if (Array.isArray(req.body.chapters)) {
      const incoming = req.body.chapters as Array<{ title?: { lang1?: string; lang2?: string }; seed?: string; targetSentences?: number }>;
      // Resize chapters array if needed
      while (story.chapters.length < incoming.length) {
        story.chapters.push({ title: { lang1: '', lang2: '' }, seed: '', targetSentences: DEFAULT_SENTENCES_PER_CHAPTER, sentences: [] });
      }
      story.chapters = story.chapters.slice(0, incoming.length);
      for (let i = 0; i < incoming.length; i++) {
        if (incoming[i].title !== undefined) {
          const title = incoming[i].title ?? {};
          story.chapters[i].title = {
            lang1: typeof title.lang1 === 'string' ? title.lang1.trim() : story.chapters[i].title?.lang1 ?? '',
            lang2: typeof title.lang2 === 'string' ? title.lang2.trim() : story.chapters[i].title?.lang2 ?? '',
          };
        }
        if (incoming[i].seed !== undefined) story.chapters[i].seed = incoming[i].seed!;
        if (incoming[i].targetSentences !== undefined) {
          story.chapters[i].targetSentences = Math.min(Math.max(parseInt(String(incoming[i].targetSentences), 10) || DEFAULT_SENTENCES_PER_CHAPTER, 1), 100);
        }
      }
    }

    await story.save();
    res.json(story);
  } catch (error) {
    req.log.error({ err: error }, 'Error updating story');
    res.status(500).json({ message: 'Server error updating story' });
  }
});

// POST /api/stories/:id/chapters — insert a new empty chapter at a given position
router.post('/:id/chapters', requireAuth, async (req: Request, res: Response) => {
  try {
    const story = await Story.findById(req.params.id);
    if (!story) return res.status(404).json({ message: 'Story not found' });
    if (story.authorId.toString() !== req.session.userId) {
      return res.status(403).json({ message: 'Not authorized' });
    }
    if (story.chapters.length >= MAX_CHAPTERS_PER_STORY) {
      return res.status(400).json({ message: `A story cannot have more than ${MAX_CHAPTERS_PER_STORY} chapters` });
    }

    // Default to appending at the end; otherwise clamp to a valid insertion point.
    const rawIndex = parseInt(req.body.index, 10);
    const index = Number.isNaN(rawIndex)
      ? story.chapters.length
      : Math.min(Math.max(rawIndex, 0), story.chapters.length);

    const newChapter = {
      title: sanitizeTitle(req.body.title),
      seed: typeof req.body.seed === 'string' ? req.body.seed : '',
      targetSentences: Math.min(
        Math.max(parseInt(String(req.body.targetSentences), 10) || DEFAULT_SENTENCES_PER_CHAPTER, 1),
        100
      ),
      sentences: [],
    };

    // splice (not push) so every later chapter — and its sentences — shifts together
    story.chapters.splice(index, 0, newChapter);
    story.targetChapters = Math.min(story.chapters.length, MAX_CHAPTERS_PER_STORY);
    await story.save();

    res.status(201).json(story);
  } catch (error) {
    req.log.error({ err: error }, 'Error inserting chapter');
    res.status(500).json({ message: 'Server error inserting chapter' });
  }
});

// DELETE /api/stories/:id/chapters/:index — remove a chapter and its sentences
router.delete('/:id/chapters/:index', requireAuth, async (req: Request, res: Response) => {
  try {
    const story = await Story.findById(req.params.id);
    if (!story) return res.status(404).json({ message: 'Story not found' });
    if (story.authorId.toString() !== req.session.userId) {
      return res.status(403).json({ message: 'Not authorized' });
    }

    const index = parseInt(String(req.params.index), 10);
    if (Number.isNaN(index) || index < 0 || index >= story.chapters.length) {
      return res.status(400).json({ message: 'Invalid chapter index' });
    }
    if (story.chapters.length <= 1) {
      return res.status(400).json({ message: 'A story must have at least one chapter' });
    }

    // splice out — remaining chapters and their sentences shift together
    story.chapters.splice(index, 1);
    story.targetChapters = Math.min(story.chapters.length, MAX_CHAPTERS_PER_STORY);
    await story.save();

    res.json(story);
  } catch (error) {
    req.log.error({ err: error }, 'Error deleting chapter');
    res.status(500).json({ message: 'Server error deleting chapter' });
  }
});

// DELETE /api/stories/:id
router.delete('/:id', requireAuth, async (req: Request, res: Response) => {
  try {
    const story = await Story.findById(req.params.id);
    if (!story) return res.status(404).json({ message: 'Story not found' });
    if (story.authorId.toString() !== req.session.userId) {
      return res.status(403).json({ message: 'Not authorized' });
    }
    await story.deleteOne();
    res.json({ message: 'Story deleted' });
  } catch (error) {
    req.log.error({ err: error }, 'Error deleting story');
    res.status(500).json({ message: 'Server error deleting story' });
  }
});

// POST /api/stories/:id/publish — toggles published state
router.post('/:id/publish', requireAuth, async (req: Request, res: Response) => {
  try {
    const story = await Story.findById(req.params.id);
    if (!story) return res.status(404).json({ message: 'Story not found' });
    if (story.authorId.toString() !== req.session.userId) {
      return res.status(403).json({ message: 'Not authorized' });
    }
    if (!story.published && story.sentenceCount === 0) {
      return res.status(400).json({ message: 'Cannot publish a story with no sentences' });
    }
    story.published = !story.published;
    await story.save();
    res.json({ published: story.published });
  } catch (error) {
    req.log.error({ err: error }, 'Error publishing story');
    res.status(500).json({ message: 'Server error publishing story' });
  }
});

// POST /api/stories/:id/generate — calls AI service to generate all chapters
router.post('/:id/generate', requireAuth, requireCreatePermission, async (req: Request, res: Response) => {
  try {
    const story = await Story.findById(req.params.id);
    if (!story) return res.status(404).json({ message: 'Story not found' });
    if (story.authorId.toString() !== req.session.userId) {
      return res.status(403).json({ message: 'Not authorized' });
    }
    if (!story.seed?.trim()) {
      return res.status(400).json({ message: 'A story seed is required' });
    }

    const selection = resolveModelSelection(req.body?.model, req.body?.effort);
    if (!selection.ok) {
      return res.status(400).json({ message: selection.message, code: 'INVALID_MODEL' });
    }

    const result = await startStoryGeneration(String(req.params.id), selection.model, selection.effort);
    if (!result.ok) {
      if (result.code === 'ALREADY_GENERATING') {
        return res.status(409).json({ message: 'Story is already generating', code: 'STORY_GENERATING' });
      }
      if (result.code === 'MISSING_SEED') {
        return res.status(400).json({ message: 'A story seed is required' });
      }
      return res.status(404).json({ message: 'Story not found' });
    }

    res.status(202).json({ message: 'Story generation started', storyId: story._id });
  } catch (error) {
    req.log.error({ err: error }, 'Error starting story generation');
    res.status(500).json({ message: 'Server error starting story generation' });
  }
});

// POST /api/stories/:id/regenerate-chapter — regenerates one chapter, may touch others for coherence
router.post('/:id/regenerate-chapter', requireAuth, requireCreatePermission, async (req: Request, res: Response) => {
  try {
    const story = await Story.findById(req.params.id);
    if (!story) return res.status(404).json({ message: 'Story not found' });
    if (story.authorId.toString() !== req.session.userId) {
      return res.status(403).json({ message: 'Not authorized' });
    }

    const chapterIndex = parseInt(req.body.chapterIndex, 10);
    if (isNaN(chapterIndex) || chapterIndex < 0 || chapterIndex >= story.chapters.length) {
      return res.status(400).json({ message: 'Invalid chapter index' });
    }

    const selection = resolveModelSelection(req.body?.model, req.body?.effort);
    if (!selection.ok) {
      return res.status(400).json({ message: selection.message, code: 'INVALID_MODEL' });
    }

    const chapter = story.chapters[chapterIndex];
    const allChapters = story.chapters.map((c) => ({
      seed: c.seed,
      sentences: c.sentences.map((s) => ({ lang1: s.lang1, lang2: s.lang2 })),
    }));

    story.generating = true;
    await story.save();

    res.status(202).json({ message: 'Chapter regeneration started', storyId: story._id });

    // The request logger stays usable in the background after the response is sent.
    const backgroundLog = req.log.child({ module: 'regenerateChapter', storyId: story._id.toString() });

    setImmediate(async () => {
      try {
        const results = await aiService.regenerateChapter(
          chapterIndex,
          chapter.seed,
          req.body.generalFeedback?.trim() ?? '',
          story.seed,
          allChapters,
          story.nativeLanguage,
          story.learningLanguage,
          story.level,
          chapter.targetSentences,
          story.characters.map((c) => ({
            name: c.name,
            role: c.role,
            description: c.description,
            appearance: c.appearance,
          })),
          selection.model ?? story.aiModel,
          story.aiGuideline,
          selection.effort ?? normalizeEffort(story.aiReasoningEffort)
        );
        for (const r of results) {
          if (r.index >= 0 && r.index < story.chapters.length) {
            const target = story.chapters[r.index];
            if (r.title !== undefined) {
              target.title = sanitizeTitle(r.title);
            }
            // Preserve the author's premise when set; only fall back to the AI seed when blank.
            const aiSeed = typeof r.seed === 'string' ? r.seed.trim() : '';
            if (!target.seed?.trim() && aiSeed) {
              target.seed = aiSeed;
            }
            // Keep only valid pairs; never pad with empty strings (fails required validation)
            target.sentences = sanitizeSentences(r.sentences, target.targetSentences);
          }
        }
        story.generating = false;
        story.aiCallCount = (story.aiCallCount ?? 0) + 1;
        await story.save();
      } catch (error) {
        backgroundLog.error({ err: error }, 'Background chapter regeneration failed');
        await Story.updateOne({ _id: story._id }, { $set: { generating: false } });
      }
    });
  } catch (error) {
    req.log.error({ err: error }, 'Error starting chapter regeneration');
    res.status(500).json({ message: 'Server error starting chapter regeneration' });
  }
});

// ---------------------------------------------------------------------------
// Interactive (staged) authoring: outline -> chapters -> optional validation.
// Additive only: `/generate` above keeps its one-shot behaviour untouched.
// ---------------------------------------------------------------------------

function mapStagedFailure(res: Response, code: StagedStartFailure): void {
  switch (code) {
    case 'ALREADY_GENERATING':
      res.status(409).json({ message: 'Story is already generating', code: 'STORY_GENERATING' });
      return;
    case 'MISSING_SEED':
      res.status(400).json({ message: 'A story seed is required' });
      return;
    case 'MISSING_OUTLINE':
      res.status(400).json({ message: 'Generate and review the outline first', code: 'OUTLINE_REQUIRED' });
      return;
    case 'NO_CHAPTERS':
      res.status(400).json({ message: 'Add at least one chapter first', code: 'NO_CHAPTERS' });
      return;
    case 'WRONG_STAGE':
      res.status(400).json({ message: 'This story is not in interactive mode', code: 'NOT_STAGED' });
      return;
    default:
      res.status(404).json({ message: 'Story not found' });
  }
}

type ModelSelectionResult =
  | { ok: true; model?: string; effort?: ReasoningEffort }
  | { ok: false; message: string };

/**
 * Validates a (model, thinking level) pair against the shared catalogue.
 *
 * An empty effort means "provider default" and is always accepted. A level the
 * chosen model does not support is rejected rather than clamped, so an author is
 * never billed for a tier they did not ask for.
 */
function resolveModelSelection(modelValue: unknown, effortValue: unknown): ModelSelectionResult {
  let model: string | undefined;
  if (modelValue !== undefined && modelValue !== null && modelValue !== '') {
    if (typeof modelValue !== 'string' || !isSelectableModel(modelValue)) {
      return {
        ok: false,
        message: `Unsupported AI model. Use one of: ${ALLOWED_AI_MODELS.join(', ')}`,
      };
    }
    model = modelValue;
  }

  if (effortValue === undefined || effortValue === null || effortValue === '') {
    return { ok: true, model };
  }
  if (typeof effortValue !== 'string' || !isReasoningEffort(effortValue)) {
    return {
      ok: false,
      message: `Unsupported thinking level. Use one of: ${EFFORT_ORDER.join(', ')}`,
    };
  }

  const spec = findModelSpec(model ?? DEFAULT_AI_MODEL);
  if (!spec?.reasoning) {
    return {
      ok: false,
      message: 'The selected model has no thinking levels. Use a reasoning model or omit the effort.',
    };
  }
  if (spec.pinnedEffort) {
    return effortValue === spec.pinnedEffort
      ? { ok: true, model, effort: spec.pinnedEffort }
      : { ok: false, message: `${spec.label} fixes the thinking level to "${spec.pinnedEffort}".` };
  }
  if (!isEffortSupportedBy(spec, effortValue)) {
    return {
      ok: false,
      message: `Thinking level "${effortValue}" is not supported by ${spec.label}. Use one of: ${spec.efforts.join(', ')}`,
    };
  }

  return { ok: true, model, effort: effortValue };
}

async function loadOwnedStory(req: Request, res: Response) {
  const story = await Story.findById(req.params.id);
  if (!story) {
    res.status(404).json({ message: 'Story not found' });
    return null;
  }
  if (story.authorId.toString() !== req.session.userId) {
    res.status(403).json({ message: 'Not authorized' });
    return null;
  }
  return story;
}

// POST /api/stories/:id/outline — stage 1: plan the story (optionally revise it)
router.post('/:id/outline', requireAuth, requireCreatePermission, async (req: Request, res: Response) => {
  try {
    const story = await loadOwnedStory(req, res);
    if (!story) return;
    if (story.generationMode !== 'staged') {
      return res.status(400).json({ message: 'This story is not in interactive mode', code: 'NOT_STAGED' });
    }
    if (!story.seed?.trim()) {
      return res.status(400).json({ message: 'A story seed is required' });
    }
    if (story.chapters.length === 0) {
      return res.status(400).json({ message: 'Add at least one chapter first', code: 'NO_CHAPTERS' });
    }

    const selection = resolveModelSelection(req.body?.model, req.body?.effort);
    if (!selection.ok) {
      return res.status(400).json({ message: selection.message, code: 'INVALID_MODEL' });
    }

    const feedback = typeof req.body?.feedback === 'string' ? req.body.feedback : undefined;
    const result = await startOutlineGeneration(
      String(story._id),
      selection.model,
      feedback,
      selection.effort
    );
    if (!result.ok) return mapStagedFailure(res, result.code);

    res.status(202).json({ message: 'Outline generation started', storyId: story._id, stage: 'outline' });
  } catch (error) {
    req.log.error({ err: error }, 'Error starting outline generation');
    res.status(500).json({ message: 'Server error starting outline generation' });
  }
});

// POST /api/stories/:id/generate-chapters — stage 2: write the approved outline
router.post(
  '/:id/generate-chapters',
  requireAuth,
  requireCreatePermission,
  async (req: Request, res: Response) => {
    try {
      const story = await loadOwnedStory(req, res);
      if (!story) return;
      if (story.generationMode !== 'staged') {
        return res.status(400).json({ message: 'This story is not in interactive mode', code: 'NOT_STAGED' });
      }

      const selection = resolveModelSelection(req.body?.model, req.body?.effort);
      if (!selection.ok) {
        return res.status(400).json({ message: selection.message, code: 'INVALID_MODEL' });
      }

      const result = await startChapterGeneration(String(story._id), selection.model, selection.effort);
      if (!result.ok) return mapStagedFailure(res, result.code);

      res.status(202).json({
        message: 'Chapter generation started',
        storyId: story._id,
        stage: 'chapters',
        totalChapters: story.chapters.length,
      });
    } catch (error) {
      req.log.error({ err: error }, 'Error starting chapter generation');
      res.status(500).json({ message: 'Server error starting chapter generation' });
    }
  }
);

// POST /api/stories/:id/validate — stage 3 (optional): 'basic' | 'ai_review' | 'none'
router.post('/:id/validate', requireAuth, requireCreatePermission, async (req: Request, res: Response) => {
  try {
    const story = await loadOwnedStory(req, res);
    if (!story) return;
    if (story.generationMode !== 'staged') {
      return res.status(400).json({ message: 'This story is not in interactive mode', code: 'NOT_STAGED' });
    }

    const mode = req.body?.mode;
    if (mode !== 'basic' && mode !== 'ai_review' && mode !== 'none') {
      return res
        .status(400)
        .json({ message: "mode must be 'basic', 'ai_review' or 'none'", code: 'INVALID_MODE' });
    }

    if (mode === 'none') {
      const skipped = await skipValidation(String(story._id));
      if (!skipped) {
        return res.status(409).json({ message: 'Story is already generating', code: 'STORY_GENERATING' });
      }
      return res.json({ message: 'Validation skipped', stage: 'ready', validationMode: '' });
    }

    const selection = resolveModelSelection(req.body?.model, req.body?.effort);
    if (!selection.ok) {
      return res.status(400).json({ message: selection.message, code: 'INVALID_MODEL' });
    }

    const requestedMode: ValidationModeArg = mode;
    const result = await startValidation(
      String(story._id),
      requestedMode,
      selection.model,
      selection.effort
    );
    if (!result.ok) return mapStagedFailure(res, result.code);

    res.status(202).json({
      message: 'Validation started',
      storyId: story._id,
      stage: 'validation',
      mode: requestedMode,
    });
  } catch (error) {
    req.log.error({ err: error }, 'Error starting validation');
    res.status(500).json({ message: 'Server error starting validation' });
  }
});

// POST /api/stories/:id/reset-outline — go back to stage 1 to re-iterate on the plan
router.post(
  '/:id/reset-outline',
  requireAuth,
  requireCreatePermission,
  async (req: Request, res: Response) => {
    try {
      const story = await loadOwnedStory(req, res);
      if (!story) return;
      if (story.generationMode !== 'staged') {
        return res.status(400).json({ message: 'This story is not in interactive mode', code: 'NOT_STAGED' });
      }
      if (story.generating) {
        return res.status(409).json({ message: 'Story is already generating', code: 'STORY_GENERATING' });
      }

      await Story.updateOne(
        { _id: story._id },
        { $set: { stage: 'outline' }, $unset: { 'outline.approvedAt': '' } }
      );
      res.json({ message: 'Back to the outline stage', stage: 'outline' });
    } catch (error) {
      req.log.error({ err: error }, 'Error resetting outline stage');
      res.status(500).json({ message: 'Server error resetting outline stage' });
    }
  }
);

// POST /api/stories/:id/clone — deep-copy a story into a new draft owned by the requester
router.post('/:id/clone', requireAuth, requireCreatePermission, async (req: Request, res: Response) => {
  try {
    const source = await Story.findById(req.params.id);
    if (!source) return res.status(404).json({ message: 'Story not found' });

    // You may clone your own stories (drafts or published) or any published story
    const isOwner = source.authorId.toString() === req.session.userId;
    if (!isOwner && !source.published) {
      return res.status(403).json({ message: 'Story not published' });
    }
    if (source.generating) {
      return res.status(400).json({ message: 'Story is still generating' });
    }

    const author = await User.findById(req.session.userId).select('username');
    if (!author) return res.status(401).json({ message: 'User not found' });
    const legacyTopic = (source as unknown as { topic?: unknown }).topic;

    const sourceTitleLang1 = source.title?.lang1?.trim() ?? '';
    const clone = new Story({
      title: {
        // A blank title stays blank so the AI can generate one on demand.
        lang1: sourceTitleLang1 ? `${sourceTitleLang1} (copy)` : '',
        lang2: source.title?.lang2 ?? '',
      },
      chapters: source.chapters.map((c) => ({
        title: { lang1: c.title?.lang1 ?? '', lang2: c.title?.lang2 ?? '' },
        seed: c.seed,
        targetSentences: c.targetSentences,
        sentences: c.sentences.map((s) => ({ lang1: s.lang1, lang2: s.lang2 })),
      })),
      characters: source.characters.map((c) => ({
        name: c.name,
        role: c.role,
        description: c.description,
        appearance: c.appearance,
      })),
      nativeLanguage: source.nativeLanguage,
      learningLanguage: source.learningLanguage,
      level: source.level,
      labels: sanitizeLabels(source.labels, legacyTopic),
      seed: source.seed,
      aiGuideline: source.aiGuideline,
      targetChapters: source.targetChapters,
      authorId: req.session.userId,
      authorName: author.username,
      published: false,
      generating: false,
      isAIGenerated: source.isAIGenerated,
    });

    await clone.save();
    res.status(201).json(clone);
  } catch (error) {
    req.log.error({ err: error }, 'Error cloning story');
    res.status(500).json({ message: 'Server error cloning story' });
  }
});

export default router;