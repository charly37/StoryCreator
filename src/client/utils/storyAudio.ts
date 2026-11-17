export type TtsVariant = 'lang1' | 'lang2' | 'bilingual';

export interface StoryAudioVariant {
  variant: TtsVariant;
  durationMs: number;
  sizeBytes: number;
  createdAt: string;
  url: string;
}

export interface StoryAudioResult {
  ok: boolean;
  variants: StoryAudioVariant[];
}

function toVariant(value: unknown): StoryAudioVariant | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  const variant =
    raw.variant === 'lang1' || raw.variant === 'lang2' || raw.variant === 'bilingual'
      ? raw.variant
      : null;
  if (!variant || typeof raw.url !== 'string') return null;
  return {
    variant,
    durationMs: typeof raw.durationMs === 'number' ? raw.durationMs : 0,
    sizeBytes: typeof raw.sizeBytes === 'number' ? raw.sizeBytes : 0,
    createdAt: typeof raw.createdAt === 'string' ? raw.createdAt : '',
    url: raw.url,
  };
}

/**
 * Renders for a story. A 403 (someone else's draft) or 404 simply yields no variants —
 * the reader hides the player rather than showing a broken element.
 */
export async function fetchStoryAudio(storyId: string): Promise<StoryAudioResult> {
  try {
    const res = await fetch(`/api/stories/${storyId}/audio`);
    if (!res.ok) return { ok: false, variants: [] };
    const payload = (await res.json().catch(() => ({}))) as { variants?: unknown };
    const variants = Array.isArray(payload.variants)
      ? payload.variants
          .map(toVariant)
          .filter((item): item is StoryAudioVariant => item !== null)
      : [];
    return { ok: true, variants };
  } catch {
    return { ok: false, variants: [] };
  }
}

/**
 * The reader shows the learning language prominently, so default to that track; fall
 * back to the bilingual mix and then to the native track.
 */
export function pickDefaultVariant(variants: StoryAudioVariant[]): TtsVariant | null {
  const preference: TtsVariant[] = ['lang2', 'bilingual', 'lang1'];
  for (const candidate of preference) {
    if (variants.some((item) => item.variant === candidate)) return candidate;
  }
  return variants[0]?.variant ?? null;
}

/** `m:ss`, or `h:mm:ss` past an hour. Empty string for a missing duration. */
export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return '';
  const totalSeconds = Math.round(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const pad = (value: number) => value.toString().padStart(2, '0');
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${minutes}:${pad(seconds)}`;
}

export function formatSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '';
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Filename for the download attribute: accented characters are folded, everything
 * outside [a-z0-9] becomes `-`, and non-Latin titles fall back to the story id.
 */
export function downloadName(title: string, variant: TtsVariant, fallbackId: string): string {
  const slug = title
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return `${slug || fallbackId}-${variant}.mp3`;
}
