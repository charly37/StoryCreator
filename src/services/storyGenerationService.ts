import mongoose from 'mongoose';
import Story from '../models/Story';
import { aiService } from './aiService';
import { AI_MODELS, DEFAULT_AI_MODEL } from '../client/utils/aiModels';
import { createLogger } from '../config/logger';

const log = createLogger('storyGeneration');

/**
 * Models exposed to API clients. `gpt-5-mini-high` is a UI-only label in
 * `AI_MODELS` (reasoning_effort is not wired up), so it is not a valid model id.
 */
const UI_ONLY_MODEL_IDS = new Set(['gpt-5-mini-high']);
export const ALLOWED_AI_MODELS = AI_MODELS.map((model) => model.id).filter(
  (id) => !UI_ONLY_MODEL_IDS.has(id)
);

export { DEFAULT_AI_MODEL };

export type StartGenerationFailure = 'NOT_FOUND' | 'MISSING_SEED' | 'ALREADY_GENERATING';

export type StartGenerationResult =
  | { ok: true; storyId: string }
  | { ok: false; code: StartGenerationFailure };

/**
 * Marks a story as generating and schedules the AI job.
 *
 * Uses a conditional `findOneAndUpdate` so two concurrent requests cannot both
 * start a paid generation for the same story.
 */
export async function startStoryGeneration(
  storyId: string,
  model?: string
): Promise<StartGenerationResult> {
  if (!mongoose.isValidObjectId(storyId)) {
    return { ok: false, code: 'NOT_FOUND' };
  }

  const story = await Story.findOneAndUpdate(
    { _id: storyId, generating: { $ne: true } },
    { $set: { generating: true, generationError: '' } },
    { new: true }
  );
  if (!story) {
    const exists = await Story.exists({ _id: storyId });
    return { ok: false, code: exists ? 'ALREADY_GENERATING' : 'NOT_FOUND' };
  }

  if (!story.seed?.trim()) {
    await Story.updateOne({ _id: storyId }, { $set: { generating: false } });
    return { ok: false, code: 'MISSING_SEED' };
  }

  setImmediate(() => {
    void runStoryGeneration(storyId, model);
  });

  return { ok: true, storyId };
}

/**
 * Background body of a full-story generation. Mirrors the website flow:
 * chapter specs and the author's cast are sent to the AI; an empty cast is
 * replaced by the AI-invented one; `title.lang2` is filled in.
 *
 * Failures are persisted on the story instead of crashing the process, and a
 * deferred `publishWhenReady` intent is only honoured when content exists.
 */
async function runStoryGeneration(storyId: string, model?: string): Promise<void> {
  const storyLog = log.child({ storyId });
  try {
    const story = await Story.findById(storyId);
    if (!story) return;

    const chapterSpecs = story.chapters.map((chapter) => ({
      seed: chapter.seed,
      targetSentences: chapter.targetSentences,
    }));
    const characters = story.characters.map((character) => ({
      name: character.name,
      role: character.role,
      description: character.description,
      appearance: character.appearance,
    }));
    const hadCharacters = characters.length > 0;

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

    story.chapters = generated.chapters.map((chapter, index) => ({
      title: chapter.title,
      seed: chapterSpecs[index]?.seed?.trim() || chapter.seed,
      targetSentences: chapterSpecs[index]?.targetSentences ?? chapter.sentences.length,
      sentences: chapter.sentences,
    }));

    // Auto-populate the cast only when the author had not defined one.
    if (!hadCharacters && generated.characters.length > 0) {
      story.characters = generated.characters;
    }

    story.title.lang2 = generated.title;
    story.isAIGenerated = true;
    story.generating = false;
    story.generationError = '';
    story.aiCallCount = (story.aiCallCount ?? 0) + 1;

    const hasSentences = story.chapters.some((chapter) => chapter.sentences.length > 0);
    if (story.publishWhenReady && hasSentences) {
      story.published = true;
    }
    story.publishWhenReady = false;

    await story.save();
  } catch (error) {
    storyLog.error({ err: error }, 'Background story generation failed');
    const message = error instanceof Error ? error.message : String(error);
    // updateOne bypasses validation so a partially-populated in-memory document
    // cannot throw again and crash the process.
    await Story.updateOne(
      { _id: storyId },
      {
        $set: {
          generating: false,
          generationError: message.slice(0, 500),
          publishWhenReady: false,
        },
      }
    ).catch((updateError) => {
      storyLog.error({ err: updateError }, 'Failed to record story generation failure');
    });
  }
}
