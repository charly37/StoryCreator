export interface AIModel {
  id: string;
  label: string;
  description: string;
}

// Update this list as new OpenAI models become available.
// Note: gpt-5-mini thinking levels are UI-only for now — reasoning_effort is not yet wired up.
export const AI_MODELS: AIModel[] = [
  { id: 'gpt-4o-mini',       label: 'GPT-4o mini',                 description: 'Default — fast and cost-efficient' },
  { id: 'gpt-4.1-mini',      label: 'GPT-4.1 mini',                description: 'Better quality, similar price' },
  { id: 'gpt-4o',            label: 'GPT-4o',                      description: 'Highest quality, higher cost' },
  { id: 'gpt-5-mini',        label: 'GPT-5 mini (Medium thinking)', description: 'Latest generation, balanced speed and quality' },
  { id: 'gpt-5-mini-high',   label: 'GPT-5 mini (High thinking)',   description: 'Latest generation, deeper reasoning, slower' },
];

export const DEFAULT_AI_MODEL = 'gpt-4o-mini';
