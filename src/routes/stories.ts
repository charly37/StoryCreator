import express, { Request, Response, NextFunction } from 'express';
import Story from '../models/Story';
import User from '../models/User';
import { aiService, sanitizeSentences, sanitizeTitle } from '../services/aiService';

const DEFAULT_SENTENCES_PER_CHAPTER = 12;
const MAX_CHARACTERS = 20;
const MAX_CHAPTERS_PER_STORY = 10;
const MAX_AI_GUIDELINE_LENGTH = 2000;

interface CharacterInput {
  name?: unknown;
  role?: unknown;
  description?: unknown;
  appearance?: unknown;
}

/** Trims character fields, drops nameless entries, and caps the cast size. */
function sanitizeCharacters(input: unknown): Array<{ name: string; role: string; description: string; appearance: string }> {
  if (!Array.isArray(input)) return [];
  return input
    .filter((c): c is CharacterInput => !!c && typeof c === 'object')
    .map((c) => ({
      name: typeof c.name === 'string' ? c.name.trim() : '',
      role: typeof c.role === 'string' ? c.role.trim() : '',
      description: typeof c.description === 'string' ? c.description.trim() : '',
      appearance: typeof c.appearance === 'string' ? c.appearance.trim() : '',
    }))
    .filter((c) => c.name !== '')
    .slice(0, MAX_CHARACTERS);
}

function sanitizeAIGuideline(input: unknown): string {
  if (typeof input !== 'string') return '';
  return input.trim().slice(0, MAX_AI_GUIDELINE_LENGTH);
}

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
    console.error('Error checking creator permission:', error);
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
    console.error('Error fetching user stories:', error);
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
        { topic: { $regex: search, $options: 'i' } },
      ];
    }

    const [stories, total] = await Promise.all([
      Story.find(filter).select('-chapters.sentences').sort({ createdAt: -1 }).skip(skip).limit(limit),
      Story.countDocuments(filter),
    ]);

    res.json({ stories, total, page: parseInt(page as string, 10), pages: Math.ceil(total / limit) });
  } catch (error) {
    console.error('Error fetching stories:', error);
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
    res.json(story);
  } catch (error) {
    console.error('Error fetching story:', error);
    res.status(500).json({ message: 'Server error fetching story' });
  }
});

// POST /api/stories
router.post('/', requireAuth, requireCreatePermission, async (req: Request, res: Response) => {
  try {
    const { title, nativeLanguage, learningLanguage, level, topic } = req.body;

    if (!title?.lang1) {
      return res.status(400).json({ message: 'Title is required' });
    }
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

    const story = new Story({
      title,
      chapters,
      targetChapters,
      characters: sanitizeCharacters(req.body.characters),
      nativeLanguage,
      learningLanguage,
      level,
      topic: topic || '',
      seed: req.body.seed || '',
      aiGuideline: sanitizeAIGuideline(req.body.aiGuideline),
      authorId: req.session.userId,
      authorName: author.username,
      published: false,
    });

    await story.save();
    res.status(201).json(story);
  } catch (error) {
    console.error('Error creating story:', error);
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

    const { title, nativeLanguage, learningLanguage, level, topic } = req.body;

    if (nativeLanguage && learningLanguage && nativeLanguage === learningLanguage) {
      return res.status(400).json({ message: 'Native and learning languages must be different' });
    }

    if (title) story.title = title;
    if (nativeLanguage) story.nativeLanguage = nativeLanguage;
    if (learningLanguage) story.learningLanguage = learningLanguage;
    if (level) story.level = level;
    if (topic !== undefined) story.topic = topic;
    if (req.body.seed !== undefined) story.seed = req.body.seed;
    if (req.body.aiModel !== undefined) story.aiModel = req.body.aiModel;
    if (req.body.aiGuideline !== undefined) story.aiGuideline = sanitizeAIGuideline(req.body.aiGuideline);
    if (req.body.characters !== undefined) story.characters = sanitizeCharacters(req.body.characters);
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
    console.error('Error updating story:', error);
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
    console.error('Error inserting chapter:', error);
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
    console.error('Error deleting chapter:', error);
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
    console.error('Error deleting story:', error);
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
    console.error('Error publishing story:', error);
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

    const chapterSpecs = story.chapters.map((c) => ({
      seed: c.seed,
      targetSentences: c.targetSentences,
    }));
    const characters = story.characters.map((c) => ({
      name: c.name,
      role: c.role,
      description: c.description,
      appearance: c.appearance,
    }));
    const hadCharacters = characters.length > 0;

    story.generating = true;
    await story.save();

    const { model } = req.body as { model?: string };
    res.status(202).json({ message: 'Story generation started', storyId: story._id });

    setImmediate(async () => {
      try {
        const generated = await aiService.generateStory(
          story.seed,
          story.nativeLanguage,
          story.learningLanguage,
          chapterSpecs,
          characters,
          story.level,
          model,
          story.aiGuideline
        );
        story.chapters = generated.chapters.map((c, i) => ({
          title: c.title,
          seed: chapterSpecs[i]?.seed?.trim() || c.seed,
          targetSentences: chapterSpecs[i]?.targetSentences ?? c.sentences.length,
          sentences: c.sentences,
        }));
        // Auto-populate the cast only when the author had not defined one
        if (!hadCharacters && generated.characters.length > 0) {
          story.characters = generated.characters;
        }
        story.title.lang2 = generated.title;
        story.isAIGenerated = true;
        story.generating = false;
        story.aiCallCount = (story.aiCallCount ?? 0) + 1;
        await story.save();
      } catch (error) {
        console.error('Background story generation failed:', error);
        // Use updateOne (no document validation) so a partially-populated in-memory
        // story cannot throw again and crash the process.
        await Story.updateOne({ _id: story._id }, { $set: { generating: false } });
      }
    });
  } catch (error) {
    console.error('Error starting story generation:', error);
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

    const chapter = story.chapters[chapterIndex];
    const allChapters = story.chapters.map((c) => ({
      seed: c.seed,
      sentences: c.sentences.map((s) => ({ lang1: s.lang1, lang2: s.lang2 })),
    }));

    story.generating = true;
    await story.save();

    res.status(202).json({ message: 'Chapter regeneration started', storyId: story._id });

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
          req.body.model,
          story.aiGuideline
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
        console.error('Background chapter regeneration failed:', error);
        await Story.updateOne({ _id: story._id }, { $set: { generating: false } });
      }
    });
  } catch (error) {
    console.error('Error starting chapter regeneration:', error);
    res.status(500).json({ message: 'Server error starting chapter regeneration' });
  }
});

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

    const clone = new Story({
      title: {
        lang1: `${source.title.lang1} (copy)`,
        lang2: source.title.lang2,
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
      topic: source.topic,
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
    console.error('Error cloning story:', error);
    res.status(500).json({ message: 'Server error cloning story' });
  }
});

export default router;