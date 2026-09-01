import express, { Request, Response, NextFunction } from 'express';
import Story from '../models/Story';
import User from '../models/User';
import { aiService } from '../services/aiService';

const SENTENCES_PER_PAGE = 12;

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
      .select('-sentences')
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
      Story.find(filter).select('-sentences').sort({ createdAt: -1 }).skip(skip).limit(limit),
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
    const { title, sentences, nativeLanguage, learningLanguage, level, topic } = req.body;

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

    const story = new Story({
      title,
      sentences: sentences || [],
      nativeLanguage,
      learningLanguage,
      level,
      topic: topic || '',
      seed: req.body.seed || '',
      targetPages: req.body.targetPages || 1,
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

    const { title, sentences, nativeLanguage, learningLanguage, level, topic } = req.body;

    if (nativeLanguage && learningLanguage && nativeLanguage === learningLanguage) {
      return res.status(400).json({ message: 'Native and learning languages must be different' });
    }

    if (title) story.title = title;
    if (sentences !== undefined) story.sentences = sentences;
    if (nativeLanguage) story.nativeLanguage = nativeLanguage;
    if (learningLanguage) story.learningLanguage = learningLanguage;
    if (level) story.level = level;
    if (topic !== undefined) story.topic = topic;
    if (req.body.seed !== undefined) story.seed = req.body.seed;
    if (req.body.targetPages !== undefined) story.targetPages = req.body.targetPages;

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
    if (!story.published && story.sentences.length === 0) {
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

// POST /api/stories/:id/generate — calls AI service to generate bilingual sentences
router.post('/:id/generate', requireAuth, async (req: Request, res: Response) => {
  try {
    const story = await Story.findById(req.params.id);
    if (!story) return res.status(404).json({ message: 'Story not found' });
    if (story.authorId.toString() !== req.session.userId) {
      return res.status(403).json({ message: 'Not authorized' });
    }

    const { seed, targetPages } = req.body;
    if (!seed || typeof seed !== 'string' || !seed.trim()) {
      return res.status(400).json({ message: 'A story seed is required' });
    }
    const pages = Math.min(Math.max(parseInt(targetPages, 10) || 1, 1), 10);
    const sentenceCount = pages * SENTENCES_PER_PAGE;

    const generated = await aiService.generateStory(
      seed.trim(),
      story.nativeLanguage,
      story.learningLanguage,
      sentenceCount
    );

    story.seed = seed.trim();
    story.targetPages = pages;
    story.sentences = generated;
    await story.save();

    res.json(story);
  } catch (error) {
    console.error('Error generating story:', error);
    res.status(500).json({ message: 'Server error generating story' });
  }
});

export default router;
