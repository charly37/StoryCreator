import express, { Request, Response, NextFunction } from 'express';
import Story from '../models/Story';
import User from '../models/User';
import { aiService, SentencePatch } from '../services/aiService';

const DEFAULT_SENTENCES_PER_CHAPTER = 12;

const router = express.Router();

function requireAuth(req: Request, res: Response, next: NextFunction): void {
  if (!req.session.userId) {
    res.status(401).json({ message: 'Authentication required' });
    return;
  }
  next();
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
router.post('/', requireAuth, async (req: Request, res: Response) => {
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
      ? rawChapters.map((c: { seed?: string; targetSentences?: number }) => ({
          seed: c.seed ?? '',
          targetSentences: Math.min(Math.max(parseInt(String(c.targetSentences), 10) || DEFAULT_SENTENCES_PER_CHAPTER, 1), 100),
          sentences: [],
        }))
      : Array.from({ length: targetChapters }, () => ({ seed: '', targetSentences: DEFAULT_SENTENCES_PER_CHAPTER, sentences: [] }));

    const story = new Story({
      title,
      chapters,
      targetChapters,
      nativeLanguage,
      learningLanguage,
      level,
      topic: topic || '',
      seed: req.body.seed || '',
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
    if (req.body.targetChapters !== undefined) {
      story.targetChapters = Math.min(Math.max(parseInt(req.body.targetChapters, 10) || 1, 1), 10);
    }

    // Update chapter metadata (seed + targetSentences) without touching sentence content
    if (Array.isArray(req.body.chapters)) {
      const incoming = req.body.chapters as Array<{ seed?: string; targetSentences?: number }>;
      // Resize chapters array if needed
      while (story.chapters.length < incoming.length) {
        story.chapters.push({ seed: '', targetSentences: DEFAULT_SENTENCES_PER_CHAPTER, sentences: [] });
      }
      story.chapters = story.chapters.slice(0, incoming.length);
      for (let i = 0; i < incoming.length; i++) {
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
    // seed is the fallback for stories generated before isAIGenerated was added
    const requiresApproval = story.isAIGenerated || !!story.seed;
    if (!story.published && requiresApproval && !story.approved) {
      return res.status(400).json({ message: 'AI-generated stories must be reviewed and approved before publishing' });
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
router.post('/:id/generate', requireAuth, async (req: Request, res: Response) => {
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

    story.generating = true;
    await story.save();

    res.status(202).json({ message: 'Story generation started', storyId: story._id });

    setImmediate(async () => {
      try {
        const generated = await aiService.generateStory(
          story.seed,
          story.nativeLanguage,
          story.learningLanguage,
          chapterSpecs,
          story.level
        );
        story.chapters = generated.chapters.map((c, i) => ({
          seed: c.seed,
          targetSentences: chapterSpecs[i]?.targetSentences ?? c.sentences.length,
          sentences: c.sentences,
        }));
        story.title.lang2 = generated.title;
        story.isAIGenerated = true;
        story.generating = false;
        await story.save();
      } catch (error) {
        console.error('Background story generation failed:', error);
        story.generating = false;
        await story.save();
      }
    });
  } catch (error) {
    console.error('Error starting story generation:', error);
    res.status(500).json({ message: 'Server error starting story generation' });
  }
});

// POST /api/stories/:id/review — patch annotated sentences via AI (fire-and-forget)
router.post('/:id/review', requireAuth, async (req: Request, res: Response) => {
  try {
    const story = await Story.findById(req.params.id);
    if (!story) return res.status(404).json({ message: 'Story not found' });
    if (story.authorId.toString() !== req.session.userId) {
      return res.status(403).json({ message: 'Not authorized' });
    }

    const { generalFeedback, annotations } = req.body as {
      generalFeedback?: string;
      annotations?: Array<{ chapterIndex: number; sentenceIndex: number; feedback: string }>;
    };

    if (!Array.isArray(annotations) || annotations.length === 0) {
      return res.status(400).json({ message: 'At least one sentence annotation is required' });
    }

    const patches: SentencePatch[] = annotations
      .filter((a) =>
        a.chapterIndex >= 0 && a.chapterIndex < story.chapters.length &&
        a.sentenceIndex >= 0 && a.sentenceIndex < story.chapters[a.chapterIndex].sentences.length &&
        a.feedback?.trim()
      )
      .map((a) => ({
        chapterIndex: a.chapterIndex,
        sentenceIndex: a.sentenceIndex,
        lang1: story.chapters[a.chapterIndex].sentences[a.sentenceIndex].lang1,
        lang2: story.chapters[a.chapterIndex].sentences[a.sentenceIndex].lang2,
        feedback: a.feedback.trim(),
      }));

    if (patches.length === 0) {
      return res.status(400).json({ message: 'No valid sentence annotations found' });
    }

    story.generating = true;
    await story.save();

    res.status(202).json({ message: 'Review patch started', storyId: story._id });

    setImmediate(async () => {
      try {
        const patched = await aiService.patchSentences(
          patches,
          generalFeedback?.trim() ?? '',
          story.nativeLanguage,
          story.learningLanguage,
          story.level
        );
        for (const p of patched) {
          if (p.chapterIndex >= 0 && p.chapterIndex < story.chapters.length &&
              p.sentenceIndex >= 0 && p.sentenceIndex < story.chapters[p.chapterIndex].sentences.length) {
            story.chapters[p.chapterIndex].sentences[p.sentenceIndex] = { lang1: p.lang1, lang2: p.lang2 };
          }
        }
        story.generating = false;
        await story.save();
      } catch (error) {
        console.error('Background review patch failed:', error);
        story.generating = false;
        await story.save();
      }
    });
  } catch (error) {
    console.error('Error starting review patch:', error);
    res.status(500).json({ message: 'Server error starting review patch' });
  }
});

// POST /api/stories/:id/regenerate-chapter — regenerates one chapter, may touch others for coherence
router.post('/:id/regenerate-chapter', requireAuth, async (req: Request, res: Response) => {
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
          allChapters,
          story.nativeLanguage,
          story.learningLanguage,
          story.level,
          chapter.targetSentences
        );
        for (const r of results) {
          if (r.index >= 0 && r.index < story.chapters.length) {
            story.chapters[r.index].seed = r.seed;
            // trim/pad to targetSentences
            let sents = r.sentences.slice(0, story.chapters[r.index].targetSentences);
            while (sents.length < story.chapters[r.index].targetSentences) sents.push({ lang1: '', lang2: '' });
            story.chapters[r.index].sentences = sents;
          }
        }
        story.generating = false;
        await story.save();
      } catch (error) {
        console.error('Background chapter regeneration failed:', error);
        story.generating = false;
        await story.save();
      }
    });
  } catch (error) {
    console.error('Error starting chapter regeneration:', error);
    res.status(500).json({ message: 'Server error starting chapter regeneration' });
  }
});

// POST /api/stories/:id/approve — marks story as reviewed and approved for publishing
router.post('/:id/approve', requireAuth, async (req: Request, res: Response) => {
  try {
    const story = await Story.findById(req.params.id);
    if (!story) return res.status(404).json({ message: 'Story not found' });
    if (story.authorId.toString() !== req.session.userId) {
      return res.status(403).json({ message: 'Not authorized' });
    }
    if (story.sentenceCount === 0) {
      return res.status(400).json({ message: 'Cannot approve a story with no sentences' });
    }
    story.approved = true;
    await story.save();
    res.json({ approved: story.approved });
  } catch (error) {
    console.error('Error approving story:', error);
    res.status(500).json({ message: 'Server error approving story' });
  }
});

export default router;