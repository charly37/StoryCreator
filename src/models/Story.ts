import mongoose, { Schema, Document } from 'mongoose';

export interface ISentence {
  lang1: string;
  lang2: string;
}

export interface IChapter {
  seed: string;
  targetSentences: number;
  sentences: ISentence[];
}

export interface IStory extends Document {
  title: { lang1: string; lang2: string };
  chapters: IChapter[];
  sentenceCount: number;
  nativeLanguage: string;
  learningLanguage: string;
  level: 'beginner' | 'intermediate' | 'advanced';
  topic: string;
  seed: string;
  targetChapters: number;
  authorId: mongoose.Types.ObjectId;
  authorName: string;
  published: boolean;
  generating: boolean;
  isAIGenerated: boolean;
  approved: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const sentenceSchema = new Schema<ISentence>(
  { lang1: { type: String, required: true }, lang2: { type: String, required: true } },
  { _id: false }
);

const chapterSchema = new Schema<IChapter>(
  {
    seed: { type: String, default: '' },
    targetSentences: { type: Number, default: 12 },
    sentences: { type: [sentenceSchema], default: [] },
  },
  { _id: false }
);

const storySchema = new Schema<IStory>(
  {
    title: {
      lang1: { type: String, required: true },
      lang2: { type: String, default: '' },
    },
    chapters: { type: [chapterSchema], default: [] },
    sentenceCount: { type: Number, default: 0 },
    nativeLanguage: { type: String, required: true },
    learningLanguage: { type: String, required: true },
    level: { type: String, enum: ['beginner', 'intermediate', 'advanced'], required: true },
    topic: { type: String, default: '' },
    seed: { type: String, default: '' },
    targetChapters: { type: Number, default: 1 },
    authorId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    authorName: { type: String, required: true },
    published: { type: Boolean, default: false },
    generating: { type: Boolean, default: false },
    isAIGenerated: { type: Boolean, default: false },
    approved: { type: Boolean, default: false },
  },
  { timestamps: true }
);

storySchema.pre('save', function () {
  this.sentenceCount = this.chapters.reduce((sum, c) => sum + c.sentences.length, 0);
});

storySchema.index({ nativeLanguage: 1, learningLanguage: 1, published: 1 });
storySchema.index({ authorId: 1 });

const Story = mongoose.model<IStory>('Story', storySchema);
export default Story;
