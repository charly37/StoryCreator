import mongoose, { Schema, Document } from 'mongoose';

export interface ISentence {
  lang1: string;
  lang2: string;
}

export interface IStory extends Document {
  title: { lang1: string; lang2: string };
  sentences: ISentence[];
  sentenceCount: number;
  nativeLanguage: string;
  learningLanguage: string;
  level: 'beginner' | 'intermediate' | 'advanced';
  topic: string;
  seed: string;
  targetPages: number;
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

const storySchema = new Schema<IStory>(
  {
    title: {
      lang1: { type: String, required: true },
      lang2: { type: String, default: '' },
    },
    sentences: { type: [sentenceSchema], default: [] },
    sentenceCount: { type: Number, default: 0 },
    nativeLanguage: { type: String, required: true },
    learningLanguage: { type: String, required: true },
    level: { type: String, enum: ['beginner', 'intermediate', 'advanced'], required: true },
    topic: { type: String, default: '' },
    seed: { type: String, default: '' },
    targetPages: { type: Number, default: 1 },
    authorId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    authorName: { type: String, required: true },
    published: { type: Boolean, default: false },
    generating: { type: Boolean, default: false },
    isAIGenerated: { type: Boolean, default: false },
    approved: { type: Boolean, default: false },
  },
  { timestamps: true }
);

// Keep sentenceCount in sync automatically
storySchema.pre('save', function () {
  this.sentenceCount = this.sentences.length;
});

storySchema.index({ nativeLanguage: 1, learningLanguage: 1, published: 1 });
storySchema.index({ authorId: 1 });

const Story = mongoose.model<IStory>('Story', storySchema);
export default Story;
