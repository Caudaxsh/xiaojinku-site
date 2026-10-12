import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseVocab, normalizeText, CARD_TEMPLATE, AI_PROMPT_PDF, AI_PROMPT_TEXT } from '../js/parser.js';

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

test('junk preface (e.g. a PDF title) is reported, not turned into a card', () => {
  const { cards, errors } = parseVocab(`My Vocabulary Notes — Week 3\n\n${flagship}`);
  assert.deepEqual(cards.map((c) => c.word), ['flagship']);
  assert.equal(errors.length, 0);
  assert.equal(parseVocab(`My Vocabulary Notes — Week 3\n\n${flagship}`).ignored.length, 1);
});

// Layout produced when ChatGPT's markdown is saved straight to PDF (invented vocabulary):
// IPA above the headword, "##"/"###" kept as text, unlabeled meaning, a custom
// "###" section, a heading glued to the previous sentence, a phrase with a
// placeholder, and circled digits lost as NUL characters.
const MD_PDF = `/rɪˈzɪl.i.ənt/
## Resilient ★★★★
1. She stayed resilient after losing her job.
2. Small shops are often more resilient than big chains.
### 中文翻譯
1. 她失業後依然保持堅韌。
2. 小型商店往往比大型連鎖店更有韌性。
Resilient：有韌性的、能迅速恢復的。可以形容人、組織或系統。
### 常見搭配
- a resilient economy — 有韌性的經濟
- remain resilient — 保持堅韌
### 詞性變化
- resilient (adj.) — 有韌性的
- resilience (n.) — 韌性、復原力
### 拆解記憶
re-（回）＋ sil（跳）→ 跳回來
### 最快記法：Resilient = 跌倒了還會彈回來
例如：Kids are resilient.
/ˈpɪv.ət/
## Pivot ★★★
1. The company decided to pivot to online sales.
2. He used his left foot as a pivot.### 中文翻譯
1. 這家公司決定轉向線上銷售。
2. 他以左腳為軸心轉身。
轉向、以…為軸心旋轉；樞紐。
### 常見搭配
- pivot to — 轉向
### 技術與商業用法
在新創圈，pivot 指改變商業方向。
Idea → Test → Pivot
### 詞性變化
- pivot (v.) — 轉向
pivot 作名詞時指「軸心」。
### 拆解記憶
pi + vot
### 最快記法：Pivot = 繞著一點轉
/set/
## Set (something) up ★★★★
1. They set up a meeting for Friday.
2. I need to set the printer up before noon.
### 中文翻譯
1. 他們安排了週五的會議。
2. 我得在中午前把印表機裝好。
Set something up：安排、設置、建立。
### 常見搭配
- set up a meeting — 安排會議
### 詞性變化
- setup (n.) — 設置
### 拆解記憶
把東西「擺設」起來
### 最快記法：Set up = 把東西弄好
/ˈmiːnɪŋ/
## Mean ★★★
1. What does this word mean?
2. He didn't mean to hurt you.
### 中文翻譯
1. 這個字是什麼意思？
2. 他不是故意要傷害你。
Mean：最常見有兩個意思：\u0000 表示、意思是；\u0000 打算、有意。
### 常見搭配
- mean to do — 打算做
### 詞性變化
- mean (v.) — 表示
### 拆解記憶
mean 和 mind 同源
### 最快記法：Mean = 想表達的意思`;

test('ChatGPT markdown saved as PDF: every word and section lands correctly', () => {
  const { cards, warnings, errors } = parseVocab(MD_PDF);
  assert.deepEqual(errors, []);
  assert.deepEqual(warnings, []);
  assert.deepEqual(cards.map((c) => c.word), ['resilient', 'pivot', 'set (something) up', 'mean']);
  assert.deepEqual(cards.map((c) => c.ipa), ['/rɪˈzɪl.i.ənt/', '/ˈpɪv.ət/', '/set/', '/ˈmiːnɪŋ/']);
  assert.deepEqual(cards.map((c) => c.aiStars), [4, 3, 4, 3]);
  for (const c of cards) {
    assert.equal(c.en.length, 2, `${c.word} en`);
    assert.equal(c.zh.length, 2, `${c.word} zh`);
  }
  const [resilient, pivot, setUp, mean] = cards;
  assert.equal(resilient.meaning, '有韌性的、能迅速恢復的。可以形容人、組織或系統。');
  assert.equal(resilient.quick, 'Resilient = 跌倒了還會彈回來\n例如：Kids are resilient.');
  // unlabeled meaning after the translations; glued heading split off; custom section kept
  assert.equal(pivot.meaning, '轉向、以…為軸心旋轉；樞紐。');
  assert.deepEqual(pivot.extras.map((x) => x.title), ['技術與商業用法']);
  assert.match(pivot.extras[0].text, /Idea → Test → Pivot/);
  assert.deepEqual(pivot.forms[1], { note: 'pivot 作名詞時指「軸心」。' });
  // English lead-in before the colon is dropped
  assert.equal(setUp.meaning, '安排、設置、建立。');
  // NUL (a glyph the PDF font lacked) never reaches the card
  assert.ok(!JSON.stringify(mean).includes('\u0000'));
  assert.match(mean.meaning, /最常見有兩個意思/);
});

test('official card template parses with nothing lost and no warnings', () => {
  const { cards, warnings, errors } = parseVocab(`${CARD_TEMPLATE}\n${CARD_TEMPLATE.replace('Flagship', 'Premium').replace('flagship', 'premium')}`);
  assert.deepEqual(errors, []);
  assert.deepEqual(warnings, []);
  assert.deepEqual(cards.map((c) => c.word), ['flagship', 'premium']);
  const c = cards[0];
  assert.equal(c.ipa, '/ˈflæɡ.ʃɪp/');
  assert.equal(c.aiStars, 4);
  assert.equal(c.meaning, '旗艦；旗艦級的');
  assert.equal(c.meaningMore.split('\n').length, 2);
  assert.ok(c.meaningMore.startsWith('• （n.）'));
  assert.equal(c.collocations.length, 5);
  assert.equal(c.compares.length, 1);
  assert.equal(c.compares[0].items.length, 3);
  assert.equal(c.forms.length, 3);
  assert.match(c.memory, /^flag（旗幟）＋ ship/);
  assert.equal(c.quick, 'Flagship = 品牌拿來當門面的代表作');
});

test('both GPT prompts embed the template and the numbered content rules', () => {
  for (const prompt of [AI_PROMPT_PDF, AI_PROMPT_TEXT]) {
    assert.ok(prompt.includes(CARD_TEMPLATE));
    assert.match(prompt, /不要使用 ①②③/);
    assert.match(prompt, /我的單字清單/);
  }
  assert.match(AI_PROMPT_PDF, /A4 直式/);
  assert.match(AI_PROMPT_PDF, /完成，共 N 個單字/);
  assert.doesNotMatch(AI_PROMPT_TEXT, /A4/);
});

test('rules document stays in sync with the PDF prompt in the app', () => {
  const doc = readFileSync(new URL('../docs/gpt-pdf-rules.md', import.meta.url), 'utf8');
  assert.ok(doc.includes(AI_PROMPT_PDF.trim()), 'docs/gpt-pdf-rules.md must contain the current PDF prompt verbatim');
});

test('normalizeText: nbsp, zero-width, full-width digits, bullets and glued headings', () => {
  assert.equal(normalizeText('a\u00a0b\u200bc\ufeffd'), 'a bcd');
  assert.equal(normalizeText('１．第一句'), '1. 第一句');
  assert.equal(normalizeText('Done.### 中文翻譯'), 'Done.\n### 中文翻譯');
  const { cards } = parseVocab(`## Sturdy ★★★
1．This chair is sturdy.
2．The box is not very sturdy.
### 中文翻譯
１．這張椅子很堅固。
２．這個箱子不太牢固。
### 意思
堅固的
### 常見搭配
● sturdy shoes — 耐穿的鞋
○ a sturdy frame — 堅固的框架`);
  assert.equal(cards.length, 1);
  assert.equal(cards[0].en.length, 2);
  assert.equal(cards[0].zh.length, 2);
  assert.equal(cards[0].collocations.length, 2);
});

test('headings in other shapes: numbered, bold, IPA inline, IPA under the word', () => {
  const text = `## 1. Sturdy (adj.) ★★★
音標：/ˈstɝː.di/
1. The shelf is sturdy.
2. She wore sturdy boots.
### 中文翻譯
1. 這個架子很堅固。
2. 她穿著耐穿的靴子。
### 意思
堅固的
---
**Frail** /freɪl/ ★★
1. The old man looked frail.
2. A frail branch snapped.
中文翻譯
1. 那位老人看起來很虛弱。
2. 一根脆弱的樹枝斷了。
意思: 虛弱的、脆弱的`;
  const { cards, warnings, errors } = parseVocab(text);
  assert.deepEqual(errors, []);
  assert.deepEqual(warnings, []);
  assert.deepEqual(cards.map((c) => c.word), ['sturdy', 'frail']);
  assert.equal(cards[0].ipa, '/ˈstɝː.di/');
  assert.equal(cards[1].ipa, '/freɪl/');
});

test('a sentence mistaken for a word is flagged', () => {
  const { warnings } = parseVocab(`## This is clearly not a single vocabulary word at all ★★★
1. Example sentence number one is here.
2. Example sentence number two is here.
### 中文翻譯
1. 範例一。
2. 範例二。
### 意思
不是單字`);
  assert.ok(warnings.some((w) => w.msgs.some((m) => m.includes('單字名稱看起來不對'))));
});

test('NUL characters from unmapped glyphs are stripped by the parser itself', () => {
  assert.ok(!parseVocab('# x\nEN: A \u0000 b.\nZH: 甲\u0000乙。\n意思: 丙').cards[0].en[0].includes('\u0000'));
});
