/** Shared input sanitizers for story authoring (session routes and the public API). */

export const MAX_CHARACTERS = 20;
export const MAX_AI_GUIDELINE_LENGTH = 2000;
export const MAX_CHAPTERS_PER_STORY = 10;
export const MAX_TARGET_SENTENCES = 100;
export const DEFAULT_SENTENCES_PER_CHAPTER = 12;
export const MAX_LABELS = 20;
export const MAX_LABEL_LENGTH = 40;

export interface SanitizedCharacter {
  name: string;
  role: string;
  description: string;
  appearance: string;
}

interface CharacterInput {
  name?: unknown;
  role?: unknown;
  description?: unknown;
  appearance?: unknown;
}

/** Trims character fields, drops nameless entries, and caps the cast size. */
export function sanitizeCharacters(input: unknown): SanitizedCharacter[] {
  if (!Array.isArray(input)) return [];
  return input
    .filter((character): character is CharacterInput => !!character && typeof character === 'object')
    .map((character) => ({
      name: typeof character.name === 'string' ? character.name.trim() : '',
      role: typeof character.role === 'string' ? character.role.trim() : '',
      description: typeof character.description === 'string' ? character.description.trim() : '',
      appearance: typeof character.appearance === 'string' ? character.appearance.trim() : '',
    }))
    .filter((character) => character.name !== '')
    .slice(0, MAX_CHARACTERS);
}

export function sanitizeAIGuideline(input: unknown): string {
  if (typeof input !== 'string') return '';
  return input.trim().slice(0, MAX_AI_GUIDELINE_LENGTH);
}

/**
 * Returns a deduplicated label list from a structured `labels` array and/or a
 * legacy single `topic` field. `labels` takes precedence when provided.
 */
export function sanitizeLabels(labelsInput: unknown, legacyTopicInput?: unknown): string[] {
  const rawValues = Array.isArray(labelsInput)
    ? labelsInput
    : typeof legacyTopicInput === 'string'
      ? [legacyTopicInput]
      : [];

  const seen = new Set<string>();
  const labels: string[] = [];
  for (const value of rawValues) {
    if (typeof value !== 'string') continue;
    const trimmed = value.trim().slice(0, MAX_LABEL_LENGTH);
    if (!trimmed) continue;
    const dedupeKey = trimmed.toLowerCase();
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    labels.push(trimmed);
    if (labels.length >= MAX_LABELS) break;
  }

  return labels;
}

/** Clamps an arbitrary value to an integer within `[min, max]`, falling back to `fallback`. */
export function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(parsed, min), max);
}
