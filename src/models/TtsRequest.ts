import mongoose, { Schema, Document, Types } from 'mongoose';

/** Which half of a bilingual story a request covers. */
export type TtsLanguage = 'lang1' | 'lang2';

/**
 * Queue states. Step 1 only ever uses `queued`; the remaining values exist so the
 * worker (and later stages) can transition without a schema migration.
 */
export type TtsRequestStatus = 'queued' | 'processing' | 'done' | 'failed';

export const TTS_LANGUAGES: TtsLanguage[] = ['lang1', 'lang2'];
export const TTS_REQUEST_STATUSES: TtsRequestStatus[] = [
  'queued',
  'processing',
  'done',
  'failed',
];

/**
 * One document per (story, language). The collection doubles as the job queue that
 * the Python TTS worker reads from — there is no external broker.
 */
export interface ITtsRequest extends Document {
  storyId: Types.ObjectId;
  lang: TtsLanguage;
  status: TtsRequestStatus;
  requestedBy: Types.ObjectId;
  /** Reserved for the worker; unused in step 1. */
  attempts: number;
  /** Last failure message; empty while queued. */
  error: string;
  requestedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

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
