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
  labels?: string[];
  topic?: string;
  authorName?: string;
  creationSource?: string;
  createdViaApiKeyName?: string;
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
  labels: string[];
  authorName: string;
  publisherDisplayName: string;
  creationSource: 'ui' | 'api';
  createdViaApiKeyName?: string;
  isAIGenerated: boolean;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface PublicStorySummary extends PublicStoryBase {
  chapterCount: number;
}

export interface PublicStoryStatus {
  state: 'generating' | 'ready' | 'failed';
  published: boolean;
  generationError: string;
}

export interface PublicStoryDetail extends PublicStoryBase {
  chapters: PublicChapter[];
  /** Present only when a write-scoped key reads its own story. */
  status?: PublicStoryStatus;
}

export interface OwnerStatusInput {
  published?: boolean;
  generating?: boolean;
  generationError?: string;
}

function baseFields(story: StoryLike): PublicStoryBase {
  const labels = Array.isArray(story.labels)
    ? story.labels.filter((label): label is string => typeof label === 'string')
    : typeof story.topic === 'string' && story.topic.trim() !== ''
      ? [story.topic.trim()]
      : [];
  const authorName = story.authorName ?? '';
  const creationSource = story.creationSource === 'api' ? 'api' : 'ui';
  const createdViaApiKeyName = typeof story.createdViaApiKeyName === 'string'
    ? story.createdViaApiKeyName.trim()
    : '';
  const publisherDisplayName = creationSource === 'api' && createdViaApiKeyName
    ? `${authorName}(${createdViaApiKeyName})`
    : authorName;

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
    labels,
    authorName,
    publisherDisplayName,
    creationSource,
    ...(createdViaApiKeyName ? { createdViaApiKeyName } : {}),
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

export function toPublicStoryDetail(story: StoryLike, ownerStatus?: OwnerStatusInput): PublicStoryDetail {
  const detail: PublicStoryDetail = {
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

  if (ownerStatus) {
    detail.status = {
      state: ownerStatus.generating ? 'generating' : ownerStatus.generationError ? 'failed' : 'ready',
      published: ownerStatus.published === true,
      generationError: ownerStatus.generationError ?? '',
    };
  }

  return detail;
}
