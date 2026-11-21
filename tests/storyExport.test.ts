import assert from 'node:assert/strict';
import test from 'node:test';
import { strFromU8, unzipSync } from 'fflate';
import {
  createEpub,
  createPrintDocument,
  projectStoryForExport,
  storyExportFilename,
  type StoryExportSource,
} from '../src/client/utils/storyExport';

const story: StoryExportSource = {
  _id: 'story-123',
  title: { lang1: 'La lune & nous', lang2: '月と私たち' },
  nativeLanguage: 'fr',
  learningLanguage: 'ja',
  authorName: 'Élodie <Martin>',
  chapters: [
    {
      title: { lang1: 'Le départ', lang2: '出発' },
      sentences: [
        { lang1: 'La lune brille.', lang2: '月が輝いている。' },
        { lang1: 'Nous partons.', lang2: '私たちは出発する。' },
      ],
    },
    { title: { lang1: 'Vide', lang2: '空' }, sentences: [] },
  ],
};

test('bilingual edition keeps learning text before its translation and omits empty chapters', () => {
  const book = projectStoryForExport(story, 'bilingual');

  assert.deepEqual(book.titles.map(({ text, language }) => [text, language]), [
    ['月と私たち', 'ja'],
    ['La lune & nous', 'fr'],
  ]);
  assert.deepEqual(book.chapters.map(({ number }) => number), [1]);
  assert.deepEqual(book.chapters[0].paragraphs.map(({ text, language }) => [text, language]), [
    ['月が輝いている。', 'ja'],
    ['La lune brille.', 'fr'],
    ['私たちは出発する。', 'ja'],
    ['Nous partons.', 'fr'],
  ]);
});

test('single-language editions use matching titles, headings, and language metadata', () => {
  const learning = projectStoryForExport(story, 'learning');
  const native = projectStoryForExport(story, 'native');

  assert.equal(learning.language, 'ja');
  assert.equal(learning.titles[0].text, '月と私たち');
  assert.equal(learning.chapters[0].titles[0].text, '出発');
  assert.deepEqual(learning.chapters[0].paragraphs.map(({ text }) => text), [
    '月が輝いている。',
    '私たちは出発する。',
  ]);
  assert.equal(native.language, 'fr');
  assert.equal(native.titles[0].text, 'La lune & nous');
  assert.equal(native.chapters[0].titles[0].text, 'Le départ');
  assert.deepEqual(native.chapters[0].paragraphs.map(({ text }) => text), [
    'La lune brille.',
    'Nous partons.',
  ]);
});

test('RTL text carries direction metadata and absent chapters receive a chapter label', () => {
  const rtlStory: StoryExportSource = {
    ...story,
    nativeLanguage: 'ar',
    title: { lang1: 'القمر', lang2: 'The Moon' },
    chapters: [{ title: { lang1: '', lang2: '' }, sentences: [{ lang1: 'نور.', lang2: 'Light.' }] }],
  };
  const book = projectStoryForExport(rtlStory, 'native', (number) => `Chapitre ${number}`, 'fr');

  assert.equal(book.chapters[0].titles[0].text, 'Chapitre 1');
  assert.equal(book.chapters[0].titles[0].language, 'fr');
  assert.equal(book.chapters[0].paragraphs[0].direction, 'rtl');
});

test('EPUB archive has the required entries and escapes story text', () => {
  const epub = createEpub(projectStoryForExport(story, 'bilingual'), story._id);
  const archive = unzipSync(epub);
  const packageXml = strFromU8(archive['OEBPS/package.opf']);
  const chapter = strFromU8(archive['OEBPS/chapter-1.xhtml']);
  const titlePage = strFromU8(archive['OEBPS/title.xhtml']);
  const header = new DataView(epub.buffer, epub.byteOffset, epub.byteLength);
  const firstFilenameLength = header.getUint16(26, true);

  assert.equal(strFromU8(epub.subarray(30, 30 + firstFilenameLength)), 'mimetype');
  assert.equal(header.getUint16(8, true), 0);
  assert.equal(strFromU8(archive.mimetype), 'application/epub+zip');
  assert.match(strFromU8(archive['OEBPS/nav.xhtml']), /chapter-1\.xhtml/);
  assert.match(packageXml, /<dc:language>ja<\/dc:language>/);
  assert.match(titlePage, /La lune &amp; nous/);
  assert.match(chapter, /lang="ja" dir="ltr"/);
  assert.doesNotMatch(chapter, /<script>/);
});

test('print document escapes text and applies print page breaks', () => {
  const html = createPrintDocument(projectStoryForExport(story, 'bilingual'));

  assert.match(html, /La lune &amp; nous/);
  assert.match(html, /break-before: page/);
  assert.match(html, /<html lang="ja">/);
  assert.match(html, /dir="ltr"/);
});

test('filenames are safe and retain readable titles', () => {
  assert.equal(storyExportFilename('L’été / <Moon>', 'bilingual', 'epub'), 'L’été-Moon-bilingual.epub');
  assert.equal(storyExportFilename('   ', 'native', 'pdf'), 'story-native.pdf');
});