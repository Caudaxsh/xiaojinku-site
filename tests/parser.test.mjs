import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseVocab } from '../js/parser.js';

const sample = readFileSync(new URL('../samples/sample-words.txt', import.meta.url), 'utf8');

test('strict template: three words with every field', () => {
  const { cards, warnings, errors } = parseVocab(sample);
  assert.equal(errors.length, 0);
  assert.equal(warnings.length, 0);
  assert.deepEqual(cards.map((c) => c.word), ['entail', 'reluctant', 'meticulous']);
  const entail = cards[0];
  assert.equal(entail.en.length, 2);
  assert.equal(entail.zh.length, 2);
  assert.equal(entail.collocations.length, 7);
  assert.deepEqual(entail.collocations[0], { p: 'entail risks', zh: '涉及風險' });
  assert.match(entail.meaning, /涉及/);
  assert.match(entail.memory, /tail/);
});

test('loose ChatGPT-style layout (as pasted from the screenshot)', () => {
  const text = `Entail ⭐⭐⭐⭐

1. Starting a business entails taking financial risks.
2. The job entails working long hours and traveling frequently.

中文翻譯

1. 創業必然涉及承擔財務風險。
2. 這份工作需要長時間工作，並且經常出差。

Entail：涉及、必然需要、意味著必須承擔某件事。通常用來表示一項行動、工作或決定所包含的必要條件、責任或後果。

常見搭配

- entail risks — 涉及風險
- entail costs — 涉及成本
- potentially entail — 可能涉及

注意文法：entail + 名詞 / V-ing，通常不直接接 to V`;
  const { cards, warnings, errors } = parseVocab(text);
  assert.equal(errors.length, 0);
  assert.equal(warnings.length, 0);
  assert.equal(cards.length, 1);
  const c = cards[0];
  assert.equal(c.word, 'entail');
  assert.equal(c.en.length, 2);
  assert.equal(c.zh.length, 2);
  assert.match(c.meaning, /^涉及、必然需要/);
  assert.equal(c.collocations.length, 3);
  assert.match(c.notes, /V-ing/);
});

test('loose layout with --- separators and markdown headings', () => {
  const text = `## **abandon**
1. They had to abandon the car.
2. Don't abandon your dreams.
### 中文翻譯
1. 他們只好棄車。
2. 別放棄你的夢想。
**意思**：放棄、拋棄
---
## abate
1. The storm began to abate.
2. His anger finally abated.
### 中文翻譯
1. 暴風雨開始減弱。
2. 他的怒氣終於平息。
**意思**：減弱、減輕`;
  const { cards, errors } = parseVocab(text);
  assert.equal(errors.length, 0);
  assert.deepEqual(cards.map((c) => c.word), ['abandon', 'abate']);
  assert.equal(cards[1].meaning, '減弱、減輕');
});

test('words that share a name with a section label are still words', () => {
  const text = `# memory
EN: I have a good memory for faces.
EN: The memory of that day stayed with her.
ZH: 我對臉孔的記憶力很好。
ZH: 那天的記憶一直留在她心裡。
意思: 記憶
---
# note
EN: Please note the deadline.
EN: She made a note of it.
ZH: 請注意截止日期。
ZH: 她把它記了下來。
意思: 注意；筆記`;
  const { cards, errors } = parseVocab(text);
  assert.equal(errors.length, 0);
  assert.deepEqual(cards.map((c) => c.word), ['memory', 'note']);
  assert.equal(cards[1].en.length, 2);
});

test('warnings for incomplete cards, duplicates skipped', () => {
  const text = `# alpha
EN: Only one sentence.
意思: 一
---
# alpha
EN: duplicate
ZH: 重複`;
  const { cards, warnings } = parseVocab(text);
  assert.equal(cards.length, 1);
  assert.ok(warnings.some((w) => w.msgs.some((m) => m.includes('沒有中文翻譯'))));
  assert.ok(warnings.some((w) => w.msgs.some((m) => m.includes('重複'))));
});

test('multi-word phrase keeps its spaces, empty input is empty', () => {
  const { cards } = parseVocab('# take for granted\nEN: Never take it for granted.\nZH: 別把它視為理所當然。\n意思: 視為理所當然');
  assert.equal(cards[0].word, 'take for granted');
  assert.equal(parseVocab('   \n\n').cards.length, 0);
});
