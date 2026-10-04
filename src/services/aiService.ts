import OpenAI from 'openai';

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
  title: string;
  characters: CharacterSpec[];
  chapters: GeneratedChapter[];
}

export interface SentencePatch {
  chapterIndex: number;
  sentenceIndex: number;
  lang1: string;
  lang2: string;
  feedback: string;
}

export interface PatchedSentence {
  chapterIndex: number;
  sentenceIndex: number;
  lang1: string;
  lang2: string;
}

export interface RegeneratedChapter {
  index: number;
  title: { lang1: string; lang2: string };
  seed: string;
  sentences: GeneratedSentence[];
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
    aiGuideline?: string
  ): Promise<GeneratedStory>;
  patchSentences(
    patches: SentencePatch[],
    generalFeedback: string,
    nativeLanguage: string,
    learningLanguage: string,
    level: string,
    characters: CharacterSpec[],
    model?: string
  ): Promise<PatchedSentence[]>;
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
    aiGuideline?: string
  ): Promise<RegeneratedChapter[]>;
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
    model = 'gpt-4o-mini',
    aiGuideline = ''
  ): Promise<GeneratedStory> {
    const nativeName = LANGUAGE_NAMES[nativeLanguage] ?? nativeLanguage;
    const learningName = LANGUAGE_NAMES[learningLanguage] ?? learningLanguage;
    const levelGuidance = LEVEL_GUIDANCE[level] ?? LEVEL_GUIDANCE.intermediate;
    const N = chapterSpecs.length;

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
  "title": "<story title in ${learningName}>",
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
      "seed": "<brief chapter premise in English — internal authoring note, never shown to readers>",
      "sentences": [
        { "lang1": "<sentence in ${nativeName}>", "lang2": "<sentence in ${learningName}>" }
      ]
    }
  ]
}

Rules:
- Return exactly ${N} chapter objects in the "chapters" array
- Chapter i must contain exactly the sentence count listed below
- Give every chapter a short, reader-facing title (2–6 words) expressed in both languages
- "seed" is an internal authoring note used for later regeneration — it is NOT shown to readers; keep it brief and in English
- If a chapter has a provided seed, use it as the premise; if blank, invent a coherent one
- The story must flow naturally across all chapters
- lang1 is always ${nativeName}, lang2 is always ${learningName}
- Each sentence pair must express the same meaning in both languages
- Apply the level guidance consistently throughout
- Characters: if a cast is provided below, use exactly those characters (same names) as the cast and keep them consistent across all chapters, filling in any missing details; if no cast is provided, invent a coherent cast and return it in the "characters" array`;

    const chapterList = chapterSpecs
      .map((c, i) => `Chapter ${i + 1} (${c.targetSentences} sentences): ${c.seed || '(AI decides)'}`)
      .join('\n');

    const castList = characterLines(characters) || '(none provided — invent a coherent cast)';

    const userContent = `Story seed: ${seed}\n\nCharacters:\n${castList}\n\nChapters:\n${chapterList}`;

    const response = await this.client.chat.completions.create({
      model,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userContent },
      ],
    });

    const raw = response.choices[0]?.message?.content ?? '{}';
    const parsed = JSON.parse(raw) as { title?: string; characters?: unknown[]; chapters?: GeneratedChapter[] };

    const title = typeof parsed.title === 'string' ? parsed.title : '';
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

  async patchSentences(
    patches: SentencePatch[],
    generalFeedback: string,
    nativeLanguage: string,
    learningLanguage: string,
    level: string,
    characters: CharacterSpec[],
    model = 'gpt-4o-mini'
  ): Promise<PatchedSentence[]> {
    const nativeName = LANGUAGE_NAMES[nativeLanguage] ?? nativeLanguage;
    const learningName = LANGUAGE_NAMES[learningLanguage] ?? learningLanguage;
    const levelGuidance = LEVEL_GUIDANCE[level] ?? LEVEL_GUIDANCE.intermediate;

    const sentenceList = patches
      .map((p) => `Ch${p.chapterIndex + 1}/S${p.sentenceIndex + 1} — ${nativeName}: "${p.lang1}" | ${learningName}: "${p.lang2}"\nFeedback: ${p.feedback}`)
      .join('\n\n');

    const systemPrompt = `You are editing specific sentences of a bilingual story for a language learner.
Level: ${level} — ${levelGuidance}

Revise only the sentences provided based on their feedback and return them improved in both languages.

Return a JSON object with exactly this structure — no extra text:
{
  "patches": [
    { "chapterIndex": <0-based chapter index>, "sentenceIndex": <0-based sentence index>, "lang1": "<revised in ${nativeName}>", "lang2": "<revised in ${learningName}>" }
  ]
}

Rules:
- Return exactly one object per input sentence, preserving chapterIndex and sentenceIndex
- Apply the per-sentence feedback, using the general feedback as additional context
- Ensure lang1 and lang2 express the same meaning
- Maintain the story level throughout`;

    const userContent = [
      generalFeedback ? `General feedback: ${generalFeedback}` : '',
      characterLines(characters) ? `Keep the cast consistent with:\n${characterLines(characters)}` : '',
      sentenceList,
    ].filter(Boolean).join('\n\n');

    const response = await this.client.chat.completions.create({
      model,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userContent },
      ],
    });

    const raw = response.choices[0]?.message?.content ?? '{}';
    const parsed = JSON.parse(raw) as { patches?: PatchedSentence[] };
    return Array.isArray(parsed.patches) ? parsed.patches : [];
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
    model = 'gpt-4o-mini',
    aiGuideline = ''
  ): Promise<RegeneratedChapter[]> {
    const nativeName = LANGUAGE_NAMES[nativeLanguage] ?? nativeLanguage;
    const learningName = LANGUAGE_NAMES[learningLanguage] ?? learningLanguage;
    const levelGuidance = LEVEL_GUIDANCE[level] ?? LEVEL_GUIDANCE.intermediate;

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
    { "index": <0-based chapter index>, "title": { "lang1": "<short title in ${nativeName}>", "lang2": "<short title in ${learningName}>" }, "seed": "<updated premise in English>", "sentences": [{ "lang1": "...", "lang2": "..." }] }
  ]
}

Rules:
- Always include the TARGET chapter (index ${chapterIndex}) with exactly ${targetSentences} sentences
- Give the chapter a short, reader-facing title (2–6 words) in both languages
- "seed" is an internal authoring note (never shown to readers) — keep it brief and in English
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

    const response = await this.client.chat.completions.create({
      model,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: feedback },
      ],
    });

    const raw = response.choices[0]?.message?.content ?? '{}';
    const parsed = JSON.parse(raw) as { chapters?: RegeneratedChapter[] };
    return Array.isArray(parsed.chapters) ? parsed.chapters : [];
  }
}

export const aiService: IAIService = new OpenAIService();
