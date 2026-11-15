import mongoose, { Schema, Document, Types } from 'mongoose';

/** One of the three deliverables assembled from the per-sentence clips. */
export type TtsVariant = 'lang1' | 'lang2' | 'bilingual';

export const TTS_VARIANTS: TtsVariant[] = ['lang1', 'lang2', 'bilingual'];

/**
 * A rendered audio file. Renders are derived artifacts: they can be deleted and rebuilt
 * from the clips at any time, and a new story hash produces a new row rather than
 * overwriting the previous one (so "latest wins" reads naturally supersede stale audio).
 */
export interface ITtsRender extends Document {
  storyId: Types.ObjectId;
  /** Version of the story text this render was built from. */
  storyHash: string;
  variant: TtsVariant;
  /** Path relative to `AUDIO_PATH`. */
  key: string;
  durationMs: number;
  sizeBytes: number;
  createdAt: Date;
  updatedAt: Date;
}

const ttsRenderSchema = new Schema<ITtsRender>(
  {
    storyId: {
      type: Schema.Types.ObjectId,
      ref: 'Story',
      required: true,
      index: true,
    },
    storyHash: {
      type: String,
      required: true,
    },
    variant: {
      type: String,
      enum: TTS_VARIANTS,
      required: true,
    },
    key: {
      type: String,
      required: true,
    },
    durationMs: {
      type: Number,
      default: 0,
    },
    sizeBytes: {
      type: Number,
      default: 0,
    },
  },
  { timestamps: true }
);

// One render per story version and variant; the worker upserts on this key.
ttsRenderSchema.index({ storyId: 1, storyHash: 1, variant: 1 }, { unique: true });

const TtsRender = mongoose.model<ITtsRender>('TtsRender', ttsRenderSchema);
export default TtsRender;
