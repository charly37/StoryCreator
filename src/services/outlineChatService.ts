import { createLogger } from '../config/logger';
import Story from '../models/Story';
import type { ReasoningEffort } from '../shared/aiModels';
import {
  aiService,
  type CharacterSpec,
  type OutlineChatMessage,
  type OutlineChatReply,
  type OutlineChapterSpec,
} from './aiService';
import {
  clampInt,
  DEFAULT_SENTENCES_PER_CHAPTER,
  MAX_OUTLINE_CHAT_BRIEF_LENGTH,
  MAX_TARGET_SENTENCES,
} from './storyInput';

const log = createLogger('outlineChat');

export type OutlineChatMode = 'chat' | 'review';

/** Subset of a staged story the planning chat needs (satisfied by the Mongoose doc). */
interface ChatStoryShape {
  _id: unknown;
  seed: string;
  nativeLanguage: string;
  learningLanguage: string;
  level: string;
  aiGuideline?: string;
  outline?: { synopsis?: { lang1?: string; lang2?: string } };
  characters: CharacterSpec[];
  chapters: Array<{
    title?: { lang1?: string; lang2?: string } | null;
    seed?: string;
    targetSentences?: number;
  }>;
}

export interface OutlineChatInput {
  messages: OutlineChatMessage[];
  mode: OutlineChatMode;
  /** UI language code (e.g. `en`/`fr`) used for the assistant reply. */
  replyLanguage: string;
  model?: string;
  effort?: ReasoningEffort | '';
}

/**
 * One synchronous planning-chat turn. Deliberately not a background job: it must
 * not flip `generating`, so the author can discuss while the plan is idle and the
 * existing outline job keeps its single-flight guard.
 */
export async function replyToOutlineChat(
  story: ChatStoryShape,
  input: OutlineChatInput
): Promise<OutlineChatReply> {
  const chapterSpecs: OutlineChapterSpec[] = story.chapters.map((chapter) => ({
    title: {
      lang1: chapter.title?.lang1?.trim() ?? '',
      lang2: chapter.title?.lang2?.trim() ?? '',
    },
    seed: chapter.seed?.trim() ?? '',
    targetSentences: clampInt(
      chapter.targetSentences,
      1,
      MAX_TARGET_SENTENCES,
      DEFAULT_SENTENCES_PER_CHAPTER
    ),
  }));

  const result = await aiService.chatAboutOutline({
    seed: story.seed,
    nativeLanguage: story.nativeLanguage,
    learningLanguage: story.learningLanguage,
    level: story.level,
    aiGuideline: story.aiGuideline,
    synopsis: {
      lang1: story.outline?.synopsis?.lang1 ?? '',
      lang2: story.outline?.synopsis?.lang2 ?? '',
    },
    characters: story.characters,
    chapterSpecs,
    messages: input.messages,
    mode: input.mode,
    replyLanguage: input.replyLanguage,
    model: input.model,
    effort: input.effort,
  });

  const brief = result.brief.slice(0, MAX_OUTLINE_CHAT_BRIEF_LENGTH);

  // `aiCallCount` is display-only (no quota), but keeps the wizard counters honest.
  await Story.updateOne({ _id: String(story._id) }, { $inc: { aiCallCount: 1 } });

  log.info(
    {
      storyId: String(story._id),
      mode: input.mode,
      messageCount: input.messages.length,
      replyChars: result.reply.length,
      briefChars: brief.length,
    },
    'Outline chat reply'
  );

  return { reply: result.reply, brief };
}
