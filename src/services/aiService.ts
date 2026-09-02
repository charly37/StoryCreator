import OpenAI from 'openai';

export interface GeneratedSentence {
  lang1: string;
  lang2: string;
}

export interface GeneratedStory {
  title: string;
  sentences: GeneratedSentence[];
}

export interface SentencePatch {
  index: number;
  lang1: string;
  lang2: string;
  feedback: string;
}

export interface PatchedSentence {
  index: number;
  lang1: string;
  lang2: string;
}

export interface IAIService {
  generateStory(
    seed: string,
    nativeLanguage: string,
    learningLanguage: string,
    sentenceCount: number,
    level: string
  ): Promise<GeneratedStory>;
  patchSentences(
    patches: SentencePatch[],
    generalFeedback: string,
    nativeLanguage: string,
    learningLanguage: string,
    level: string
  ): Promise<PatchedSentence[]>;
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

class OpenAIService implements IAIService {
  private client: OpenAI;

  constructor() {
    this.client = new OpenAI({ apiKey: process.env.OPEN_AI_KEY });
  }

  async generateStory(
    seed: string,
    nativeLanguage: string,
    learningLanguage: string,
    sentenceCount: number,
    level: string
  ): Promise<GeneratedStory> {
    const nativeName = LANGUAGE_NAMES[nativeLanguage] ?? nativeLanguage;
    const learningName = LANGUAGE_NAMES[learningLanguage] ?? learningLanguage;
    const levelGuidance = LEVEL_GUIDANCE[level] ?? LEVEL_GUIDANCE.intermediate;

    const systemPrompt = `You are a bilingual story writer creating parallel-text stories for language learners.
Each story presents the same sentence in two languages side by side.

Level: ${level}
${levelGuidance}

Return a JSON object with exactly this structure — no extra text or markdown:
{
  "title": "<story title in ${learningName}>",
  "sentences": [
    { "lang1": "<sentence in ${nativeName}>", "lang2": "<sentence in ${learningName}>" }
  ]
}

Rules:
- Write exactly ${sentenceCount} sentence objects in the "sentences" array
- lang1 is always ${nativeName}, lang2 is always ${learningName}
- Each lang1/lang2 pair must express the same meaning in the respective language
- The story must be coherent and follow the seed narrative from start to finish
- Apply the level guidance consistently throughout`;

    const response = await this.client.chat.completions.create({
      model: 'gpt-4o-mini',
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: `Write a story based on this seed: ${seed}` },
      ],
    });

    const raw = response.choices[0]?.message?.content ?? '{}';
    const parsed = JSON.parse(raw) as { title?: string; sentences?: GeneratedSentence[] };

    const title = typeof parsed.title === 'string' ? parsed.title : '';
    let sentences = Array.isArray(parsed.sentences) ? parsed.sentences : [];

    // Trim or pad to exactly sentenceCount if the model drifts
    sentences = sentences.slice(0, sentenceCount);
    while (sentences.length < sentenceCount) {
      sentences.push({ lang1: '', lang2: '' });
    }

    return { title, sentences };
  }

  async patchSentences(
    patches: SentencePatch[],
    generalFeedback: string,
    nativeLanguage: string,
    learningLanguage: string,
    level: string
  ): Promise<PatchedSentence[]> {
    const nativeName = LANGUAGE_NAMES[nativeLanguage] ?? nativeLanguage;
    const learningName = LANGUAGE_NAMES[learningLanguage] ?? learningLanguage;
    const levelGuidance = LEVEL_GUIDANCE[level] ?? LEVEL_GUIDANCE.intermediate;

    const sentenceList = patches
      .map((p) => `Sentence ${p.index} — ${nativeName}: "${p.lang1}" | ${learningName}: "${p.lang2}"\nFeedback: ${p.feedback}`)
      .join('\n\n');

    const systemPrompt = `You are editing specific sentences of a bilingual story for a language learner.
Level: ${level} — ${levelGuidance}

You will receive sentences with individual feedback and optionally a general note.
Revise only the sentences provided and return them improved in both languages.

Return a JSON object with exactly this structure — no extra text:
{
  "patches": [
    { "index": <original index>, "lang1": "<revised sentence in ${nativeName}>", "lang2": "<revised sentence in ${learningName}>" }
  ]
}

Rules:
- Return exactly one object per input sentence, preserving the original index
- Apply the per-sentence feedback, using the general feedback as additional context
- Ensure lang1 and lang2 express the same meaning
- Maintain the story level throughout`;

    const userContent = [
      generalFeedback ? `General feedback: ${generalFeedback}` : '',
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
}

export const aiService: IAIService = new OpenAIService();
