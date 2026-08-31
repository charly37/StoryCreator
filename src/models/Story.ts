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
  authorId: mongoose.Types.ObjectId;
  authorName: string;
  published: boolean;
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
      lang2: { type: String, required: true },
    },
    sentences: { type: [sentenceSchema], default: [] },
    sentenceCount: { type: Number, default: 0 },
    nativeLanguage: { type: String, required: true },
    learningLanguage: { type: String, required: true },
    level: { type: String, enum: ['beginner', 'intermediate', 'advanced'], required: true },
    topic: { type: String, default: '' },
    authorId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    authorName: { type: String, required: true },
    published: { type: Boolean, default: false },
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
