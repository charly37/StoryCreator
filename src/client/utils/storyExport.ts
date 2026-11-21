import { strToU8, zipSync } from 'fflate';

export type StoryExportEdition = 'bilingual' | 'learning' | 'native';

export interface StoryExportSource {
  _id?: string;
  title: { lang1: string; lang2: string };
  chapters: Array<{
    title?: { lang1?: string; lang2?: string };
    sentences: Array<{ lang1: string; lang2: string }>;
  }>;
  nativeLanguage: string;
  learningLanguage: string;
  authorName: string;
}

export interface ExportText {
  text: string;
  language: string;
  direction: 'ltr' | 'rtl';
}

export interface ExportChapter {
  number: number;
  titles: ExportText[];
  paragraphs: ExportText[];
}

export interface ExportBook {
  titles: ExportText[];
  author: string;
  language: string;
  chapters: ExportChapter[];
}

function directionFor(language: string): 'ltr' | 'rtl' {
  return language === 'ar' ? 'rtl' : 'ltr';
}

function text(value: string | undefined, language: string): ExportText | null {
  const content = value?.trim();
  if (!content) return null;
  return { text: content, language, direction: directionFor(language) };
}

function uniqueTexts(values: Array<ExportText | null>): ExportText[] {
  const seen = new Set<string>();
  return values.filter((value): value is ExportText => {
    if (!value) return false;
    const key = `${value.language}\0${value.text}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function projectStoryForExport(
  story: StoryExportSource,
  edition: StoryExportEdition,
  chapterLabel: (number: number) => string = (number) => `Chapter ${number}`,
  chapterLabelLanguage = 'en'
): ExportBook {
  const learningLanguage = story.learningLanguage;
  const nativeLanguage = story.nativeLanguage;
  const primaryLanguage = edition === 'native' ? nativeLanguage : learningLanguage;
  const selectTitle = (titles: { lang1?: string; lang2?: string }) => {
    if (edition === 'native') {
      return text(titles.lang1, nativeLanguage) ?? text(titles.lang2, learningLanguage);
    }
    return text(titles.lang2, learningLanguage) ?? text(titles.lang1, nativeLanguage);
  };

  const titles = edition === 'bilingual'
    ? uniqueTexts([
        text(story.title.lang2, learningLanguage),
        text(story.title.lang1, nativeLanguage),
      ])
    : uniqueTexts([selectTitle(story.title)]);

  const chapters = story.chapters.flatMap((chapter, index) => {
    const paragraphs = chapter.sentences.flatMap((sentence) => {
      const learningText = text(sentence.lang2, learningLanguage);
      const nativeText = text(sentence.lang1, nativeLanguage);
      if (edition === 'bilingual') return uniqueTexts([learningText, nativeText]);
      const selectedText = edition === 'learning' ? learningText : nativeText;
      return selectedText ? [selectedText] : [];
    });
    if (paragraphs.length === 0) return [];

    const chapterTitles = edition === 'bilingual'
      ? uniqueTexts([
          text(chapter.title?.lang2, learningLanguage),
          text(chapter.title?.lang1, nativeLanguage),
        ])
      : uniqueTexts([selectTitle(chapter.title ?? {})]);

    return [{
      number: index + 1,
      titles: chapterTitles.length > 0
        ? chapterTitles
        : [text(chapterLabel(index + 1), chapterLabelLanguage)!],
      paragraphs,
    }];
  });

  return { titles, author: story.authorName.trim(), language: primaryLanguage, chapters };
}

export function storyExportFilename(
  title: string,
  edition: StoryExportEdition,
  extension: 'epub' | 'pdf'
): string {
  const safeTitle = title
    .normalize('NFKC')
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 100)
    .replace(/[-. ]+$/g, '');
  return `${safeTitle || 'story'}-${edition}.${extension}`;
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function textElement(value: ExportText, className = ''): string {
  const classAttribute = className ? ` class="${className}"` : '';
  return `<p${classAttribute} lang="${escapeXml(value.language)}" dir="${value.direction}">${escapeXml(value.text)}</p>`;
}

function epubXhtml(language: string, title: string, body: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE html>\n<html xmlns="http://www.w3.org/1999/xhtml" lang="${escapeXml(language)}" xml:lang="${escapeXml(language)}"><head><title>${escapeXml(title)}</title><link rel="stylesheet" type="text/css" href="styles.css" /></head><body>${body}</body></html>`;
}

export function createEpub(
  book: ExportBook,
  storyId = 'story',
  modifiedAt = new Date(),
  contentsLabel = 'Contents'
): Uint8Array {
  const chapterItems = book.chapters.map((chapter, index) => {
    const id = `chapter-${index + 1}`;
    const title = chapter.titles[0]?.text || `Chapter ${chapter.number}`;
    const headings = chapter.titles.map((item, titleIndex) =>
      titleIndex === 0
        ? `<h1 lang="${escapeXml(item.language)}" dir="${item.direction}">${escapeXml(item.text)}</h1>`
        : `<p class="translated-title" lang="${escapeXml(item.language)}" dir="${item.direction}">${escapeXml(item.text)}</p>`
    ).join('');
    const body = `<section><h2 class="chapter-number">${chapter.number}</h2>${headings}${chapter.paragraphs.map((paragraph) => textElement(paragraph, paragraph.language === book.language ? '' : 'translation')).join('')}</section>`;
    return { id, title, content: epubXhtml(book.language, title, body) };
  });

  const titleBody = `<section class="title-page">${book.titles.map((item, index) =>
    index === 0
      ? `<h1 lang="${escapeXml(item.language)}" dir="${item.direction}">${escapeXml(item.text)}</h1>`
      : `<p class="translated-title" lang="${escapeXml(item.language)}" dir="${item.direction}">${escapeXml(item.text)}</p>`
  ).join('')}<p class="author">${escapeXml(book.author)}</p></section>`;
  const navItems = chapterItems.map((chapter) =>
    `<li><a href="${chapter.id}.xhtml">${escapeXml(chapter.title)}</a></li>`
  ).join('');
  const manifestItems = chapterItems.map((chapter) =>
    `<item id="${chapter.id}" href="${chapter.id}.xhtml" media-type="application/xhtml+xml"/>`
  ).join('');
  const spineItems = chapterItems.map((chapter) => `<itemref idref="${chapter.id}"/>`).join('');
  const modified = modifiedAt.toISOString().replace(/\.\d{3}Z$/, 'Z');
  const entries: Record<string, Uint8Array> = {
    mimetype: strToU8('application/epub+zip'),
    'META-INF/container.xml': strToU8('<?xml version="1.0" encoding="UTF-8"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/package.opf" media-type="application/oebps-package+xml"/></rootfiles></container>'),
    'OEBPS/package.opf': strToU8(`<?xml version="1.0" encoding="UTF-8"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="book-id" xml:lang="${escapeXml(book.language)}"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="book-id">urn:storycreator:${escapeXml(storyId)}</dc:identifier><dc:title>${escapeXml(book.titles[0]?.text || 'Story')}</dc:title><dc:creator>${escapeXml(book.author)}</dc:creator><dc:language>${escapeXml(book.language)}</dc:language><meta property="dcterms:modified">${modified}</meta></metadata><manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/><item id="styles" href="styles.css" media-type="text/css"/><item id="title" href="title.xhtml" media-type="application/xhtml+xml"/>${manifestItems}</manifest><spine><itemref idref="title"/>${spineItems}</spine></package>`),
    'OEBPS/nav.xhtml': strToU8(epubXhtml(book.language, contentsLabel, `<nav xmlns:epub="http://www.idpf.org/2007/ops" epub:type="toc" id="toc"><h1>${escapeXml(contentsLabel)}</h1><ol>${navItems}</ol></nav>`)),
    'OEBPS/title.xhtml': strToU8(epubXhtml(book.language, book.titles[0]?.text || 'Story', titleBody)),
    'OEBPS/styles.css': strToU8('body { font-family: serif; line-height: 1.55; margin: 5%; } h1 { font-size: 1.6em; line-height: 1.25; } .chapter-number { font-size: 0.9em; font-weight: normal; } .translated-title, .translation { color: #555; } .translated-title { margin-top: -0.5em; } .translation { margin-top: -0.7em; margin-bottom: 1.5em; } .author { margin-top: 3em; } .title-page { page-break-after: always; }'),
  };
  chapterItems.forEach((chapter) => {
    entries[`OEBPS/${chapter.id}.xhtml`] = strToU8(chapter.content);
  });

  // EPUB requires the first ZIP entry to be an uncompressed mimetype file.
  return zipSync(entries, { level: 0 });
}

export function createPrintDocument(book: ExportBook): string {
  const title = book.titles[0]?.text || 'Story';
  const titleMarkup = book.titles.map((item, index) =>
    index === 0
      ? `<h1 lang="${escapeXml(item.language)}" dir="${item.direction}">${escapeXml(item.text)}</h1>`
      : `<p class="translated-title" lang="${escapeXml(item.language)}" dir="${item.direction}">${escapeXml(item.text)}</p>`
  ).join('');
  const chapters = book.chapters.map((chapter) => {
    const headings = chapter.titles.map((item, index) =>
      index === 0
        ? `<h2 lang="${escapeXml(item.language)}" dir="${item.direction}">${escapeXml(item.text)}</h2>`
        : `<p class="translated-title" lang="${escapeXml(item.language)}" dir="${item.direction}">${escapeXml(item.text)}</p>`
    ).join('');
    return `<section class="chapter"><p class="chapter-number">${chapter.number}</p>${headings}${chapter.paragraphs.map((paragraph) => textElement(paragraph, paragraph.language === book.language ? '' : 'translation')).join('')}</section>`;
  }).join('');

  return `<!doctype html><html lang="${escapeXml(book.language)}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeXml(title)}</title><style>
    :root { color-scheme: light; }
    body { color: #171717; font-family: Georgia, "Times New Roman", serif; font-size: 12pt; line-height: 1.65; margin: 0 auto; max-width: 42rem; padding: 3rem 2rem; }
    h1 { font-size: 2rem; line-height: 1.2; margin: 0; }
    h2 { font-size: 1.4rem; line-height: 1.3; margin: 0 0 1rem; }
    .title-page { align-items: center; display: flex; flex-direction: column; justify-content: center; min-height: 75vh; text-align: center; }
    .translated-title { color: #555; font-style: italic; margin-top: 0.4rem; }
    .author { margin-top: 2.5rem; }
    .chapter { margin-top: 4rem; }
    .chapter-number { color: #555; font-family: sans-serif; font-size: 0.8rem; letter-spacing: 0.08em; text-transform: uppercase; }
    .translation { color: #555; margin-top: -0.6rem; margin-bottom: 1.5rem; }
    [dir="rtl"] { text-align: right; }
    @media print {
      @page { margin: 0.75in; }
      body { max-width: none; padding: 0; }
      .title-page { break-after: page; min-height: 9in; }
      .chapter { break-before: page; margin-top: 0; }
      p, h1, h2 { orphans: 3; widows: 3; }
    }
  </style></head><body><main><section class="title-page">${titleMarkup}<p class="author">${escapeXml(book.author)}</p></section>${chapters}</main></body></html>`;
}

export function openStoryPrintDocument(book: ExportBook): boolean {
  const printWindow = window.open('', '_blank');
  if (!printWindow) return false;

  printWindow.opener = null;
  let hasPrinted = false;
  const print = () => {
    if (hasPrinted) return;
    hasPrinted = true;
    printWindow.focus();
    printWindow.print();
  };
  printWindow.addEventListener('load', print, { once: true });
  printWindow.document.open();
  printWindow.document.write(createPrintDocument(book));
  printWindow.document.close();
  if (printWindow.document.readyState === 'complete') {
    window.setTimeout(print, 0);
  }
  return true;
}