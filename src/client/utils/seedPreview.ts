const DEFAULT_SEED_PREVIEW_LENGTH = 140;

const normalizeWhitespace = (text: string): string => text.replace(/\s+/g, ' ').trim();

export const formatSeedPreview = (seed: string, maxLength = DEFAULT_SEED_PREVIEW_LENGTH): string => {
  const normalized = normalizeWhitespace(seed || '');
  if (!normalized) return '';
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength).trimEnd()}…`;
};
