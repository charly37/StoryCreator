export type TtsLanguage = 'lang1' | 'lang2';
export type TtsRequestStatus = 'queued' | 'processing' | 'done' | 'failed';

export interface TtsRequestSummary {
  id: string;
  storyId: string;
  lang: TtsLanguage;
  status: TtsRequestStatus;
  requestedAt: string;
}

export interface RequestAudioResult {
  ok: boolean;
  code?: string;
  message?: string;
  requests?: TtsRequestSummary[];
}

export interface TtsRequestListResult {
  ok: boolean;
  data: TtsRequestSummary[];
}

function toSummary(value: unknown): TtsRequestSummary | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  if (typeof raw.id !== 'string' || typeof raw.storyId !== 'string') return null;
  const lang = raw.lang === 'lang1' || raw.lang === 'lang2' ? raw.lang : null;
  const status =
    raw.status === 'queued' || raw.status === 'processing' || raw.status === 'done' || raw.status === 'failed'
      ? raw.status
      : null;
  if (!lang || !status) return null;
  return {
    id: raw.id,
    storyId: raw.storyId,
    lang,
    status,
    requestedAt: typeof raw.requestedAt === 'string' ? raw.requestedAt : '',
  };
}

/**
 * Queues text-to-speech generation for one of the caller's stories.
 * Defaults to both halves of the bilingual text; the backend rejects duplicates
 * by re-queuing the existing (story, language) request instead of inserting.
 */
export async function requestAudio(
  storyId: string,
  languages?: TtsLanguage[]
): Promise<RequestAudioResult> {
  try {
    const res = await fetch('/api/tts-requests', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(languages ? { storyId, languages } : { storyId }),
    });
    const data = (await res.json().catch(() => ({}))) as {
      requests?: unknown;
      code?: unknown;
      message?: unknown;
    };
    const requests = Array.isArray(data.requests)
      ? data.requests.map(toSummary).filter((item): item is TtsRequestSummary => item !== null)
      : undefined;
    return {
      ok: res.ok,
      code: typeof data.code === 'string' ? data.code : undefined,
      message: typeof data.message === 'string' ? data.message : undefined,
      requests,
    };
  } catch {
    return { ok: false };
  }
}

/** Batched status lookup for the caller's own requests across several stories. */
export async function fetchTtsRequests(storyIds: string[]): Promise<TtsRequestListResult> {
  const unique = Array.from(new Set(storyIds.filter(Boolean)));
  if (unique.length === 0) return { ok: true, data: [] };
  try {
    const res = await fetch(`/api/tts-requests?storyIds=${encodeURIComponent(unique.join(','))}`);
    if (!res.ok) return { ok: false, data: [] };
    const payload = (await res.json().catch(() => ({}))) as { data?: unknown };
    const data = Array.isArray(payload.data)
      ? payload.data.map(toSummary).filter((item): item is TtsRequestSummary => item !== null)
      : [];
    return { ok: true, data };
  } catch {
    return { ok: false, data: [] };
  }
}

/** Collapses a story's per-language requests into one status, pending-first. */
export function summarizeStoryAudio(requests: TtsRequestSummary[]): TtsRequestStatus | null {
  if (requests.length === 0) return null;
  if (requests.some((r) => r.status === 'queued')) return 'queued';
  if (requests.some((r) => r.status === 'processing')) return 'processing';
  if (requests.some((r) => r.status === 'failed')) return 'failed';
  return 'done';
}
