import assert from 'node:assert/strict';
import test from 'node:test';
import { LANGUAGES } from '../src/client/utils/languages';
import {
  CHAPTER_VALIDATION_MESSAGES,
  formatChapterValidationFinding,
  SUPPORTED_STORY_LANGUAGE_CODES,
  type ChapterValidationFinding,
} from '../src/shared/chapterValidationMessages';

const findings: ChapterValidationFinding[] = [
  { type: 'empty' },
  { type: 'countMismatch', expected: 12, actual: 10 },
  { type: 'repeated', current: 4, previous: 2 },
  { type: 'identical', sentence: 3 },
  { type: 'partialTranslation', sentence: 5 },
];

test('validation messages cover every supported story language', () => {
  assert.deepEqual(
    [...SUPPORTED_STORY_LANGUAGE_CODES].sort(),
    LANGUAGES.map(({ code }) => code).sort()
  );

  for (const language of SUPPORTED_STORY_LANGUAGE_CODES) {
    const messages = CHAPTER_VALIDATION_MESSAGES[language];
    for (const key of ['empty', 'countMismatch', 'repeated', 'identical', 'partialTranslation'] as const) {
      assert.ok(messages[key].trim(), `${language}.${key} should not be empty`);
    }
  }
});

test('validation findings interpolate values for every supported language', () => {
  for (const language of SUPPORTED_STORY_LANGUAGE_CODES) {
    for (const finding of findings) {
      const message = formatChapterValidationFinding(finding, language);
      assert.ok(message.trim(), `${language}.${finding.type} should not be empty`);
      assert.doesNotMatch(message, /\{\w+\}/, `${language}.${finding.type} has an unresolved placeholder`);
    }
  }
});

test('unknown language codes fall back to English', () => {
  for (const finding of findings) {
    assert.equal(
      formatChapterValidationFinding(finding, 'unknown'),
      formatChapterValidationFinding(finding, 'en')
    );
  }
});