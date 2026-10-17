/**
 * Explicit allow-list serializers for the public API.
 *
 * The legacy `/api/stories` endpoints return raw Mongoose documents, which
 * includes authoring-only fields (`seed`, `aiGuideline`, `characters`,
 * `authorId`, `generating`, `aiCallCount`, `__v`). Public responses must never
 * do that, so every field below is opted in explicitly.
 */

export interface StoryLike {
  _id: unknown;
  title?: { lang1?: string; lang2?: string };
  chapters?: Array<{
    title?: { lang1?: string; lang2?: string };
    sentences?: Array<{ lang1?: string; lang2?: string }>;
  }>;
  sentenceCount?: number;
  nativeLanguage?: string;
  learningLanguage?: string;
  level?: string;
  topic?: string;
  authorName?: string;
  isAIGenerated?: boolean;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface PublicSentence {
  lang1: string;
  lang2: string;
}

export interface PublicChapter {
  title: { lang1: string; lang2: string };
  sentences: PublicSentence[];
}

export interface PublicStoryBase {
  id: string;
  title: { lang1: string; lang2: string };
  sentenceCount: number;
  nativeLanguage: string;
  learningLanguage: string;
  level: string;
  topic: string;
  authorName: string;
  isAIGenerated: boolean;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface PublicStorySummary extends PublicStoryBase {
  chapterCount: number;
}

export interface PublicStoryDetail extends PublicStoryBase {
  chapters: PublicChapter[];
}

function baseFields(story: StoryLike): PublicStoryBase {
  return {
    id: String(story._id),
    title: {
      lang1: story.title?.lang1 ?? '',
      lang2: story.title?.lang2 ?? '',
    },
    sentenceCount: story.sentenceCount ?? 0,
    nativeLanguage: story.nativeLanguage ?? '',
    learningLanguage: story.learningLanguage ?? '',
    level: story.level ?? '',
    topic: story.topic ?? '',
    authorName: story.authorName ?? '',
    isAIGenerated: story.isAIGenerated === true,
    createdAt: story.createdAt,
    updatedAt: story.updatedAt,
  };
}

export function toPublicStorySummary(story: StoryLike): PublicStorySummary {
  return {
    ...baseFields(story),
    chapterCount: Array.isArray(story.chapters) ? story.chapters.length : 0,
  };
}

export function toPublicStoryDetail(story: StoryLike): PublicStoryDetail {
  return {
    ...baseFields(story),
    chapters: (story.chapters ?? []).map((chapter) => ({
      title: {
        lang1: chapter.title?.lang1 ?? '',
        lang2: chapter.title?.lang2 ?? '',
      },
      sentences: (chapter.sentences ?? []).map((sentence) => ({
        lang1: sentence.lang1 ?? '',
        lang2: sentence.lang2 ?? '',
      })),
    })),
  };
}
