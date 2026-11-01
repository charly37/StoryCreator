/**
 * Progress helpers for the story reader and preview pages.
 *
 * Both pages flatten `chapters[].sentences[]` into a single navigable list, so an
 * `index` in that list is a STORY-wide position while `chapterIndex` identifies the
 * chapter. The UI keeps the two levels separate:
 *  - story level   → chapter counter + percentage of the whole story
 *  - chapter level → position of the current sentence inside its chapter
 */

export interface FlatSentenceLike {
  chapterIndex: number;
}

export interface ChapterContext {
  /** 1-based chapter number (0 when the story has no sentences). */
  chapterNumber: number;
  /** Total number of chapters in the story. */
  chapterCount: number;
  /** 1-based position of the current sentence inside its chapter (0 when unknown). */
  chapterSentence: number;
  /** Number of sentences in the current chapter. */
  chapterSentenceCount: number;
}

/**
 * Percentage of the story already read, counting the current sentence as read
 * so the label always matches the progress bar. Returns 0 for an empty story.
 */
export function getStoryPercent(index: number, total: number): number {
  if (!Number.isFinite(total) || total <= 0) return 0;
  const percent = Math.round(((index + 1) / total) * 100);
  return Math.min(100, Math.max(0, percent));
}

/**
 * Chapter-level context for the sentence at `index` in the flattened list.
 */
export function getChapterContext(
  flatSentences: ReadonlyArray<FlatSentenceLike>,
  index: number,
  chapterCount: number
): ChapterContext {
  const safeChapterCount = Math.max(chapterCount, 0);
  const current = flatSentences[index];

  if (!current) {
    return {
      chapterNumber: safeChapterCount > 0 ? 1 : 0,
      chapterCount: safeChapterCount,
      chapterSentence: 0,
      chapterSentenceCount: 0,
    };
  }

  let chapterSentence = 0;
  let chapterSentenceCount = 0;

  flatSentences.forEach((flat, i) => {
    if (flat.chapterIndex !== current.chapterIndex) return;
    chapterSentenceCount += 1;
    if (i <= index) chapterSentence += 1;
  });

  return {
    chapterNumber: current.chapterIndex + 1,
    chapterCount: safeChapterCount,
    chapterSentence,
    chapterSentenceCount,
  };
}

/**
 * Index of the first flattened sentence of `chapterIndex`.
 * Returns -1 when the chapter has no sentences (e.g. an empty draft chapter).
 */
export function getChapterStartIndex(
  flatSentences: ReadonlyArray<FlatSentenceLike>,
  chapterIndex: number
): number {
  return flatSentences.findIndex((flat) => flat.chapterIndex === chapterIndex);
}
