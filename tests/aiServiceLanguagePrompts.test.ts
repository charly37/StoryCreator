import assert from 'node:assert/strict';
import test from 'node:test';
import { aiService } from '../src/services/aiService';

test('visible AI-authored notes follow the FROM language', async () => {
  const originalFetch = globalThis.fetch;
  const originalApiKey = process.env.OPEN_AI_KEY;
  const requests: Array<{ system: string; user: string }> = [];
  process.env.OPEN_AI_KEY = 'test-key';

  globalThis.fetch = async (input, init) => {
    const request = input instanceof Request ? input : new Request(input, init);
    const payload = JSON.parse(await request.clone().text()) as {
      messages: Array<{ role: string; content: string }>;
    };
    requests.push({
      system: payload.messages.find(({ role }) => role === 'system')?.content ?? '',
      user: payload.messages.find(({ role }) => role === 'user')?.content ?? '',
    });
    return new Response(JSON.stringify({
      choices: [{ finish_reason: 'stop', message: { content: '{"reply":"ok","brief":"brief"}' } }],
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  };

  try {
    await aiService.generateOutline({
      seed: 'Une horloge oubliée sonne à minuit.',
      nativeLanguage: 'fr',
      learningLanguage: 'pt',
      level: 'beginner',
      characters: [],
      chapterSpecs: [{ title: { lang1: '', lang2: '' }, seed: '', targetSentences: 8 }],
    });
    await aiService.generateChapter({
      storySeed: 'Une horloge oubliée sonne à minuit.',
      synopsis: { lang1: 'Une horloge sonne.', lang2: 'Um relógio toca.' },
      chapterSpec: { title: { lang1: '', lang2: '' }, seed: 'Une porte s’ouvre.', targetSentences: 8 },
      chapterIndex: 0,
      previousRecaps: [],
      characters: [],
      nativeLanguage: 'fr',
      learningLanguage: 'pt',
      level: 'beginner',
    });
    await aiService.generateStory(
      'Une horloge oubliée sonne à minuit.', 'fr', 'pt',
      [{ seed: '', targetSentences: 8 }], [], 'beginner'
    );
    await aiService.regenerateChapter(
      0, 'Une porte s’ouvre.', '', 'Une horloge sonne.',
      [{ seed: '', sentences: [] }], 'fr', 'pt', 'beginner', 8, []
    );
    await aiService.reviewChapter({
      sentences: [{ lang1: 'La porte est ouverte.', lang2: 'A porta está aberta.' }],
      synopsis: { lang1: '', lang2: '' },
      chapterTitle: '',
      nativeLanguage: 'fr',
      learningLanguage: 'pt',
      level: 'beginner',
    });
    await aiService.chatAboutOutline({
      seed: 'Une horloge oubliée sonne à minuit.',
      nativeLanguage: 'fr',
      learningLanguage: 'pt',
      level: 'beginner',
      synopsis: { lang1: 'Une horloge sonne.', lang2: 'Um relógio toca.' },
      characters: [],
      chapterSpecs: [{ title: { lang1: '', lang2: '' }, seed: '', targetSentences: 8 }],
      messages: [{ role: 'user', content: 'Rends la fin plus joyeuse.' }],
      mode: 'chat',
      replyLanguage: 'fr',
    });
  } finally {
    globalThis.fetch = originalFetch;
    if (originalApiKey === undefined) delete process.env.OPEN_AI_KEY;
    else process.env.OPEN_AI_KEY = originalApiKey;
  }

  assert.equal(requests.length, 6);
  assert.match(requests[0].system, /chapter seeds are internal authoring notes in French/i);
  assert.match(requests[0].system, /description.*in French/i);
  assert.match(requests[0].system, /appearance.*in French/i);
  assert.match(requests[0].system, /lang1 is always French, lang2 is always Portuguese/i);
  assert.match(requests[1].system, /"seed".*in French/i);
  assert.match(requests[1].system, /"recap".*in English/i);
  assert.match(requests[2].system, /"role".*in French/i);
  assert.match(requests[2].system, /"seed".*in French/i);
  assert.match(requests[3].system, /updated premise in French/i);
  assert.match(requests[4].system, /issue in French/i);
  assert.match(requests[5].system, /reply.*in French/i);
  assert.match(requests[5].system, /confirmed intent/i);
  assert.match(requests[5].user, /Rends la fin plus joyeuse/);
});