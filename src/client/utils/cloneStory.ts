export interface CloneStoryResult {
  ok: boolean;
  id?: string;
  code?: string;
  message?: string;
}

/**
 * Deep-copies a story the user can read into a new draft and returns its id.
 * The caller is responsible for navigating to the editor on success.
 */
export async function cloneStory(storyId: string): Promise<CloneStoryResult> {
  try {
    const res = await fetch(`/api/stories/${storyId}/clone`, { method: 'POST' });
    const data = (await res.json().catch(() => ({}))) as {
      _id?: unknown;
      code?: unknown;
      message?: unknown;
    };
    return {
      ok: res.ok,
      id: typeof data._id === 'string' ? data._id : undefined,
      code: typeof data.code === 'string' ? data.code : undefined,
      message: typeof data.message === 'string' ? data.message : undefined,
    };
  } catch {
    return { ok: false };
  }
}
