import mongoose, { Schema, Document } from 'mongoose';
import { AI_EFFORT_VALUES, DEFAULT_AI_MODEL } from '../shared/aiModels';

export interface ISentence {
  lang1: string;
  lang2: string;
}

export interface ICharacter {
  name: string;
  role: string;
  description: string;
  appearance: string;
}

export interface IChapter {
  title: { lang1: string; lang2: string };
  seed: string;
  targetSentences: number;
  sentences: ISentence[];
  /** One-line recap of the written chapter, used as rolling context in staged generation. */
  recap?: string;
  /** Validation findings for this chapter (deterministic checks and/or AI review). */
  issues?: string[];
}

/** Position in the interactive staged-creation flow. */
export type StoryStage = 'setup' | 'outline' | 'chapters' | 'validation' | 'ready';

/** 'quick' = one-shot generation (default, used by the API); 'staged' = outline -> chapters -> validation. */
export type GenerationMode = 'quick' | 'staged';

/** '' = not chosen yet. */
export type ValidationMode = '' | 'basic' | 'ai_review';

export interface IStoryOutline {
  synopsis: { lang1: string; lang2: string };
  approvedAt?: Date;
}

export interface IJobProgress {
  stage: StoryStage | '';
  done: number;
  total: number;
  currentLabel: string;
}

export interface IStory extends Document {
  title: { lang1: string; lang2: string };
  chapters: IChapter[];
  characters: ICharacter[];
  sentenceCount: number;
  nativeLanguage: string;
  learningLanguage: string;
  level: 'beginner' | 'intermediate' | 'advanced';
  labels: string[];
  seed: string;
  targetChapters: number;
  aiModel: string;
  /** Explicit thinking level for `aiModel`; '' means the provider default. */
  aiReasoningEffort: string;
  aiGuideline: string;
  /** Model used for the outline stage (staged mode only). */
  outlineAiModel: string;
  /** Explicit thinking level for `outlineAiModel`; '' means the provider default. */
  outlineReasoningEffort: string;
  generationMode: GenerationMode;
  stage: StoryStage;
  outline: IStoryOutline;
  validationMode: ValidationMode;
  jobProgress: IJobProgress;
  /** Heartbeat for the running stage: refreshed on every partial write. */
  generatingSince?: Date;
  authorId: mongoose.Types.ObjectId;
  authorName: string;
  creationSource: 'ui' | 'api';
  createdViaApiKeyName?: string;
  createdViaApiKeyId?: mongoose.Types.ObjectId;
  published: boolean;
  generating: boolean;
  isAIGenerated: boolean;
  aiCallCount: number;
  generationError: string;
  publishWhenReady: boolean;
  idempotencyKey?: string;
  createdAt: Date;
  updatedAt: Date;
}

const sentenceSchema = new Schema<ISentence>(
  { lang1: { type: String, required: true }, lang2: { type: String, required: true } },
  { _id: false }
);

const chapterSchema = new Schema<IChapter>(
  {
    title: {
      lang1: { type: String, default: '' },
      lang2: { type: String, default: '' },
    },
    seed: { type: String, default: '' },
    targetSentences: { type: Number, default: 12 },
    sentences: { type: [sentenceSchema], default: [] },
    recap: { type: String, default: '' },
    issues: { type: [String], default: [] },
  },
  { _id: false }
);

const outlineSchema = new Schema<IStoryOutline>(
  {
    synopsis: {
      lang1: { type: String, default: '' },
      lang2: { type: String, default: '' },
    },
    approvedAt: { type: Date, default: undefined },
  },
  { _id: false }
);

const jobProgressSchema = new Schema<IJobProgress>(
  {
    stage: { type: String, default: '' },
    done: { type: Number, default: 0 },
    total: { type: Number, default: 0 },
    currentLabel: { type: String, default: '' },
  },
  { _id: false }
);

const characterSchema = new Schema<ICharacter>(
  {
    name: { type: String, default: '' },
    role: { type: String, default: '' },
    description: { type: String, default: '' },
    appearance: { type: String, default: '' },
  },
  { _id: false }
);

const storySchema = new Schema<IStory>(
  {
    title: {
      // Optional: when blank, AI generation fills in both languages.
      lang1: { type: String, default: '' },
      lang2: { type: String, default: '' },
    },
    chapters: { type: [chapterSchema], default: [] },
    characters: { type: [characterSchema], default: [] },
    sentenceCount: { type: Number, default: 0 },
    nativeLanguage: { type: String, required: true },
    learningLanguage: { type: String, required: true },
    level: { type: String, enum: ['beginner', 'intermediate', 'advanced'], required: true },
    labels: { type: [String], default: [] },
    seed: { type: String, default: '' },
    targetChapters: { type: Number, default: 1 },
    aiModel: { type: String, default: DEFAULT_AI_MODEL },
    aiReasoningEffort: { type: String, enum: AI_EFFORT_VALUES, default: '' },
    aiGuideline: { type: String, default: '' },
    outlineAiModel: { type: String, default: DEFAULT_AI_MODEL },
    outlineReasoningEffort: { type: String, enum: AI_EFFORT_VALUES, default: '' },
    generationMode: { type: String, enum: ['quick', 'staged'], default: 'quick' },
    stage: {
      type: String,
      enum: ['setup', 'outline', 'chapters', 'validation', 'ready'],
      default: 'setup',
    },
    outline: { type: outlineSchema, default: () => ({}) },
    validationMode: { type: String, enum: ['', 'basic', 'ai_review'], default: '' },
    jobProgress: { type: jobProgressSchema, default: () => ({}) },
    generatingSince: { type: Date, default: undefined },
    authorId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    authorName: { type: String, required: true },
    creationSource: { type: String, enum: ['ui', 'api'], default: 'ui' },
    createdViaApiKeyName: { type: String, default: '' },
    createdViaApiKeyId: { type: Schema.Types.ObjectId, ref: 'ApiKey', default: undefined },
    published: { type: Boolean, default: false },
    generating: { type: Boolean, default: false },
    isAIGenerated: { type: Boolean, default: false },
    aiCallCount: { type: Number, default: 0 },
    generationError: { type: String, default: '' },
    publishWhenReady: { type: Boolean, default: false },
    idempotencyKey: { type: String, default: undefined },
  },
  { timestamps: true }
);

// Must run in `pre('validate')`: Mongoose validates before `pre('save')` hooks,
// so filtering there would be too late to prevent a validation error.
storySchema.pre('validate', function () {
  // Drop sentence pairs missing either language — empty strings fail the
  // `required` validators on `lang1`/`lang2` and would abort the whole save.
  for (const chapter of this.chapters) {
    chapter.sentences = chapter.sentences.filter(
      (s) =>
        typeof s.lang1 === 'string' && s.lang1.trim() !== '' &&
        typeof s.lang2 === 'string' && s.lang2.trim() !== ''
    );
  }
});

storySchema.pre('save', function () {
  this.sentenceCount = this.chapters.reduce((sum, c) => sum + c.sentences.length, 0);
});

storySchema.index({ nativeLanguage: 1, learningLanguage: 1, published: 1 });
storySchema.index({ authorId: 1 });
storySchema.index(
  { authorId: 1, idempotencyKey: 1 },
  { unique: true, partialFilterExpression: { idempotencyKey: { $exists: true } } }
);

const Story = mongoose.model<IStory>('Story', storySchema);
export default Story;
