import mongoose from 'mongoose';
import Story, { IChapter, IStory } from '../models/Story';
import { aiService, CharacterSpec, OutlineChapterSpec, StoryOutline } from './aiService';
import {
  SELECTABLE_MODELS,
  DEFAULT_AI_MODEL,
  normalizeEffort,
  type ReasoningEffort,
} from '../shared/aiModels';
import { createLogger } from '../config/logger';
import { beginJob, failJob, finishJob, recountSentences } from './storyJobService';
import { MAX_ISSUES, sanitizeIssues } from './storyInput';

const log = createLogger('storyGeneration');

/** Every selectable model id, derived from the shared catalogue (7 entries). */
export const ALLOWED_AI_MODELS: string[] = SELECTABLE_MODELS.map((model) => model.id);

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
  model?: string,
  effort?: ReasoningEffort | ''
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
    void runStoryGeneration(storyId, model, effort);
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
async function runStoryGeneration(
  storyId: string,
  model?: string,
  effort?: ReasoningEffort | ''
): Promise<void> {
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

    const providedTitle = {
      lang1: story.title?.lang1?.trim() ?? '',
      lang2: story.title?.lang2?.trim() ?? '',
    };

    const generated = await aiService.generateStory(
      story.seed,
      story.nativeLanguage,
      story.learningLanguage,
      chapterSpecs,
      characters,
      story.level,
      // Honour the author's stored choice instead of silently reverting to the default.
      model ?? story.aiModel ?? DEFAULT_AI_MODEL,
      story.aiGuideline,
      providedTitle,
      effort ?? normalizeEffort(story.aiReasoningEffort)
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

    // Title is optional at creation. When the author left lang1 blank, take the
    // AI's bilingual title; otherwise preserve the author's title and only fill
    // the missing language (the AI is asked to translate it).
    const fallbackTitle = generated.chapters[0]?.title ?? { lang1: '', lang2: '' };
    if (!providedTitle.lang1) {
      story.title.lang1 =
        generated.title.lang1 || generated.title.lang2 || fallbackTitle.lang1 || '';
      story.title.lang2 =
        generated.title.lang2 || generated.title.lang1 || fallbackTitle.lang2 || '';
    } else if (!providedTitle.lang2) {
      story.title.lang2 =
        generated.title.lang2 || generated.title.lang1 || fallbackTitle.lang2 || '';
    }

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

// ---------------------------------------------------------------------------
// Staged generation (opt-in): outline -> chapters -> optional validation.
// Everything below is additive: `startStoryGeneration` / `runStoryGeneration`
// above are untouched, so the one-shot path and the public API are unchanged.
// ---------------------------------------------------------------------------

export type StagedStartFailure =
  | 'NOT_FOUND'
  | 'ALREADY_GENERATING'
  | 'MISSING_SEED'
  | 'MISSING_OUTLINE'
  | 'WRONG_STAGE'
  | 'NO_CHAPTERS';

export type StagedStartResult =
  | { ok: true; storyId: string }
  | { ok: false; code: StagedStartFailure };

export type ValidationModeArg = 'basic' | 'ai_review';

function characterSpecs(story: IStory): CharacterSpec[] {
  return story.characters.map((character) => ({
    name: character.name ?? '',
    role: character.role ?? '',
    description: character.description ?? '',
    appearance: character.appearance ?? '',
  }));
}

function chapterSpecs(story: IStory): OutlineChapterSpec[] {
  return story.chapters.map((chapter) => ({
    title: { lang1: chapter.title?.lang1 ?? '', lang2: chapter.title?.lang2 ?? '' },
    seed: chapter.seed ?? '',
    targetSentences: chapter.targetSentences,
  }));
}

function synopsisOf(story: IStory): { lang1: string; lang2: string } {
  return {
    lang1: story.outline?.synopsis?.lang1 ?? '',
    lang2: story.outline?.synopsis?.lang2 ?? '',
  };
}

/**
 * Stage 1 — plans the story and stops. The author iterates on the result, so no
 * prose is written and the call stays cheap.
 */
export async function startOutlineGeneration(
  storyId: string,
  model?: string,
  feedback?: string,
  effort?: ReasoningEffort | ''
): Promise<StagedStartResult> {
  const started = await beginJob(storyId, {
    jobProgress: { stage: 'outline', done: 0, total: 1, currentLabel: 'Planning the story' },
  });
  if (!started.ok) return started;

  const abort = async (code: StagedStartFailure): Promise<StagedStartResult> => {
    await finishJob(storyId);
    return { ok: false, code };
  };

  const story = started.story;
  if (story.generationMode !== 'staged') return abort('WRONG_STAGE');
  if (!story.seed?.trim()) return abort('MISSING_SEED');
  if (story.chapters.length === 0) return abort('NO_CHAPTERS');

  // Only advance the stage once the request is guaranteed to run, so a
  // rejected start leaves the story on its current step.
  await Story.updateOne({ _id: storyId }, { $set: { stage: 'outline' } });

  const trimmedFeedback = (feedback ?? '').trim();
  setImmediate(() => {
    void runOutlineGeneration(storyId, model, trimmedFeedback, effort);
  });

  return { ok: true, storyId };
}

async function runOutlineGeneration(
  storyId: string,
  model: string | undefined,
  feedback: string,
  effort?: ReasoningEffort | ''
): Promise<void> {
  const storyLog = log.child({ storyId, stage: 'outline' });
  try {
    const story = await Story.findById(storyId);
    if (!story) {
      storyLog.warn('Story disappeared during outline generation');
      return;
    }

    const specs = chapterSpecs(story);
    const currentSynopsis = synopsisOf(story);
    const previousOutline: StoryOutline | null = feedback
      ? {
          title: { lang1: story.title?.lang1 ?? '', lang2: story.title?.lang2 ?? '' },
          synopsis: currentSynopsis,
          characters: characterSpecs(story),
          chapters: specs,
        }
      : null;

    const outline = await aiService.generateOutline({
      seed: story.seed,
      nativeLanguage: story.nativeLanguage,
      learningLanguage: story.learningLanguage,
      level: story.level,
      characters: characterSpecs(story),
      chapterSpecs: specs,
      model: model ?? story.outlineAiModel ?? DEFAULT_AI_MODEL,
      effort: effort ?? normalizeEffort(story.outlineReasoningEffort),
      aiGuideline: story.aiGuideline,
      storyTitle: { lang1: story.title?.lang1 ?? '', lang2: story.title?.lang2 ?? '' },
      previousOutline,
      feedback,
    });

    // Keep any existing sentences/recaps: re-planning must not delete prose.
    const chapters = outline.chapters.map((spec, index) => {
      const existing: IChapter | undefined = story.chapters[index];
      return {
        title: spec.title,
        seed: spec.seed,
        targetSentences: spec.targetSentences,
        sentences: existing?.sentences ?? [],
        recap: existing?.recap ?? '',
        issues: [],
      };
    });

    const authorTitleLang1 = story.title?.lang1?.trim() ?? '';
    const authorTitleLang2 = story.title?.lang2?.trim() ?? '';
    const set: Record<string, unknown> = {
      'outline.synopsis': outline.synopsis,
      chapters,
      isAIGenerated: true,
      jobProgress: { stage: 'outline', done: 1, total: 1, currentLabel: '' },
    };
    if (!authorTitleLang1) {
      set['title.lang1'] = outline.title.lang1 || outline.title.lang2;
      set['title.lang2'] = outline.title.lang2 || outline.title.lang1;
    } else if (!authorTitleLang2) {
      set['title.lang2'] = outline.title.lang2 || outline.title.lang1;
    }
    if (story.characters.length === 0 && outline.characters.length > 0) {
      set['characters'] = outline.characters;
    }

    await finishJob(storyId, {
      set: set as mongoose.UpdateQuery<IStory>['$set'],
      unset: { 'outline.approvedAt': '' },
      inc: { aiCallCount: 1 },
    });
    storyLog.info({ chapterCount: chapters.length }, 'Outline generated');
  } catch (error) {
    await failJob(storyId, error);
  }
}

/**
 * Stage 2 — writes the approved outline chapter by chapter (sequential, with
 * rolling recaps). Requires stage 1 to be done; the call itself implies approval.
 */
export async function startChapterGeneration(
  storyId: string,
  model?: string,
  effort?: ReasoningEffort | ''
): Promise<StagedStartResult> {
  const started = await beginJob(storyId, {
    jobProgress: { stage: 'chapters', done: 0, total: 0, currentLabel: 'Preparing' },
  });
  if (!started.ok) return started;

  const abort = async (code: StagedStartFailure): Promise<StagedStartResult> => {
    await finishJob(storyId);
    return { ok: false, code };
  };

  const story = started.story;
  if (story.generationMode !== 'staged') return abort('WRONG_STAGE');
  const synopsis = synopsisOf(story);
  if (story.stage === 'setup' || (!synopsis.lang1.trim() && !synopsis.lang2.trim())) {
    return abort('MISSING_OUTLINE');
  }
  if (story.chapters.length === 0) return abort('NO_CHAPTERS');

  const total = story.chapters.length;
  await Story.updateOne({ _id: storyId }, {
    $set: {
      stage: 'chapters',
      'outline.approvedAt': new Date(),
      jobProgress: { stage: 'chapters', done: 0, total, currentLabel: `Chapter 1 of ${total}` },
    },
  });

  setImmediate(() => {
    void runChapterGeneration(storyId, model, effort);
  });

  return { ok: true, storyId };
}

async function runChapterGeneration(
  storyId: string,
  model?: string,
  effort?: ReasoningEffort | ''
): Promise<void> {
  const storyLog = log.child({ storyId, stage: 'chapters' });
  try {
    const story = await Story.findById(storyId);
    if (!story) {
      storyLog.warn('Story disappeared during chapter generation');
      return;
    }

    const specs = chapterSpecs(story);
    const total = specs.length;
    const synopsis = synopsisOf(story);
    const cast = characterSpecs(story);
    const generationModel = model ?? story.aiModel ?? DEFAULT_AI_MODEL;
    const generationEffort = effort ?? normalizeEffort(story.aiReasoningEffort);
    const recaps = story.chapters.map((chapter) => chapter.recap ?? '');
    let written = 0;

    for (let index = 0; index < total; index += 1) {
      // Re-read before every write: chapters have no stable id, so an author
      // adding/removing one mid-run would silently shift the write target.
      const current = await Story.findById(storyId).select('chapters');
      if (!current) {
        storyLog.warn('Story disappeared mid-run');
        return;
      }
      if (current.chapters.length !== total) {
        throw new Error('The chapter list changed during generation — please retry.');
      }

      const draft = await aiService.generateChapter({
        storySeed: story.seed,
        synopsis,
        chapterSpec: specs[index],
        chapterIndex: index,
        previousRecaps: recaps,
        characters: cast,
        nativeLanguage: story.nativeLanguage,
        learningLanguage: story.learningLanguage,
        level: story.level,
        model: generationModel,
        effort: generationEffort,
        aiGuideline: story.aiGuideline,
      });

      const recap = draft.recap || draft.seed || specs[index].seed || '';
      recaps[index] = recap;
      written += 1;

      const set: Record<string, unknown> = {
        [`chapters.${index}.title`]: draft.title,
        [`chapters.${index}.seed`]: draft.seed || specs[index].seed,
        [`chapters.${index}.sentences`]: draft.sentences,
        [`chapters.${index}.recap`]: recap,
        [`chapters.${index}.issues`]: [],
        jobProgress: {
          stage: 'chapters',
          done: index + 1,
          total,
          currentLabel: index + 1 < total ? `Chapter ${index + 2} of ${total}` : 'Finishing',
        },
        generatingSince: new Date(),
      };

      await Story.updateOne({ _id: storyId }, { $set: set });
      await recountSentences(storyId);
      storyLog.info({ chapterIndex: index, sentences: draft.sentences.length }, 'Chapter generated');
    }

    await finishJob(storyId, {
      set: {
        stage: 'validation',
        jobProgress: { stage: 'chapters', done: total, total, currentLabel: '' },
        isAIGenerated: true,
      } as mongoose.UpdateQuery<IStory>['$set'],
      inc: { aiCallCount: written },
    });
  } catch (error) {
    await failJob(storyId, error);
  }
}

/**
 * Stage 3 — free deterministic checks; used by both validation modes.
 * Issues are plain English strings stored on the chapter and rendered by the UI.
 */
function evaluateChapter(chapter: IChapter): string[] {
  const sentences = chapter.sentences ?? [];
  if (sentences.length === 0) return ['This chapter has no sentences yet.'];

  const issues: string[] = [];
  const target = chapter.targetSentences ?? sentences.length;
  if (sentences.length !== target) {
    issues.push(`Expected ${target} sentences but found ${sentences.length}.`);
  }

  const seen = new Map<string, number>();
  sentences.forEach((sentence, index) => {
    const lang1 = sentence.lang1.trim();
    const lang2 = sentence.lang2.trim();
    const key = `${lang1.toLowerCase()}||${lang2.toLowerCase()}`;
    const previous = seen.get(key);
    if (previous !== undefined) {
      issues.push(`Sentence ${index + 1} repeats sentence ${previous + 1}.`);
    } else {
      seen.set(key, index);
    }

    if (lang1.toLowerCase() === lang2.toLowerCase()) {
      issues.push(`Sentence ${index + 1} is identical in both languages.`);
      return;
    }

    if (lang1.length > 0 && lang2.length > 0) {
      const longest = Math.max(lang1.length, lang2.length);
      const shortest = Math.min(lang1.length, lang2.length);
      if (longest > shortest * 4) {
        issues.push(`Sentence ${index + 1} looks like a partial translation (length mismatch).`);
      }
    }
  });

  return issues.slice(0, MAX_ISSUES);
}

/** Stage 3 — optional quality pass the author opts into after the chapters exist. */
export async function startValidation(
  storyId: string,
  mode: ValidationModeArg,
  model?: string,
  effort?: ReasoningEffort | ''
): Promise<StagedStartResult> {
  const started = await beginJob(storyId, {
    validationMode: mode,
    jobProgress: { stage: 'validation', done: 0, total: 0, currentLabel: 'Preparing' },
  });
  if (!started.ok) return started;

  const abort = async (code: StagedStartFailure): Promise<StagedStartResult> => {
    await finishJob(storyId);
    return { ok: false, code };
  };

  const story = started.story;
  if (story.generationMode !== 'staged') return abort('WRONG_STAGE');
  if (story.chapters.length === 0) return abort('NO_CHAPTERS');

  const total = story.chapters.length;
  await Story.updateOne({ _id: storyId }, {
    $set: {
      stage: 'validation',
      jobProgress: { stage: 'validation', done: 0, total, currentLabel: `Chapter 1 of ${total}` },
    },
  });

  setImmediate(() => {
    void runValidation(storyId, mode, model, effort);
  });

  return { ok: true, storyId };
}

/** Author declined the validation stage: mark the story ready without any AI call. */
export async function skipValidation(storyId: string): Promise<boolean> {
  const result = await Story.updateOne(
    { _id: storyId, generating: { $ne: true } },
    {
      $set: {
        stage: 'ready',
        validationMode: '',
        jobProgress: { stage: 'validation', done: 0, total: 0, currentLabel: '' },
      },
    }
  );
  return result.matchedCount > 0;
}

async function runValidation(
  storyId: string,
  mode: ValidationModeArg,
  model?: string,
  effort?: ReasoningEffort | ''
): Promise<void> {
  const storyLog = log.child({ storyId, stage: 'validation' });
  try {
    const story = await Story.findById(storyId);
    if (!story) {
      storyLog.warn('Story disappeared during validation');
      return;
    }

    const total = story.chapters.length;
    const synopsis = synopsisOf(story);
    const generationModel = model ?? story.aiModel ?? DEFAULT_AI_MODEL;
    const generationEffort = effort ?? normalizeEffort(story.aiReasoningEffort);
    let calls = 0;

    for (let index = 0; index < total; index += 1) {
      const chapter = story.chapters[index];
      const sentences = (chapter.sentences ?? []).map((sentence) => ({
        lang1: sentence.lang1,
        lang2: sentence.lang2,
      }));

      let issues = evaluateChapter(chapter);

      if (mode === 'ai_review' && sentences.length > 0) {
        try {
          const review = await aiService.reviewChapter({
            sentences,
            synopsis,
            chapterTitle: chapter.title?.lang2 || chapter.title?.lang1 || '',
            nativeLanguage: story.nativeLanguage,
            learningLanguage: story.learningLanguage,
            level: story.level,
            model: generationModel,
            effort: generationEffort,
          });
          calls += 1;
          issues = sanitizeIssues([...issues, ...review.issues]);
        } catch (reviewError) {
          storyLog.warn(
            { err: reviewError, chapterIndex: index },
            'AI review failed for chapter — keeping deterministic checks'
          );
        }
      }

      const set: Record<string, unknown> = {
        [`chapters.${index}.issues`]: issues,
        jobProgress: {
          stage: 'validation',
          done: index + 1,
          total,
          currentLabel: index + 1 < total ? `Chapter ${index + 2} of ${total}` : 'Finishing',
        },
        generatingSince: new Date(),
      };
      await Story.updateOne({ _id: storyId }, { $set: set });
    }

    await finishJob(storyId, {
      set: {
        stage: 'ready',
        jobProgress: { stage: 'validation', done: total, total, currentLabel: '' },
      } as mongoose.UpdateQuery<IStory>['$set'],
      inc: calls > 0 ? { aiCallCount: calls } : undefined,
    });
  } catch (error) {
    await failJob(storyId, error);
  }
}
