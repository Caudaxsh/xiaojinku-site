import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseVocab } from '../js/parser.js';

const sample = readFileSync(new URL('../samples/sample-words.txt', import.meta.url), 'utf8');
const flagship = readFileSync(new URL('../samples/flagship.txt', import.meta.url), 'utf8');

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

test('full flagship entry: every section lands in its own field', () => {
  const { cards, warnings, errors } = parseVocab(flagship);
  assert.equal(errors.length, 0);
  assert.equal(warnings.length, 0);
  const c = cards[0];
  assert.equal(c.word, 'flagship');
  assert.equal(c.aiStars, 4);
  assert.equal(c.en.length, 2);
  assert.equal(c.zh.length, 2);
  assert.equal(c.collocations.length, 6);
  assert.deepEqual(c.collocations[2], { p: 'flagship store', zh: '旗艦店' });
  assert.equal(c.compares.length, 1);
  assert.equal(c.compares[0].title, 'Flagship vs. Premium vs. Mainstream');
  assert.deepEqual(c.compares[0].items.map((x) => x.p), ['flagship', 'premium', 'mainstream']);
  assert.equal(c.forms.length, 3);
  assert.deepEqual(c.forms[0], { p: 'flagship（n. / adj.）', zh: '旗艦；旗艦級的' });
  assert.equal(c.forms[2].p, 'flagship-level（adj.）');
  assert.match(c.memory, /^flag（旗幟）＋ ship/);
  assert.match(c.memory, /主力艦/);
  assert.equal(c.quick, 'Flagship = 品牌拿來當門面的代表作。');
  // No explicit 意思 line: falls back to the headword's 詞性變化 entry.
  assert.equal(c.meaning, '旗艦；旗艦級的');
});

test('many words back to back without separators (PDF style)', () => {
  const second = `Entail ⭐⭐⭐
Starting a business entails taking financial risks.
The job entails working long hours and traveling frequently.
中文翻譯
創業必然涉及承擔財務風險。
這份工作需要長時間工作，並且經常出差。
Entail：涉及、必然需要
常見搭配
entail risks — 涉及風險`;
  const bare = `meticulous
She is meticulous about keeping her notes organized.
The report shows meticulous attention to detail.
中文翻譯
她對筆記的整理一絲不苟。
這份報告展現了對細節的一絲不苟。
意思: 一絲不苟的`;
  const { cards, errors } = parseVocab(`${flagship}\n${second}\n\n${bare}`);
  assert.equal(errors.length, 0);
  assert.deepEqual(cards.map((c) => c.word), ['flagship', 'entail', 'meticulous']);
  assert.equal(cards[0].quick, 'Flagship = 品牌拿來當門面的代表作。');
  assert.equal(cards[1].aiStars, 3);
  assert.equal(cards[1].meaning, '涉及、必然需要');
  assert.equal(cards[2].en.length, 2);
});

test('IPA from the heading or an 音標 line', () => {
  const a = parseVocab('Flagship /ˈflæɡ.ʃɪp/ ⭐⭐⭐\nA flagship store.\n中文翻譯\n旗艦店。\n意思: 旗艦').cards[0];
  assert.equal(a.word, 'flagship');
  assert.equal(a.ipa, '/ˈflæɡ.ʃɪp/');
  const b = parseVocab('# entail\n音標: /ɪnˈteɪl/\nEN: It entails risk.\nZH: 它涉及風險。\n意思: 涉及').cards[0];
  assert.equal(b.ipa, '/ɪnˈteɪl/');
  assert.equal(b.en.length, 1);
});

test('the AI prompt example parses cleanly', async () => {
  const { AI_PROMPT } = await import('../js/parser.js');
  const example = AI_PROMPT.split('範例：\n')[1].split('\n---')[0];
  const { cards, warnings } = parseVocab(example);
  assert.equal(cards.length, 1);
  assert.equal(warnings.length, 0);
  assert.equal(cards[0].ipa, '/ˈflæɡ.ʃɪp/');
  assert.equal(cards[0].meaning, '（n. / adj.）旗艦；旗艦級的、最具代表性的');
  assert.equal(cards[0].compares[0].items.length, 3);
});

test('junk preface (e.g. a PDF title) is reported, not turned into a card', () => {
  const { cards, errors } = parseVocab(`My Vocabulary Notes — Week 3\n\n${flagship}`);
  assert.deepEqual(cards.map((c) => c.word), ['flagship']);
  assert.equal(errors.length, 1);
});

// Layout produced when ChatGPT's markdown is saved straight to PDF:
// IPA above the headword, "##"/"###" kept as text, unlabeled meaning,
// a custom "###" section, a heading glued to the previous sentence,
// a phrase with a placeholder, and ①② lost as NUL characters.
const GPT_PDF = `/ˈlʌv.li/
## Lovely ★★★★
1. We had a lovely dinner by the sea.
2. That sounds lovely to me.
### 中文翻譯
1. 我們在海邊吃了一頓美好的晚餐。
2. 聽起來很棒。
Lovely：美好的、迷人的。可以形容人或事物。
### 常見搭配
- a lovely meal — 一頓美好的餐點
- How lovely! — 真美好！
### 詞性變化
- lovely (adj.) — 美好的
- loveliness (n.) — 美好之處
### 拆解記憶
love + -ly → lovely
### 最快記法：Lovely = 讓人感覺很美好
例如：The sweetness is lovely.
/dɪˈplɔɪ/
## Deploy ★★★
1. We plan to deploy the system next month.
2. They deployed more troops to the border.### 中文翻譯
1. 我們計畫下個月部署系統。
2. 他們向邊境部署了更多部隊。
部署、調度；把人員或系統投入實際使用。
### 常見搭配
- deploy troops — 部署軍隊
### 科技領域特別常見的用法
在軟體工程中，deploy 指把程式發布到正式環境。
Develop → Test → Deploy
### 詞性變化
- deployment (n.) — 部署
deploy 的名詞最常用 deployment。
### 拆解記憶
de- + ploy
### 最快記法：Deploy = 投入使用
/beɪs/
## Base (something) on ★★★★
1. The movie is based on a true story.
2. We should base our decision on facts.
### 中文翻譯
1. 這部電影是根據真實故事改編的。
2. 我們應該根據事實做決定。
Base something on something：以某事物為基礎。
### 常見搭配
- be based on — 以……為基礎
### 詞性變化
- basis (n.) — 基礎
### 拆解記憶
先有 base 才能往上蓋。
### 最快記法：正式寫作用 based on
/ˈteɪlˌɡeɪt/
## Tailgate ★★★★
1. The driver behind me was tailgating.
2. We had a tailgate party before the game.
### 中文翻譯
1. 後面的駕駛一直緊跟著我。
2. 我們在比賽前辦了停車場派對。
Tailgate：最常見有兩個意思：\u0000（開車時）緊跟前車；\u0000 汽車的尾門。
### 常見搭配
- tailgate someone — 緊跟某人的車
### 詞性變化
- tailgater (n.) — 緊跟前車的駕駛
### 拆解記憶
tail + gate
### 最快記法：Tailgate = 貼著車尾`;

test('ChatGPT markdown saved as PDF: every word and section lands correctly', () => {
  const { cards, warnings, errors } = parseVocab(GPT_PDF);
  assert.deepEqual(errors, []);
  assert.deepEqual(warnings, []);
  assert.deepEqual(cards.map((c) => c.word), ['lovely', 'deploy', 'base (something) on', 'tailgate']);
  assert.deepEqual(cards.map((c) => c.ipa), ['/ˈlʌv.li/', '/dɪˈplɔɪ/', '/beɪs/', '/ˈteɪlˌɡeɪt/']);
  assert.deepEqual(cards.map((c) => c.aiStars), [4, 3, 4, 4]);
  for (const c of cards) {
    assert.equal(c.en.length, 2, `${c.word} en`);
    assert.equal(c.zh.length, 2, `${c.word} zh`);
  }
  const [lovely, deploy, base] = cards;
  assert.equal(lovely.meaning, '美好的、迷人的。可以形容人或事物。');
  assert.equal(lovely.collocations.length, 2);
  assert.equal(lovely.quick, 'Lovely = 讓人感覺很美好\n例如：The sweetness is lovely.');
  // unlabeled meaning after the translations, glued heading split off
  assert.equal(deploy.meaning, '部署、調度；把人員或系統投入實際使用。');
  assert.deepEqual(deploy.extras.map((x) => x.title), ['科技領域特別常見的用法']);
  assert.match(deploy.extras[0].text, /Develop → Test → Deploy/);
  assert.deepEqual(deploy.forms[1], { note: 'deploy 的名詞最常用 deployment。' });
  // English lead-in before the colon is dropped
  assert.equal(base.meaning, '以某事物為基礎。');
});

test('NUL characters from unmapped glyphs are stripped by the parser', () => {
  const t = parseVocab(GPT_PDF).cards[3];
  assert.equal(t.word, 'tailgate');
  assert.ok(!t.meaning.includes('\u0000'));
});
