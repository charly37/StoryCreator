import mongoose, { Schema, Document, Types } from 'mongoose';

/** Which half of a bilingual story a request covers. */
export type TtsLanguage = 'lang1' | 'lang2';

/**
 * Queue states. `queued` -> `processing` -> `done`, with `failed` as the terminal
 * error state.
 */
export type TtsRequestStatus = 'queued' | 'processing' | 'done' | 'failed';

/** Progress within a claimed request. */
export type TtsRequestPhase = 'synthesize' | 'render' | 'done';

export const TTS_LANGUAGES: TtsLanguage[] = ['lang1', 'lang2'];
export const TTS_REQUEST_STATUSES: TtsRequestStatus[] = [
  'queued',
  'processing',
  'done',
  'failed',
];

/** One synthesized sentence, content-addressed on disk by `key`. */
export interface ITtsClip {
  chapterIndex: number;
  sentenceIndex: number;
  key: string;
}

/**
 * One document per (story, language). The collection doubles as the job queue that
 * the Python TTS worker reads from — there is no external broker.
 */
export interface ITtsRequest extends Document {
  storyId: Types.ObjectId;
  lang: TtsLanguage;
  status: TtsRequestStatus;
  /** Which step of the pipeline the worker is on. */
  phase: TtsRequestPhase;
  requestedBy: Types.ObjectId;
  /** Incremented on every claim; a request fails once it reaches the worker's limit. */
  attempts: number;
  /** Last failure message; empty while queued. */
  error: string;
  /** sha256 over both language tracks — identifies one version of the story text. */
  storyHash: string;
  /** Per-sentence clip manifest, filled in during synthesis. */
  clips: ITtsClip[];
  /** Sentences synthesized so far, for progress reporting. */
  progress: { done: number; total: number };
  startedAt?: Date;
  finishedAt?: Date;
  requestedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const clipSchema = new Schema<ITtsClip>(
  {
    chapterIndex: { type: Number, required: true },
    sentenceIndex: { type: Number, required: true },
    key: { type: String, required: true },
  },
  { _id: false }
);

const ttsRequestSchema = new Schema<ITtsRequest>(
  {
    storyId: {
      type: Schema.Types.ObjectId,
      ref: 'Story',
      required: true,
      index: true,
    },
    lang: {
      type: String,
      enum: TTS_LANGUAGES,
      required: true,
    },
    status: {
      type: String,
      enum: TTS_REQUEST_STATUSES,
      default: 'queued',
      required: true,
    },
    phase: {
      type: String,
      enum: ['synthesize', 'render', 'done'],
      default: 'synthesize',
      required: true,
    },
    requestedBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    attempts: {
      type: Number,
      default: 0,
    },
    error: {
      type: String,
      default: '',
    },
    storyHash: {
      type: String,
      default: '',
    },
    clips: {
      type: [clipSchema],
      default: [],
    },
    progress: {
      done: { type: Number, default: 0 },
      total: { type: Number, default: 0 },
    },
    startedAt: {
      type: Date,
      default: undefined,
    },
    finishedAt: {
      type: Date,
      default: undefined,
    },
    requestedAt: {
      type: Date,
      default: Date.now,
    },
  },
  { timestamps: true }
);

// One request per story + language. Posting again is an upsert, which makes the
// endpoint idempotent (and doubles as "regenerate" once synthesis exists).
ttsRequestSchema.index({ storyId: 1, lang: 1 }, { unique: true });

// Worker poll query: oldest queued first.
ttsRequestSchema.index({ status: 1, requestedAt: 1 });

const TtsRequest = mongoose.model<ITtsRequest>('TtsRequest', ttsRequestSchema);
export default TtsRequest;
