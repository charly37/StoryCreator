/**
 * Single source of truth for the AI model catalogue.
 *
 * Imported by both the server (`src/services/*`, `src/routes/*`) and the client
 * (`src/client/utils/aiModels.ts`). Keep it free of Node and browser APIs.
 *
 * Cost policy: `DEFAULT_AI_MODEL` is the cheap, long-standing model and every
 * fallback resolves to it. Entries flagged `premium` are opt-in only — they must
 * never be used as a default, a fallback, or a pre-selected value.
 */

/** Values accepted by the OpenAI `reasoning_effort` parameter, cheapest first. */
export type ReasoningEffort = 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max';

export const EFFORT_ORDER: readonly ReasoningEffort[] = [
  'none',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
] as const;

export interface AIModelSpec {
  /** Selection id stored on the story (`aiModel` / `outlineAiModel`) and sent by clients. */
  id: string;
  /** Model id actually sent to the OpenAI API (differs from `id` for pinned aliases). */
  apiModel: string;
  label: string;
  description: string;
  /** True when the model emits reasoning tokens and accepts `reasoning_effort`. */
  reasoning: boolean;
  /** Efforts accepted by `apiModel`, cheapest first. Empty for classic models. */
  efforts: readonly ReasoningEffort[];
  /** When set, the effort is fixed for this entry and callers cannot override it. */
  pinnedEffort?: ReasoningEffort;
  /** Opt-in entry: materially more expensive than the default. Never auto-selected. */
  premium: boolean;
  /** No longer recommended upstream but kept selectable for existing stories. */
  deprecated: boolean;
  inputPricePerMTok: number;
  outputPricePerMTok: number;
}

/**
 * Order matters: the five long-standing entries come first so the picker looks
 * familiar, and the premium pair is appended so it can be grouped separately.
 *
 * Prices are USD per 1M tokens (standard tier, as published by OpenAI) and exist
 * only for display/validation — the app never computes a bill from them.
 */
export const AI_MODELS: readonly AIModelSpec[] = [
  {
    id: 'gpt-4o-mini',
    apiModel: 'gpt-4o-mini',
    label: 'GPT-4o mini',
    description: 'Default — fast and cost-efficient',
    reasoning: false,
    efforts: [],
    premium: false,
    deprecated: true,
    inputPricePerMTok: 0.15,
    outputPricePerMTok: 0.6,
  },
  {
    id: 'gpt-4.1-mini',
    apiModel: 'gpt-4.1-mini',
    label: 'GPT-4.1 mini',
    description: 'Better quality, similar price',
    reasoning: false,
    efforts: [],
    premium: false,
    deprecated: true,
    inputPricePerMTok: 0.4,
    outputPricePerMTok: 1.6,
  },
  {
    id: 'gpt-4o',
    apiModel: 'gpt-4o',
    label: 'GPT-4o',
    description: 'Highest quality of the classic models, higher cost',
    reasoning: false,
    efforts: [],
    premium: false,
    deprecated: true,
    inputPricePerMTok: 2.5,
    outputPricePerMTok: 10,
  },
  {
    id: 'gpt-5-mini',
    apiModel: 'gpt-5-mini',
    label: 'GPT-5 mini',
    description: 'Reasoning model — pick a thinking level to trade cost for depth',
    reasoning: true,
    // gpt-5-mini has no `none`, so leaving effort unset keeps its own default (medium).
    efforts: ['minimal', 'low', 'medium', 'high'],
    premium: false,
    deprecated: true,
    inputPricePerMTok: 0.25,
    outputPricePerMTok: 2,
  },
  {
    // Legacy alias kept so the option list is unchanged. It is not a real model:
    // it resolves to gpt-5-mini with the effort pinned to high.
    id: 'gpt-5-mini-high',
    apiModel: 'gpt-5-mini',
    label: 'GPT-5 mini (High thinking)',
    description: 'Same as GPT-5 mini with thinking fixed to high',
    reasoning: true,
    efforts: ['minimal', 'low', 'medium', 'high'],
    pinnedEffort: 'high',
    premium: false,
    deprecated: true,
    inputPricePerMTok: 0.25,
    outputPricePerMTok: 2,
  },
  {
    id: 'gpt-5.6-luna',
    apiModel: 'gpt-5.6-luna',
    label: 'GPT-5.6 Luna',
    description: 'Newest generation, cheapest reasoning model',
    reasoning: true,
    efforts: ['none', 'low', 'medium', 'high', 'xhigh', 'max'],
    premium: true,
    deprecated: false,
    inputPricePerMTok: 0.2,
    outputPricePerMTok: 1.2,
  },
  {
    id: 'gpt-5.4-mini',
    apiModel: 'gpt-5.4-mini',
    label: 'GPT-5.4 mini',
    description: 'Strongest mini model — several times the price of the default',
    reasoning: true,
    efforts: ['none', 'low', 'medium', 'high', 'xhigh'],
    premium: true,
    deprecated: false,
    inputPricePerMTok: 0.75,
    outputPricePerMTok: 4.5,
  },
] as const;

/**
 * The long-standing default. Deliberately cheap and NOT premium: it is the
 * fallback everywhere so an author never pays for a model they did not pick.
 */
export const DEFAULT_AI_MODEL = 'gpt-4o-mini';

/** Every selection id the app accepts (7). */
export const SELECTABLE_MODELS: readonly AIModelSpec[] = AI_MODELS;

/** Kept for the staged wizard; every entry is now valid server-side. */
export const STAGED_AI_MODELS: readonly AIModelSpec[] = AI_MODELS;

/** Ids of the opt-in, higher-cost entries. */
export const PREMIUM_MODEL_IDS: ReadonlySet<string> = new Set(
  AI_MODELS.filter((model) => model.premium).map((model) => model.id)
);

/** Enum values for the persisted effort fields ('' = provider default). */
export const AI_EFFORT_VALUES: readonly string[] = ['', ...EFFORT_ORDER];

export function isReasoningEffort(value: unknown): value is ReasoningEffort {
  return typeof value === 'string' && (EFFORT_ORDER as readonly string[]).includes(value);
}

/** Looks up a selection entry. Returns undefined for unknown ids. */
export function findModelSpec(id?: string | null): AIModelSpec | undefined {
  if (!id) return undefined;
  return AI_MODELS.find((model) => model.id === id);
}

export function isSelectableModel(id: unknown): id is string {
  return typeof id === 'string' && AI_MODELS.some((model) => model.id === id);
}

export function supportsReasoning(id?: string | null): boolean {
  return findModelSpec(id)?.reasoning === true;
}

export function effortsFor(id?: string | null): readonly ReasoningEffort[] {
  return findModelSpec(id)?.efforts ?? [];
}

/** Narrows a persisted or user-supplied value to a known effort, or '' when unset. */
export function normalizeEffort(value: unknown): ReasoningEffort | '' {
  return isReasoningEffort(value) ? value : '';
}

export function isEffortSupportedBy(spec: AIModelSpec, effort: ReasoningEffort): boolean {
  return spec.efforts.includes(effort);
}

/** True when the model accepts a caller-chosen effort (not pinned, not classic). */
export function canChooseEffort(spec: AIModelSpec): boolean {
  return spec.reasoning && !spec.pinnedEffort && spec.efforts.length > 0;
}

/**
 * Effort that is safe to send with a given model: `''` unless the model accepts
 * a free choice and actually supports that value. Keeps stale UI state (for
 * example a level inherited from another stage) from producing a rejected call.
 */
export function effortForRequest(
  selectionId?: string | null,
  effort?: string | null
): ReasoningEffort | '' {
  const spec = findModelSpec(selectionId);
  if (!spec || !canChooseEffort(spec)) return '';
  return isReasoningEffort(effort) && isEffortSupportedBy(spec, effort) ? effort : '';
}

export interface ResolvedSelection {
  spec: AIModelSpec;
  /** Model id to send to OpenAI. */
  apiModel: string;
  /** Effort to send, or undefined to omit the parameter (provider default). */
  effort?: ReasoningEffort;
}

/**
 * Maps a stored/sent selection id to the real API model and effort.
 *
 * Unknown or empty ids fall back to `DEFAULT_AI_MODEL`, never to a premium one.
 * A pinned alias (`gpt-5-mini-high`) always wins over a caller-supplied effort.
 */
export function resolveSelection(
  selectionId?: string | null,
  requestedEffort?: string | null
): ResolvedSelection {
  const spec = findModelSpec(selectionId) ?? (findModelSpec(DEFAULT_AI_MODEL) as AIModelSpec);

  if (spec.pinnedEffort) {
    return { spec, apiModel: spec.apiModel, effort: spec.pinnedEffort };
  }

  if (!spec.reasoning || !isReasoningEffort(requestedEffort)) {
    return { spec, apiModel: spec.apiModel };
  }

  // Unsupported values are ignored rather than clamped; routes reject them earlier.
  if (!isEffortSupportedBy(spec, requestedEffort)) {
    return { spec, apiModel: spec.apiModel };
  }

  return { spec, apiModel: spec.apiModel, effort: requestedEffort };
}

/** Human-readable label, with the effort appended when one is set. */
export function modelLabel(selectionId?: string | null, effort?: string | null): string {
  const spec = findModelSpec(selectionId);
  if (!spec) return selectionId ?? DEFAULT_AI_MODEL;
  if (!effort || spec.pinnedEffort) return spec.label;
  return `${spec.label} · ${effort}`;
}
