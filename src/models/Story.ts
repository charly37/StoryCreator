import mongoose, { Schema, Document } from 'mongoose';

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
  aiGuideline: string;
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
    aiModel: { type: String, default: 'gpt-4o-mini' },
    aiGuideline: { type: String, default: '' },
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
