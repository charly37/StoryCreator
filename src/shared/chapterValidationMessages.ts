export const SUPPORTED_STORY_LANGUAGE_CODES = [
  'ar', 'zh', 'nl', 'en', 'fr', 'de', 'hi', 'it', 'ja', 'ko', 'pl', 'pt', 'ru', 'es', 'sv', 'tr', 'uk',
] as const;

export type StoryLanguageCode = (typeof SUPPORTED_STORY_LANGUAGE_CODES)[number];

export type ChapterValidationFinding =
  | { type: 'empty' }
  | { type: 'countMismatch'; expected: number; actual: number }
  | { type: 'repeated'; current: number; previous: number }
  | { type: 'identical'; sentence: number }
  | { type: 'partialTranslation'; sentence: number };

interface ChapterValidationMessages {
  empty: string;
  countMismatch: string;
  repeated: string;
  identical: string;
  partialTranslation: string;
}

export const CHAPTER_VALIDATION_MESSAGES: Record<StoryLanguageCode, ChapterValidationMessages> = {
  ar: {
    empty: 'لا يحتوي هذا الفصل على جمل بعد.',
    countMismatch: 'كان متوقعًا {expected} جملة، لكن وُجدت {actual}.',
    repeated: 'الجملة {current} تكرر الجملة {previous}.',
    identical: 'الجملة {sentence} متطابقة في اللغتين.',
    partialTranslation: 'قد تكون الجملة {sentence} ترجمة جزئية (اختلاف في الطول).',
  },
  zh: {
    empty: '本章还没有句子。',
    countMismatch: '预期有 {expected} 个句子，但实际有 {actual} 个。',
    repeated: '第 {current} 句重复了第 {previous} 句。',
    identical: '第 {sentence} 句在两种语言中完全相同。',
    partialTranslation: '第 {sentence} 句可能只翻译了一部分（长度不匹配）。',
  },
  nl: {
    empty: 'Dit hoofdstuk bevat nog geen zinnen.',
    countMismatch: 'Er werden {expected} zinnen verwacht, maar er zijn er {actual}.',
    repeated: 'Zin {current} herhaalt zin {previous}.',
    identical: 'Zin {sentence} is in beide talen identiek.',
    partialTranslation: 'Zin {sentence} lijkt mogelijk gedeeltelijk vertaald (lengteverschil).',
  },
  en: {
    empty: 'This chapter has no sentences yet.',
    countMismatch: 'Expected {expected} sentences but found {actual}.',
    repeated: 'Sentence {current} repeats sentence {previous}.',
    identical: 'Sentence {sentence} is identical in both languages.',
    partialTranslation: 'Sentence {sentence} looks like a partial translation (length mismatch).',
  },
  fr: {
    empty: 'Ce chapitre ne contient pas encore de phrases.',
    countMismatch: '{expected} phrases étaient attendues, mais {actual} ont été trouvées.',
    repeated: 'La phrase {current} répète la phrase {previous}.',
    identical: 'La phrase {sentence} est identique dans les deux langues.',
    partialTranslation: 'La phrase {sentence} semble partiellement traduite (longueur incohérente).',
  },
  de: {
    empty: 'Dieses Kapitel enthält noch keine Sätze.',
    countMismatch: 'Erwartet wurden {expected} Sätze, gefunden wurden jedoch {actual}.',
    repeated: 'Satz {current} wiederholt Satz {previous}.',
    identical: 'Satz {sentence} ist in beiden Sprachen identisch.',
    partialTranslation: 'Satz {sentence} scheint teilweise übersetzt zu sein (Längenabweichung).',
  },
  hi: {
    empty: 'इस अध्याय में अभी कोई वाक्य नहीं है।',
    countMismatch: '{expected} वाक्यों की अपेक्षा थी, लेकिन {actual} मिले।',
    repeated: 'वाक्य {current}, वाक्य {previous} को दोहराता है।',
    identical: 'वाक्य {sentence} दोनों भाषाओं में एक जैसा है।',
    partialTranslation: 'वाक्य {sentence} का अनुवाद अधूरा लगता है (लंबाई में अंतर)।',
  },
  it: {
    empty: 'Questo capitolo non contiene ancora frasi.',
    countMismatch: 'Erano previste {expected} frasi, ma ne sono state trovate {actual}.',
    repeated: 'La frase {current} ripete la frase {previous}.',
    identical: 'La frase {sentence} è identica in entrambe le lingue.',
    partialTranslation: 'La frase {sentence} sembra tradotta solo in parte (lunghezza non coerente).',
  },
  ja: {
    empty: 'この章にはまだ文がありません。',
    countMismatch: '予想される文の数は{expected}でしたが、実際は{actual}でした。',
    repeated: '{current}番目の文は{previous}番目の文と重複しています。',
    identical: '{sentence}番目の文は両方の言語で同一です。',
    partialTranslation: '{sentence}番目の文は翻訳が一部欠けている可能性があります（長さの不一致）。',
  },
  ko: {
    empty: '이 장에는 아직 문장이 없습니다.',
    countMismatch: '문장 {expected}개가 예상되었지만 {actual}개가 확인되었습니다.',
    repeated: '{current}번 문장이 {previous}번 문장을 반복합니다.',
    identical: '{sentence}번 문장이 두 언어에서 동일합니다.',
    partialTranslation: '{sentence}번 문장은 일부만 번역된 것 같습니다(길이 불일치).',
  },
  pl: {
    empty: 'Ten rozdział nie zawiera jeszcze żadnych zdań.',
    countMismatch: 'Oczekiwano {expected} zdań, ale znaleziono {actual}.',
    repeated: 'Zdanie {current} powtarza zdanie {previous}.',
    identical: 'Zdanie {sentence} jest identyczne w obu językach.',
    partialTranslation: 'Zdanie {sentence} wygląda na częściowo przetłumaczone (różnica długości).',
  },
  pt: {
    empty: 'Este capítulo ainda não tem frases.',
    countMismatch: 'Eram esperadas {expected} frases, mas foram encontradas {actual}.',
    repeated: 'A frase {current} repete a frase {previous}.',
    identical: 'A frase {sentence} é idêntica nos dois idiomas.',
    partialTranslation: 'A frase {sentence} parece ter uma tradução parcial (diferença de tamanho).',
  },
  ru: {
    empty: 'В этой главе пока нет предложений.',
    countMismatch: 'Ожидалось предложений: {expected}, найдено: {actual}.',
    repeated: 'Предложение {current} повторяет предложение {previous}.',
    identical: 'Предложение {sentence} одинаково на обоих языках.',
    partialTranslation: 'Возможно, предложение {sentence} переведено не полностью (различается длина).',
  },
  es: {
    empty: 'Este capítulo todavía no tiene oraciones.',
    countMismatch: 'Se esperaban {expected} oraciones, pero se encontraron {actual}.',
    repeated: 'La oración {current} repite la oración {previous}.',
    identical: 'La oración {sentence} es idéntica en ambos idiomas.',
    partialTranslation: 'La oración {sentence} parece tener una traducción parcial (diferencia de longitud).',
  },
  sv: {
    empty: 'Det här kapitlet innehåller inga meningar ännu.',
    countMismatch: '{expected} meningar förväntades, men {actual} hittades.',
    repeated: 'Mening {current} upprepar mening {previous}.',
    identical: 'Mening {sentence} är identisk på båda språken.',
    partialTranslation: 'Mening {sentence} verkar vara delvis översatt (skillnad i längd).',
  },
  tr: {
    empty: 'Bu bölümde henüz cümle yok.',
    countMismatch: '{expected} cümle bekleniyordu, ancak {actual} bulundu.',
    repeated: '{current}. cümle, {previous}. cümleyi tekrarlıyor.',
    identical: '{sentence}. cümle her iki dilde de aynı.',
    partialTranslation: '{sentence}. cümlenin çevirisi eksik olabilir (uzunluk farkı).',
  },
  uk: {
    empty: 'У цьому розділі ще немає речень.',
    countMismatch: 'Очікувалося речень: {expected}, знайдено: {actual}.',
    repeated: 'Речення {current} повторює речення {previous}.',
    identical: 'Речення {sentence} однакове обома мовами.',
    partialTranslation: 'Можливо, речення {sentence} перекладено частково (різниця в довжині).',
  },
};

function interpolate(template: string, values: Record<string, number>): string {
  return template.replace(/\{(\w+)\}/g, (placeholder, key: string) => {
    const value = values[key];
    return value === undefined ? placeholder : String(value);
  });
}

export function formatChapterValidationFinding(
  finding: ChapterValidationFinding,
  language: string
): string {
  const messages = CHAPTER_VALIDATION_MESSAGES[
    SUPPORTED_STORY_LANGUAGE_CODES.includes(language as StoryLanguageCode) ? language as StoryLanguageCode : 'en'
  ];

  switch (finding.type) {
    case 'empty':
      return messages.empty;
    case 'countMismatch':
      return interpolate(messages.countMismatch, { expected: finding.expected, actual: finding.actual });
    case 'repeated':
      return interpolate(messages.repeated, { current: finding.current, previous: finding.previous });
    case 'identical':
      return interpolate(messages.identical, { sentence: finding.sentence });
    case 'partialTranslation':
      return interpolate(messages.partialTranslation, { sentence: finding.sentence });
  }
}