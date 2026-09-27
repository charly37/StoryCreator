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
    level: string
  ): Promise<GeneratedStory>;
  patchSentences(
    patches: SentencePatch[],
    generalFeedback: string,
    nativeLanguage: string,
    learningLanguage: string,
    level: string,
    characters: CharacterSpec[]
  ): Promise<PatchedSentence[]>;
  regenerateChapter(
    chapterIndex: number,
    newSeed: string,
    generalFeedback: string,
    allChapters: Array<{ seed: string; sentences: GeneratedSentence[] }>,
    nativeLanguage: string,
    learningLanguage: string,
    level: string,
    targetSentences: number,
    characters: CharacterSpec[]
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
    level: string
  ): Promise<GeneratedStory> {
    const nativeName = LANGUAGE_NAMES[nativeLanguage] ?? nativeLanguage;
    const learningName = LANGUAGE_NAMES[learningLanguage] ?? learningLanguage;
    const levelGuidance = LEVEL_GUIDANCE[level] ?? LEVEL_GUIDANCE.intermediate;
    const N = chapterSpecs.length;

    const systemPrompt = `You are a bilingual story writer creating parallel-text stories for language learners.
Each story presents the same sentence in two languages side by side.

Level: ${level}
${levelGuidance}

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
      "seed": "<brief chapter description in English>",
      "sentences": [
        { "lang1": "<sentence in ${nativeName}>", "lang2": "<sentence in ${learningName}>" }
      ]
    }
  ]
}

Rules:
- Return exactly ${N} chapter objects in the "chapters" array
- Chapter i must contain exactly the sentence count listed below
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
      model: 'gpt-4o-mini',
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

    // Ensure exactly N chapters, each trimmed/padded to target
    const chapters: GeneratedChapter[] = chapterSpecs.map((spec, i) => {
      const rawChapter = rawChapters[i];
      const chapterSeed = rawChapter?.seed ?? `Chapter ${i + 1}`;
      let sentences = Array.isArray(rawChapter?.sentences) ? rawChapter.sentences : [];
      sentences = sentences.slice(0, spec.targetSentences);
      while (sentences.length < spec.targetSentences) sentences.push({ lang1: '', lang2: '' });
      return { seed: chapterSeed, sentences };
    });

    return { title, characters: generatedCharacters, chapters };
  }

  async patchSentences(
    patches: SentencePatch[],
    generalFeedback: string,
    nativeLanguage: string,
    learningLanguage: string,
    level: string,
    characters: CharacterSpec[]
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
      model: 'gpt-4o-mini',
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
    allChapters: Array<{ seed: string; sentences: GeneratedSentence[] }>,
    nativeLanguage: string,
    learningLanguage: string,
    level: string,
    targetSentences: number,
    characters: CharacterSpec[]
  ): Promise<RegeneratedChapter[]> {
    const nativeName = LANGUAGE_NAMES[nativeLanguage] ?? nativeLanguage;
    const learningName = LANGUAGE_NAMES[learningLanguage] ?? learningLanguage;
    const levelGuidance = LEVEL_GUIDANCE[level] ?? LEVEL_GUIDANCE.intermediate;

    const contextSummary = allChapters
      .map((c, i) => `Chapter ${i + 1} (${i === chapterIndex ? 'TARGET — regenerate this' : 'context only'}): ${c.seed}`)
      .join('\n');

    const systemPrompt = `You are revising a specific chapter of a bilingual parallel-text story.
Level: ${level} — ${levelGuidance}

You are given the full story context. Rewrite the TARGET chapter using the new seed.
If the change affects story coherence in other chapters, you may also return updated versions of those chapters.

Return a JSON object with exactly this structure — no extra text:
{
  "chapters": [
    { "index": <0-based chapter index>, "seed": "<updated seed>", "sentences": [{ "lang1": "...", "lang2": "..." }] }
  ]
}

Rules:
- Always include the TARGET chapter (index ${chapterIndex}) with exactly ${targetSentences} sentences
- Only include other chapters if coherence truly requires changes; minimize collateral edits
- lang1 is always ${nativeName}, lang2 is always ${learningName}
- Each sentence pair must express the same meaning
- Maintain the story level throughout`;

    const feedback = [
      `New seed for chapter ${chapterIndex + 1}: ${newSeed}`,
      generalFeedback ? `Additional feedback: ${generalFeedback}` : '',
      characterLines(characters) ? `Keep the cast consistent with:\n${characterLines(characters)}` : '',
      `Story context:\n${contextSummary}`,
    ].filter(Boolean).join('\n\n');

    const response = await this.client.chat.completions.create({
      model: 'gpt-4o-mini',
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

