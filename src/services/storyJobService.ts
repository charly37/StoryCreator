/**
 * Shared plumbing for the staged story-generation jobs.
 *
 * Every stage (outline / chapters / validation) follows the same pattern:
 *   beginJob()  -> single-flight guard + heartbeat start
 *   ...writes... -> targeted `updateOne` (never a full `save()` on a stale doc)
 *   finishJob() / failJob()
 *
 * `sweepStalledJob()` releases a staged job whose heartbeat went quiet, so a
 * crashed/restarted process cannot leave a story stuck in `generating`.
 */
import mongoose from 'mongoose';
import Story, { GenerationMode, IStory, StoryStage } from '../models/Story';
import { createLogger } from '../config/logger';

const log = createLogger('storyJob');

function readStallMinutes(): number {
  const parsed = Number.parseInt(process.env.GENERATION_STALL_MINUTES ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 15;
}

/** Minutes without a heartbeat before a staged job is considered dead. */
export const STALL_MINUTES = readStallMinutes();

const STALLED_MESSAGE = `Generation stalled (no progress for ${STALL_MINUTES} min) — please retry`;

export type BeginJobFailure = 'NOT_FOUND' | 'ALREADY_GENERATING';

export type BeginJobResult =
  | { ok: true; story: IStory }
  | { ok: false; code: BeginJobFailure };

export interface JobFields {
  jobProgress: { stage: StoryStage | ''; done: number; total: number; currentLabel: string };
  validationMode: '' | 'basic' | 'ai_review';
}

/**
 * Marks the story as generating and returns it. The conditional update is the
 * single-flight guard: two concurrent requests cannot both start a paid job.
 */
export async function beginJob(storyId: string, fields: Partial<JobFields>): Promise<BeginJobResult> {
  if (!mongoose.isValidObjectId(storyId)) {
    return { ok: false, code: 'NOT_FOUND' };
  }

  const story = await Story.findOneAndUpdate(
    { _id: storyId, generating: { $ne: true } },
    { $set: { ...fields, generating: true, generatingSince: new Date(), generationError: '' } },
    { new: true }
  );
  if (!story) {
    const exists = await Story.exists({ _id: storyId });
    return { ok: false, code: exists ? 'ALREADY_GENERATING' : 'NOT_FOUND' };
  }

  return { ok: true, story };
}

/** Refreshes the heartbeat (called after every partial write of a long stage). */
export async function heartbeat(storyId: string): Promise<void> {
  await Story.updateOne({ _id: storyId }, { $set: { generatingSince: new Date() } }).catch(
    () => undefined
  );
}

/** Completes a stage: clears the running flag and persists the produced fields. */
export async function finishJob(
  storyId: string,
  update: {
    set?: mongoose.UpdateQuery<IStory>['$set'];
    unset?: Record<string, ''>;
    inc?: Record<string, number>;
  } = {}
): Promise<void> {
  await Story.updateOne({ _id: storyId }, {
    $set: { ...(update.set ?? {}), generating: false, generationError: '' },
    $unset: { generatingSince: '', ...(update.unset ?? {}) },
    ...(update.inc ? { $inc: update.inc } : {}),
  });
}

/**
 * Records a stage failure on the story. Uses `updateOne` on purpose: a
 * partially-populated in-memory document would re-throw on `save()` and could
 * crash the process.
 */
export async function failJob(storyId: string, error: unknown): Promise<void> {
  const message = error instanceof Error ? error.message : String(error);
  log.error({ err: error, storyId }, 'Staged generation stage failed');
  await Story.updateOne(
    { _id: storyId },
    {
      $set: {
        generating: false,
        generationError: message.slice(0, 500),
        publishWhenReady: false,
      },
      $unset: { generatingSince: '' },
    }
  ).catch((updateError) => {
    log.error({ err: updateError, storyId }, 'Failed to record staged generation failure');
  });
}

interface StallCandidate {
  generating: boolean;
  generationMode: GenerationMode;
  generatingSince?: Date | null;
}

/**
 * True when a *staged* job has not reported progress for `STALL_MINUTES`.
 * Quick-mode (one-shot) jobs are intentionally exempt: their behaviour must not
 * change.
 */
export function isJobStalled(story: StallCandidate, now: Date = new Date()): boolean {
  if (!story.generating || story.generationMode !== 'staged') return false;
  if (!story.generatingSince) return false;
  const last = new Date(story.generatingSince).getTime();
  if (!Number.isFinite(last)) return false;
  return now.getTime() - last > STALL_MINUTES * 60 * 1000;
}

/**
 * Releases a stalled staged job. Mutates the passed document so the caller can
 * serialise it without a second read.
 */
export async function sweepStalledJob(story: IStory): Promise<boolean> {
  if (!isJobStalled(story)) return false;

  try {
    await Story.updateOne(
      { _id: story._id, generating: true },
      {
        $set: { generating: false, generationError: STALLED_MESSAGE, publishWhenReady: false },
        $unset: { generatingSince: '' },
      }
    );
  } catch (error) {
    log.error({ err: error, storyId: String(story._id) }, 'Failed to clear stalled generation');
    return false;
  }

  story.generating = false;
  story.generationError = STALLED_MESSAGE;
  log.warn({ storyId: String(story._id) }, 'Cleared stalled staged generation');
  return true;
}

/**
 * Recomputes `sentenceCount` after targeted writes. The `pre('save')` hook that
 * normally maintains it does not run for `updateOne`.
 *
 * Mongoose 9 requires the `updatePipeline` flag before it will accept an
 * aggregation-pipeline update (otherwise it throws "Cannot pass an array to query
 * updates"). It is a derived counter, so a failure is logged rather than thrown:
 * aborting a paid multi-chapter job over it would force a full regeneration.
 */
export async function recountSentences(storyId: string): Promise<void> {
  try {
    await Story.updateOne(
      { _id: storyId },
      [
        {
          $set: {
            sentenceCount: {
              $sum: { $map: { input: '$chapters', as: 'chapter', in: { $size: '$$chapter.sentences' } } },
            },
          },
        },
      ] as unknown as mongoose.UpdateQuery<IStory>,
      { updatePipeline: true }
    );
  } catch (error) {
    log.warn({ err: error, storyId }, 'Failed to recompute sentenceCount');
  }
}
