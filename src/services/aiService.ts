export interface GeneratedSentence {
  lang1: string;
  lang2: string;
}

export interface IAIService {
  generateStory(
    seed: string,
    nativeLanguage: string,
    learningLanguage: string,
    sentenceCount: number
  ): Promise<GeneratedSentence[]>;
}

// Stub — replace this implementation with an OpenAI/Claude call when ready
class StubAIService implements IAIService {
  async generateStory(
    seed: string,
    nativeLanguage: string,
    learningLanguage: string,
    sentenceCount: number
  ): Promise<GeneratedSentence[]> {
    return Array.from({ length: sentenceCount }, (_, i) => ({
      lang1: `[${nativeLanguage}] Sentence ${i + 1} based on: "${seed}"`,
      lang2: `[${learningLanguage}] Sentence ${i + 1} based on: "${seed}"`,
    }));
  }
}

export const aiService: IAIService = new StubAIService();
