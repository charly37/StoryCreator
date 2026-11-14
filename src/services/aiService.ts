import OpenAI from 'openai';
import { createLogger } from '../config/logger';
import { DEFAULT_AI_MODEL, resolveSelection, type ReasoningEffort } from '../shared/aiModels';

const log = createLogger('aiService');

export interface GeneratedSentence {
  lang1: string;
  lang2: string;
}

export interface ChapterSpec {
  seed: string;
  targetSentences: number;
}

export interface CharacterSpec {
  name: string;
  role: string;
  description: string;
  appearance: string;
}

export interface GeneratedChapter {
  title: { lang1: string; lang2: string };
  seed: string;
  sentences: GeneratedSentence[];
}

export interface GeneratedStory {
  title: { lang1: string; lang2: string };
  characters: CharacterSpec[];
  chapters: GeneratedChapter[];
}

export interface StoryTitleSpec {
  lang1?: string;
  lang2?: string;
}

export interface RegeneratedChapter {
  index: number;
  title: { lang1: string; lang2: string };
  seed: string;
  sentences: GeneratedSentence[];
}

/** A chapter as planned by the outline stage (no sentences yet). */
export interface OutlineChapterSpec {
  title: { lang1: string; lang2: string };
  seed: string;
  targetSentences: number;
}

/** Stage 1 output: the high-level story the author approves before any prose exists. */
export interface StoryOutline {
  title: { lang1: string; lang2: string };
  synopsis: { lang1: string; lang2: string };
  characters: CharacterSpec[];
  chapters: OutlineChapterSpec[];
}

export interface GenerateOutlineOptions {
  seed: string;
  nativeLanguage: string;
  learningLanguage: string;
  level: string;
  characters: CharacterSpec[];
  chapterSpecs: OutlineChapterSpec[];
  model?: string;
  /** Explicit thinking level; omitted means the provider default. */
  effort?: ReasoningEffort | '';
  aiGuideline?: string;
  storyTitle?: StoryTitleSpec;
  /** Previous outline + free-text feedback switch the call into 'adjust' mode. */
  previousOutline?: StoryOutline | null;
  feedback?: string;
}

export interface GenerateChapterOptions {
  storySeed: string;
  synopsis: { lang1: string; lang2: string };
  chapterSpec: OutlineChapterSpec;
  chapterIndex: number;
  /** One-line recaps of the chapters already written (index aligned, blanks allowed). */
  previousRecaps: string[];
  characters: CharacterSpec[];
  nativeLanguage: string;
  learningLanguage: string;
  level: string;
  model?: string;
  /** Explicit thinking level; omitted means the provider default. */
  effort?: ReasoningEffort | '';
  aiGuideline?: string;
}

export interface ChapterDraft {
  title: { lang1: string; lang2: string };
  seed: string;
  sentences: GeneratedSentence[];
  /** One-sentence English summary used as rolling context for the next chapter. */
  recap: string;
}

export interface ReviewChapterOptions {
  sentences: GeneratedSentence[];
  synopsis: { lang1: string; lang2: string };
  chapterTitle: string;
  nativeLanguage: string;
  learningLanguage: string;
  level: string;
  model?: string;
  /** Explicit thinking level; omitted means the provider default. */
  effort?: ReasoningEffort | '';
}

export interface ChapterReview {
  issues: string[];
}

export interface IAIService {
  generateStory(
    seed: string,
    nativeLanguage: string,
    learningLanguage: string,
    chapterSpecs: ChapterSpec[],
    characters: CharacterSpec[],
    level: string,
    model?: string,
    aiGuideline?: string,
    storyTitle?: StoryTitleSpec,
    effort?: ReasoningEffort | ''
  ): Promise<GeneratedStory>;
  regenerateChapter(
    chapterIndex: number,
    newSeed: string,
    generalFeedback: string,
    storySeed: string,
    allChapters: Array<{ seed: string; sentences: GeneratedSentence[] }>,
    nativeLanguage: string,
    learningLanguage: string,
    level: string,
    targetSentences: number,
    characters: CharacterSpec[],
    model?: string,
    aiGuideline?: string,
    effort?: ReasoningEffort | ''
  ): Promise<RegeneratedChapter[]>;

  // --- staged generation (opt-in; the one-shot path above is unchanged) ---
  generateOutline(options: GenerateOutlineOptions): Promise<StoryOutline>;
  generateChapter(options: GenerateChapterOptions): Promise<ChapterDraft>;
  reviewChapter(options: ReviewChapterOptions): Promise<ChapterReview>;
}

const LANGUAGE_NAMES: Record<string, string> = {
  ar: 'Arabic', zh: 'Chinese', nl: 'Dutch', en: 'English', fr: 'French',
  de: 'German', hi: 'Hindi', it: 'Italian', ja: 'Japanese', ko: 'Korean',
  pl: 'Polish', pt: 'Portuguese', ru: 'Russian', es: 'Spanish', sv: 'Swedish',
  tr: 'Turkish', uk: 'Ukrainian',
};

const LEVEL_GUIDANCE: Record<string, string> = {
  beginner: 'Use very simple vocabulary, short sentences (max 8 words each), simple present and past tense only, and common everyday objects and actions.',
  intermediate: 'Use moderate vocabulary, varied sentence structures, a mix of tenses, and introduce common idioms and expressions.',
  advanced: 'Use rich vocabulary, complex sentence structures, native-like expressions, abstract concepts, and idiomatic language.',
};

/** Renders a character list as prompt lines (empty string when no named characters). */
function characterLines(characters: CharacterSpec[]): string {
  return characters
    .filter((c) => c.name?.trim())
    .map((c) => {
      const role = c.role?.trim() ? ` (${c.role.trim()})` : '';
      const description = c.description?.trim() ? `: ${c.description.trim()}` : '';
      const appearance = c.appearance?.trim() ? ` Appearance: ${c.appearance.trim()}` : '';
      return `- ${c.name.trim()}${role}${description}${appearance}`;
    })
    .join('\n');
}

/**
 * Coerces raw AI sentence objects into clean parallel-text pairs.
 * Entries missing either language are dropped rather than padded with empty
 * strings — Mongoose rejects '' for the required `lang1`/`lang2` paths.
 */
export function sanitizeSentences(raw: unknown, limit?: number): GeneratedSentence[] {
  if (!Array.isArray(raw)) return [];
  const capped = typeof limit === 'number' && limit >= 0 ? raw.slice(0, limit) : raw;
  return capped
    .map((entry) => {
      const pair = (entry ?? {}) as { lang1?: unknown; lang2?: unknown };
      return {
        lang1: typeof pair.lang1 === 'string' ? pair.lang1.trim() : '',
        lang2: typeof pair.lang2 === 'string' ? pair.lang2.trim() : '',
      };
    })
    .filter((s) => s.lang1 !== '' && s.lang2 !== '');
}

/**
 * Coerces a raw AI bilingual title object into trimmed strings.
 * Always returns both keys so callers can safely persist the shape.
 */
export function sanitizeTitle(raw: unknown): { lang1: string; lang2: string } {
  const title = (raw ?? {}) as { lang1?: unknown; lang2?: unknown };
  return {
    lang1: typeof title.lang1 === 'string' ? title.lang1.trim() : '',
    lang2: typeof title.lang2 === 'string' ? title.lang2.trim() : '',
  };
}

/** Per-call timeout for staged generation (one chapter should never hang a job). */
const AI_CALL_TIMEOUT_MS = (() => {
  const parsed = Number.parseInt(process.env.AI_CALL_TIMEOUT_MS ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 180_000;
})();

/**
 * One-shot generation writes a whole story in a single call, so deep thinking
 * levels need far more headroom than a single chapter.
 */
const AI_LONG_CALL_TIMEOUT_MS = (() => {
  const parsed = Number.parseInt(process.env.AI_LONG_CALL_TIMEOUT_MS ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 600_000;
})();

/**
 * Output budget used when a reasoning effort is sent. Reasoning tokens are drawn
 * from the same allowance as the visible answer, so this must not be tight.
 * Ignored for classic models (they keep the provider default).
 */
const AI_MAX_COMPLETION_TOKENS = (() => {
  const parsed = Number.parseInt(process.env.AI_MAX_COMPLETION_TOKENS ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 32_000;
})();

function languageName(code: string): string {
  return LANGUAGE_NAMES[code] ?? code;
}

function levelGuidanceFor(level: string): string {
  return LEVEL_GUIDANCE[level] ?? LEVEL_GUIDANCE.intermediate;
}

function guidelineBlockFor(aiGuideline?: string): string {
  const sanitized = (aiGuideline ?? '').trim().slice(0, 2000);
  if (!sanitized) return '';
  return `\nAdditional writing guideline from the author:\n${sanitized}\nFollow this guideline consistently unless it conflicts with language accuracy or safety.`;
}

/**
 * Authoring notes preview roughly 10% of the prose they describe, so the author
 * can judge the plan before paying for generation. Sentence counts are clamped
 * to keep previews useful for both tiny and very long stories.
 */
const SEED_LENGTH_RATIO = 0.1;
const SYNOPSIS_SENTENCES_MIN = 3;
const SYNOPSIS_SENTENCES_MAX = 10;
const CHAPTER_SEED_SENTENCES_MIN = 2;
const CHAPTER_SEED_SENTENCES_MAX = 6;

function clampInt(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Target sentence count for the whole-story synopsis (~10% of all sentence pairs). */
function synopsisSentenceRange(totalSentences: number): { target: number; min: number; max: number } {
  return {
    target: clampInt(
      Math.round(totalSentences * SEED_LENGTH_RATIO),
      SYNOPSIS_SENTENCES_MIN,
      SYNOPSIS_SENTENCES_MAX
    ),
    min: SYNOPSIS_SENTENCES_MIN,
    max: SYNOPSIS_SENTENCES_MAX,
  };
}

/** Target sentence count for one chapter seed (~10% of that chapter, never longer than the chapter). */
function chapterSeedSentenceRange(targetSentences: number): { target: number; min: number; max: number } {
  const chapterSentences = Math.max(1, targetSentences);
  const min = Math.min(CHAPTER_SEED_SENTENCES_MIN, chapterSentences);
  const max = Math.min(CHAPTER_SEED_SENTENCES_MAX, chapterSentences);
  return {
    target: clampInt(Math.round(chapterSentences * SEED_LENGTH_RATIO), min, max),
    min,
    max,
  };
}

/** Prompt phrase for the synopsis length, e.g. "4 sentences (min 3, max 10; about 10% …)". */
function synopsisLengthHint(totalSentences: number): string {
  const { target, min, max } = synopsisSentenceRange(totalSentences);
  return `${target} sentences (min ${min}, max ${max}; about 10% of the story's ${totalSentences} sentence pairs)`;
}

/** Prompt phrase for a chapter seed length. */
function chapterSeedLengthHint(targetSentences: number): string {
  const { target, min, max } = chapterSeedSentenceRange(targetSentences);
  return `${target} sentences (min ${min}, max ${max}; about 10% of the chapter's ${Math.max(1, targetSentences)} sentence pairs)`;
}

/**
 * Generic version for prompts that cover several chapters with different targets:
 * the chapter list below already states each chapter's sentence count.
 */
function chapterSeedLengthRule(): string {
  return `about 10% of that chapter's sentence count (typically ${CHAPTER_SEED_SENTENCES_MIN}–${CHAPTER_SEED_SENTENCES_MAX} sentences, and never more sentences than the chapter itself)`;
}

/** Coerces the AI character array into a clean cast (drops nameless entries). */
function sanitizeCharactersFromRaw(raw: unknown): CharacterSpec[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((entry): entry is Record<string, unknown> => !!entry && typeof entry === 'object')
    .map((entry) => ({
      name: typeof entry.name === 'string' ? entry.name.trim() : '',
      role: typeof entry.role === 'string' ? entry.role.trim() : '',
      description: typeof entry.description === 'string' ? entry.description.trim() : '',
      appearance: typeof entry.appearance === 'string' ? entry.appearance.trim() : '',
    }))
    .filter((entry) => entry.name !== '')
    .slice(0, 20);
}

class OpenAIService implements IAIService {
  private _client: OpenAI | null = null;

  private get client(): OpenAI {
    if (!this._client) {
      this._client = new OpenAI({ apiKey: process.env.OPEN_AI_KEY });
    }
    return this._client;
  }

  async generateStory(
    seed: string,
    nativeLanguage: string,
    learningLanguage: string,
    chapterSpecs: ChapterSpec[],
    characters: CharacterSpec[],
    level: string,
    model?: string,
    aiGuideline = '',
    storyTitle?: StoryTitleSpec,
    effort?: ReasoningEffort | ''
  ): Promise<GeneratedStory> {
    const nativeName = LANGUAGE_NAMES[nativeLanguage] ?? nativeLanguage;
    const learningName = LANGUAGE_NAMES[learningLanguage] ?? learningLanguage;
    const levelGuidance = LEVEL_GUIDANCE[level] ?? LEVEL_GUIDANCE.intermediate;
    const N = chapterSpecs.length;
    const totalSentences = chapterSpecs.reduce((sum, spec) => sum + spec.targetSentences, 0);
    const averageChapterSentences = Math.max(1, Math.round(totalSentences / Math.max(N, 1)));
    const chapterSeedHint = chapterSeedLengthHint(averageChapterSentences);
    const providedTitleLang1 = storyTitle?.lang1?.trim() ?? '';
    const providedTitleLang2 = storyTitle?.lang2?.trim() ?? '';

    const sanitizedGuideline = aiGuideline.trim().slice(0, 2000);
    const guidelineBlock = sanitizedGuideline
      ? `\nAdditional writing guideline from the author:\n${sanitizedGuideline}\nFollow this guideline consistently unless it conflicts with language accuracy or safety.`
      : '';

    const systemPrompt = `You are a bilingual story writer creating parallel-text stories for language learners.
Each story presents the same sentence in two languages side by side.

Level: ${level}
${levelGuidance}
${guidelineBlock}

Return a JSON object with exactly this structure — no extra text or markdown:
{
  "title": {
    "lang1": "<story title in ${nativeName}>",
    "lang2": "<story title in ${learningName}>"
  },
  "characters": [
    {
      "name": "<character name>",
      "role": "<e.g. protagonist, mentor, rival>",
      "description": "<background, personality and motivations, in English>",
      "appearance": "<physical appearance and distinctive traits, in English>"
    }
  ],
  "chapters": [
    {
      "title": {
        "lang1": "<short chapter title in ${nativeName}>",
        "lang2": "<short chapter title in ${learningName}>"
      },
      "seed": "<what happens in this chapter, in English — internal authoring note, never shown to readers; ${chapterSeedHint} covering concrete events>",
      "sentences": [
        { "lang1": "<sentence in ${nativeName}>", "lang2": "<sentence in ${learningName}>" }
      ]
    }
  ]
}

Rules:
- Return exactly ${N} chapter objects in the "chapters" array
- Chapter i must contain exactly the sentence count listed below
- Give the story a short, reader-facing title (2–8 words) expressed in both languages
- If an author-provided title is given below, use it verbatim for lang1 and translate it faithfully for lang2
- Give every chapter a short, reader-facing title (2–6 words) expressed in both languages
- "seed" is an internal authoring note used for later regeneration — it is NOT shown to readers; write ${chapterSeedLengthRule()}, describing concrete events rather than a one-line teaser
- If a chapter has a provided seed, keep its content and only expand it when it is shorter than the length guidance above; if blank, invent a coherent one
- The story must flow naturally across all chapters
- lang1 is always ${nativeName}, lang2 is always ${learningName}
- Each sentence pair must express the same meaning in both languages
- Apply the level guidance consistently throughout
- Characters: if a cast is provided below, use exactly those characters (same names) as the cast and keep them consistent across all chapters, filling in any missing details; if no cast is provided, invent a coherent cast and return it in the "characters" array`;

    const chapterList = chapterSpecs
      .map((c, i) => `Chapter ${i + 1} (${c.targetSentences} sentences): ${c.seed || '(AI decides)'}`)
      .join('\n');

    const castList = characterLines(characters) || '(none provided — invent a coherent cast)';

    const providedTitle = providedTitleLang1
      ? `Author-provided title (lang1): "${providedTitleLang1}"${providedTitleLang2 ? ` | (lang2): "${providedTitleLang2}"` : ''}`
      : 'Author-provided title: none — invent one in both languages.';

    const userContent = `${providedTitle}\n\nStory seed: ${seed}\n\nCharacters:\n${castList}\n\nChapters:\n${chapterList}`;

    const parsed = (await this.callJson({
      selectionId: model,
      effort,
      systemPrompt,
      userContent,
      timeoutMs: AI_LONG_CALL_TIMEOUT_MS,
    })) as { title?: unknown; characters?: unknown[]; chapters?: GeneratedChapter[] };

    // New prompt returns a bilingual object; tolerate a plain string for safety.
    const title = typeof parsed.title === 'string'
      ? { lang1: parsed.title.trim(), lang2: parsed.title.trim() }
      : sanitizeTitle(parsed.title);
    const rawChapters = Array.isArray(parsed.chapters) ? parsed.chapters : [];
    const rawCharacters = Array.isArray(parsed.characters) ? parsed.characters : [];

    const generatedCharacters: CharacterSpec[] = rawCharacters
      .filter((c): c is Record<string, unknown> => !!c && typeof c === 'object')
      .map((c) => ({
        name: typeof c.name === 'string' ? c.name : '',
        role: typeof c.role === 'string' ? c.role : '',
        description: typeof c.description === 'string' ? c.description : '',
        appearance: typeof c.appearance === 'string' ? c.appearance : '',
      }))
      .filter((c) => c.name.trim() !== '');

    // Ensure N chapters; keep only valid sentence pairs (AI may under-deliver)
    const chapters: GeneratedChapter[] = chapterSpecs.map((spec, i) => {
      const rawChapter = rawChapters[i];
      const chapterSeed = typeof rawChapter?.seed === 'string' && rawChapter.seed.trim()
        ? rawChapter.seed.trim()
        : '';
      return {
        title: sanitizeTitle(rawChapter?.title),
        seed: chapterSeed,
        sentences: sanitizeSentences(rawChapter?.sentences, spec.targetSentences),
      };
    });

    return { title, characters: generatedCharacters, chapters };
  }

  async regenerateChapter(
    chapterIndex: number,
    newSeed: string,
    generalFeedback: string,
    storySeed: string,
    allChapters: Array<{ seed: string; sentences: GeneratedSentence[] }>,
    nativeLanguage: string,
    learningLanguage: string,
    level: string,
    targetSentences: number,
    characters: CharacterSpec[],
    model?: string,
    aiGuideline = '',
    effort?: ReasoningEffort | ''
  ): Promise<RegeneratedChapter[]> {
    const nativeName = LANGUAGE_NAMES[nativeLanguage] ?? nativeLanguage;
    const learningName = LANGUAGE_NAMES[learningLanguage] ?? learningLanguage;
    const levelGuidance = LEVEL_GUIDANCE[level] ?? LEVEL_GUIDANCE.intermediate;
    const chapterSeedHint = chapterSeedLengthHint(targetSentences);

    const contextSummary = allChapters
      .map((c, i) => `Chapter ${i + 1} (${i === chapterIndex ? 'TARGET — regenerate this' : 'context only'}): ${c.seed}`)
      .join('\n');

    const sanitizedGuideline = aiGuideline.trim().slice(0, 2000);
    const guidelineBlock = sanitizedGuideline
      ? `\nAdditional writing guideline from the author:\n${sanitizedGuideline}\nFollow this guideline consistently unless it conflicts with language accuracy or safety.`
      : '';

    const systemPrompt = `You are revising a specific chapter of a bilingual parallel-text story.
Level: ${level} — ${levelGuidance}
${guidelineBlock}

You are given the full story context. Rewrite the TARGET chapter using the new seed.
If the change affects story coherence in other chapters, you may also return updated versions of those chapters.

Return a JSON object with exactly this structure — no extra text:
{
  "chapters": [
    { "index": <0-based chapter index>, "title": { "lang1": "<short title in ${nativeName}>", "lang2": "<short title in ${learningName}>" }, "seed": "<updated premise in English; ${chapterSeedHint} covering concrete events>", "sentences": [{ "lang1": "...", "lang2": "..." }] }
  ]
}

Rules:
- Always include the TARGET chapter (index ${chapterIndex}) with exactly ${targetSentences} sentences
- Give the chapter a short, reader-facing title (2–6 words) in both languages
- "seed" is an internal authoring note (never shown to readers) — write ${chapterSeedHint}, covering concrete events and staying faithful to the new seed above
- Only include other chapters if coherence truly requires changes; minimize collateral edits
- lang1 is always ${nativeName}, lang2 is always ${learningName}
- Each sentence pair must express the same meaning
- Maintain the story level throughout`;

    const feedback = [
      storySeed ? `Overall story premise: ${storySeed}` : '',
      `New seed for chapter ${chapterIndex + 1}: ${newSeed}`,
      generalFeedback ? `Additional feedback: ${generalFeedback}` : '',
      characterLines(characters) ? `Keep the cast consistent with:\n${characterLines(characters)}` : '',
      `Story context:\n${contextSummary}`,
    ].filter(Boolean).join('\n\n');

    const parsed = (await this.callJson({
      selectionId: model,
      effort,
      systemPrompt,
      userContent: feedback,
      timeoutMs: AI_LONG_CALL_TIMEOUT_MS,
    })) as { chapters?: RegeneratedChapter[] };
    return Array.isArray(parsed.chapters) ? parsed.chapters : [];
  }

  // ---------------------------------------------------------------------------
  // Staged generation (opt-in). The one-shot methods above are unchanged.
  // ---------------------------------------------------------------------------

  /**
   * Single JSON-mode chat completion.
   *
   * Two request shapes are required. Classic models — and reasoning models where
   * the author left the effort unset — receive the plain payload, which keeps
   * existing behaviour byte-identical. An explicit `reasoning_effort` must be
   * sent without sampling parameters (`temperature`/`top_p`/`logprobs` are
   * rejected) and with a budget that also covers the hidden reasoning tokens.
   */
  private async callJson(args: {
    selectionId?: string | null;
    effort?: ReasoningEffort | string | null;
    systemPrompt: string;
    userContent: string;
    timeoutMs: number;
  }): Promise<unknown> {
    const { apiModel, effort } = resolveSelection(args.selectionId, args.effort);

    const base = {
      model: apiModel,
      response_format: { type: 'json_object' as const },
      messages: [
        { role: 'system' as const, content: args.systemPrompt },
        { role: 'user' as const, content: args.userContent },
      ],
    };

    const params = (
      effort
        ? { ...base, reasoning_effort: effort, max_completion_tokens: AI_MAX_COMPLETION_TOKENS }
        : base
    ) as OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming;

    const response = await this.client.chat.completions.create(params, { timeout: args.timeoutMs });
    const choice = response.choices[0];

    log.debug(
      {
        model: apiModel,
        effort: effort ?? 'provider-default',
        finishReason: choice?.finish_reason,
        reasoningTokens: response.usage?.completion_tokens_details?.reasoning_tokens,
      },
      'AI JSON completion'
    );

    if (choice?.finish_reason === 'length') {
      throw new Error(
        'The AI response was truncated before it finished. Retry with a lower thinking level.'
      );
    }

    const raw = choice?.message?.content ?? '';
    if (!raw.trim()) {
      throw new Error('The AI returned an empty response; please retry.');
    }

    try {
      return JSON.parse(raw);
    } catch {
      throw new Error('The AI returned a malformed JSON response; please retry.');
    }
  }

  /**
   * Stage 1 — plans the story: title, bilingual synopsis, cast and chapter
   * premises. Writes no prose, so it is cheap enough to iterate on.
   */
  async generateOutline(options: GenerateOutlineOptions): Promise<StoryOutline> {
    const nativeName = languageName(options.nativeLanguage);
    const learningName = languageName(options.learningLanguage);
    const N = options.chapterSpecs.length;
    const totalSentences = options.chapterSpecs.reduce((sum, spec) => sum + spec.targetSentences, 0);
    const averageChapterSentences = Math.max(1, Math.round(totalSentences / Math.max(N, 1)));
    const synopsisHint = synopsisLengthHint(totalSentences);
    const chapterSeedHint = chapterSeedLengthHint(averageChapterSentences);
    const isAdjustment = !!options.feedback?.trim() || !!options.previousOutline;

    const chapterList = options.chapterSpecs
      .map((c, i) => `Chapter ${i + 1} (${c.targetSentences} sentences): ${c.seed || '(you decide)'}`)
      .join('\n');
    const castList = characterLines(options.characters) || '(none provided — invent a coherent cast)';
    const titleLine = options.storyTitle?.lang1?.trim()
      ? `Author-provided title (lang1): "${options.storyTitle.lang1.trim()}"${
          options.storyTitle.lang2?.trim() ? ` | (lang2): "${options.storyTitle.lang2.trim()}"` : ''
        }`
      : 'Author-provided title: none — invent one in both languages.';

    const systemPrompt = `You are planning a bilingual parallel-text story for language learners.
This is the PLANNING stage: describe the story, do NOT write the story sentences yet.

Level: ${options.level}
${levelGuidanceFor(options.level)}
${guidelineBlockFor(options.aiGuideline)}

Return a JSON object with exactly this structure — no extra text or markdown:
{
  "title": { "lang1": "<story title in ${nativeName}>", "lang2": "<story title in ${learningName}>" },
  "synopsis": {
    "lang1": "<${synopsisHint} summarising the whole story arc in ${nativeName}>",
    "lang2": "<the same synopsis translated into ${learningName}; ${synopsisHint}>",
  },
  "characters": [
    { "name": "<name>", "role": "<role>", "description": "<in English>", "appearance": "<in English>" }
  ],
  "chapters": [
    {
      "title": { "lang1": "<short chapter title in ${nativeName}>", "lang2": "<short title in ${learningName}>" },
      "seed": "<what happens in this chapter, in English — ${chapterSeedHint} covering concrete events>"
    }
  ]
}

Rules:
- Return exactly ${N} chapter objects in the "chapters" array
- The synopsis summarises the WHOLE arc (beginning, turn, resolution), not a single chapter, and must be ${synopsisHint}, naming concrete events
- Chapter seeds are internal authoring notes in English; each must be ${chapterSeedLengthRule()}, describing concrete events (setting, who does what, the turn) rather than a one-line teaser
- Every chapter must advance the arc and connect to the next one
- Give the story and every chapter a short, reader-facing title (2–6 words) in both languages
- If an author-provided title is given below, use it verbatim for lang1 and translate it faithfully for lang2
- If a chapter premise is provided below, keep its content and only expand it when it is shorter than the length guidance above; if blank, invent a coherent one
- Characters: if a cast is provided below use exactly those characters (same names) and fill in missing details; if not, invent a coherent cast and return it
- lang1 is always ${nativeName}, lang2 is always ${learningName}`;

    const adjustmentBlock = isAdjustment
      ? `\n\nThis is a REVISION of the plan below. Keep everything the author did not ask to change.

Current plan:\n${JSON.stringify({
          synopsis: options.previousOutline?.synopsis ?? { lang1: '', lang2: '' },
          chapters: (options.previousOutline?.chapters ?? []).map((c) => ({
            title: c.title,
            seed: c.seed,
          })),
        })}

Author feedback:\n${options.feedback?.trim() || '(no specific feedback — improve the plan)'}`
      : '';

    const userContent = `${titleLine}\n\nStory seed:\n${options.seed}\n\nCharacters:\n${castList}\n\nChapters:\n${chapterList}${adjustmentBlock}`;

    const parsed = (await this.callJson({
      selectionId: options.model,
      effort: options.effort,
      systemPrompt,
      userContent,
      timeoutMs: AI_CALL_TIMEOUT_MS,
    })) as {
      title?: unknown;
      synopsis?: unknown;
      characters?: unknown;
      chapters?: Array<Record<string, unknown> | null>;
    };

    const rawChapters = Array.isArray(parsed.chapters) ? parsed.chapters : [];
    const chapters: OutlineChapterSpec[] = options.chapterSpecs.map((spec, i) => {
      const rawChapter = rawChapters[i] ?? {};
      const rawSeed = typeof rawChapter.seed === 'string' ? rawChapter.seed.trim() : '';
      return {
        title: sanitizeTitle(rawChapter.title),
        seed: rawSeed || spec.seed,
        // Sentence targets are author/database owned — never taken from the model.
        targetSentences: spec.targetSentences,
      };
    });

    const generatedCharacters = sanitizeCharactersFromRaw(parsed.characters);
    const title = typeof parsed.title === 'string'
      ? { lang1: parsed.title.trim(), lang2: parsed.title.trim() }
      : sanitizeTitle(parsed.title);

    return {
      title,
      synopsis: sanitizeTitle(parsed.synopsis),
      characters: generatedCharacters.length > 0 ? generatedCharacters : options.characters,
      chapters,
    };
  }

  /**
   * Stage 2 — writes one chapter, continuing from the recaps of the chapters
   * already written (bounded context: no full-text resend).
   */
  async generateChapter(options: GenerateChapterOptions): Promise<ChapterDraft> {
    const nativeName = languageName(options.nativeLanguage);
    const learningName = languageName(options.learningLanguage);
    const total = options.previousRecaps.length;
    const chapterSeedHint = chapterSeedLengthHint(options.chapterSpec.targetSentences);

    const storySoFar = options.previousRecaps
      .map((recap, i) => (recap.trim() ? `Chapter ${i + 1}: ${recap.trim()}` : ''))
      .filter(Boolean)
      .join('\n');
    const castList = characterLines(options.characters);
    const synopsisLine =
      [options.synopsis.lang1, options.synopsis.lang2].filter(Boolean).join(' / ') || '(not provided)';

    const systemPrompt = `You are writing chapter ${options.chapterIndex + 1} of ${total} of a bilingual parallel-text story.

Level: ${options.level}
${levelGuidanceFor(options.level)}
${guidelineBlockFor(options.aiGuideline)}

Return a JSON object with exactly this structure — no extra text or markdown:
{
  "title": { "lang1": "<short chapter title in ${nativeName}>", "lang2": "<short chapter title in ${learningName}>" },
  "seed": "<what happens in this chapter, in English — ${chapterSeedHint} covering concrete events>",
  "recap": "<one sentence in English summarising what happens in THIS chapter>",
  "sentences": [ { "lang1": "<sentence in ${nativeName}>", "lang2": "<sentence in ${learningName}>" } ]
}

Rules:
- Write exactly ${options.chapterSpec.targetSentences} sentence pairs
- Write ONLY this chapter — do not continue into later chapters
- Continue naturally from the story so far; keep names, facts and chronology consistent
- lang1 is always ${nativeName}, lang2 is always ${learningName}
- Each sentence pair must express the same meaning in both languages
- Apply the level guidance consistently
- "seed" and "recap" are internal authoring notes — never shown to readers; the seed must be ${chapterSeedHint}, covering concrete events and staying faithful to this chapter's premise`;

    const userContent = [
      `Story synopsis: ${synopsisLine}`,
      options.storySeed ? `Overall story premise: ${options.storySeed}` : '',
      castList ? `Cast:\n${castList}` : '',
      `This chapter's premise: ${options.chapterSpec.seed || '(you decide, consistent with the synopsis)'}`,
      storySoFar ? `Story so far:\n${storySoFar}` : 'This is the first chapter.',
    ]
      .filter(Boolean)
      .join('\n\n');

    const parsed = (await this.callJson({
      selectionId: options.model,
      effort: options.effort,
      systemPrompt,
      userContent,
      timeoutMs: AI_CALL_TIMEOUT_MS,
    })) as {
      title?: unknown;
      seed?: unknown;
      recap?: unknown;
      sentences?: unknown;
    };

    const rawSeed = typeof parsed.seed === 'string' ? parsed.seed.trim() : '';
    const recap = typeof parsed.recap === 'string' ? parsed.recap.trim().slice(0, 400) : '';

    return {
      title: sanitizeTitle(parsed.title),
      seed: rawSeed || options.chapterSpec.seed,
      sentences: sanitizeSentences(parsed.sentences, options.chapterSpec.targetSentences),
      recap,
    };
  }

  /** Stage 3 (optional) — one quality-review call per chapter, returns findings only. */
  async reviewChapter(options: ReviewChapterOptions): Promise<ChapterReview> {
    const nativeName = languageName(options.nativeLanguage);
    const learningName = languageName(options.learningLanguage);
    const numbered = options.sentences
      .map((sentence, i) => `${i + 1}. ${sentence.lang1} || ${sentence.lang2}`)
      .join('\n');

    const systemPrompt = `You are reviewing one chapter of a bilingual parallel-text story for language learners.

Level: ${options.level}
${levelGuidanceFor(options.level)}

Check ONLY these things:
- translation accuracy: lang1 (${nativeName}) and lang2 (${learningName}) must express the same meaning
- language mixing: lang1 must not contain ${learningName} words, and vice versa
- level fit: vocabulary and sentence length match the level above
- repetition: the same sentence or idea repeated
- continuity: contradictions with the story synopsis

Return a JSON object — no extra text:
{ "issues": ["<issue in English, max 20 words, cite the sentence number>"] }

Rules:
- Return an empty array when the chapter is fine
- At most 5 issues, most important first
- Do NOT rewrite the sentences; only report problems`;

    const userContent = [
      options.chapterTitle ? `Chapter: ${options.chapterTitle}` : '',
      `Story synopsis: ${[options.synopsis.lang1, options.synopsis.lang2].filter(Boolean).join(' / ') || '(not provided)'}`,
      `Sentences (lang1 || lang2):\n${numbered}`,
    ]
      .filter(Boolean)
      .join('\n\n');

    const parsed = (await this.callJson({
      selectionId: options.model,
      effort: options.effort,
      systemPrompt,
      userContent,
      timeoutMs: AI_CALL_TIMEOUT_MS,
    })) as { issues?: unknown };
    const issues = Array.isArray(parsed.issues)
      ? parsed.issues
          .map((issue) => (typeof issue === 'string' ? issue.trim() : ''))
          .filter((issue) => issue !== '')
          .slice(0, 5)
      : [];

    return { issues };
  }
}

export const aiService: IAIService = new OpenAIService();
