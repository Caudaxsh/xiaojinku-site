import test from 'node:test';
import assert from 'node:assert/strict';
import { fixGlyphs, hasPdfHeader, explain, formatDiag } from '../js/pdf.js';
import { parseVocab } from '../js/parser.js';

const fresh = () => ({ restored: 0, missing: 0, missingAt: [], tofu: 0 });

test('NUL at the start of a line or after a colon is a circled list number', () => {
  const s = fresh();
  assert.equal(fixGlyphs('\u0000第一個意思', s), '①第一個意思');
  assert.equal(fixGlyphs('兩個意思：\u0000甲；\u0000乙', s), '兩個意思：①甲；②乙');
  assert.equal(s.restored, 3);
  assert.equal(s.missing, 0);
});

test('a lone NUL in the middle of a sentence is a missing character, not a number', () => {
  const s = fresh();
  const out = fixGlyphs('- nearly extinct — \u0000臨滅絕的', s);
  assert.equal(out, '- nearly extinct — □臨滅絕的');
  assert.equal(s.restored, 0);
  assert.equal(s.missing, 1);
  assert.match(s.missingAt[0], /nearly extinct/);
});

test('control characters are dropped, replacement characters are counted', () => {
  const s = fresh();
  assert.equal(fixGlyphs('a\u0003b�c', s), 'ab�c');
  assert.equal(s.tofu, 1);
});

test('PDF header is found even after a little junk, and plain text is not a PDF', () => {
  const enc = (t) => new TextEncoder().encode(t);
  assert.equal(hasPdfHeader(enc('%PDF-1.7\n...')), true);
  assert.equal(hasPdfHeader(enc('\n\n  junk %PDF-1.4')), true);
  assert.equal(hasPdfHeader(enc('hello world')), false);
  assert.equal(hasPdfHeader(new Uint8Array(0)), false);
});

test('every failure kind has a user-facing explanation, and diagnostics list each attempt', () => {
  for (const k of ['password', 'invalid', 'empty', 'engine']) assert.ok(explain(k).length > 10, k);
  const text = formatDiag({ file: { name: 'a.pdf', size: 10, type: '' }, tries: [{ step: 'direct', ok: false, error: 'Error: boom', ms: 5 }] }, '結果：x');
  assert.match(text, /a\.pdf/);
  assert.match(text, /direct: 失敗 Error: boom/);
});

// The "markdown typeset into a PDF" layout (headings written out as "## word ★★★★", "###" sections, "---" rules).
const MARKDOWN_PDF = `## lantern ★★★★
音標：/ˈlæn.tɚn/
1. She hung a paper lantern outside the window.
2. The festival ends when everyone releases a lantern into the sky.
### 中文翻譯
1. 她在窗外掛了一盞紙燈籠。
2. 大家把燈籠放上天空，慶典就結束了。
### 意思
燈籠
### 常見搭配
- paper lantern — 紙燈籠
- light a lantern — 點燈籠
### 易混淆比較
- lantern — 有罩子的提燈
- lamp — 一般的燈
### 詞性變化
- lantern (n.) — 燈籠
### 拆解記憶
lantern 看起來像 lamp + turn，轉動提燈。
### 最快記法：lantern = 會發光的紙籠子。
---
## harbor ★★★
音標：/ˈhɑːr.bɚ/
1. Fishing boats returned to the harbor before the storm.
2. The city built a new harbor for cruise ships.
### 中文翻譯
1. 漁船在暴風雨前回到港口。
2. 這座城市為郵輪興建了新港口。
### 意思
港口
### 常見搭配
- a safe harbor — 避風港
- harbor a grudge — 懷恨在心
### 最快記法：harbor = 船停靠的地方。`;

test('markdown-style PDF text: each "## word ★★★" starts a card with all sections', () => {
  const { cards, warnings } = parseVocab(MARKDOWN_PDF);
  assert.equal(cards.length, 2);
  assert.deepEqual(cards.map((c) => c.word), ['lantern', 'harbor']);
  assert.deepEqual(cards.map((c) => c.aiStars), [4, 3]);
  const [a, b] = cards;
  assert.equal(a.en.length, 2); assert.equal(a.zh.length, 2);
  assert.equal(a.meaning, '燈籠');
  assert.equal(a.collocations.length, 2); assert.equal(a.compares.length, 1); assert.equal(a.forms.length, 1);
  assert.ok(a.memory && a.quick);
  assert.equal(b.collocations.length, 2);
  assert.deepEqual(warnings, []);
});

test('a missing-character placeholder in a collocation does not break the card', () => {
  const t = MARKDOWN_PDF.replace('light a lantern — 點燈籠', 'light a lantern — □燈籠');
  const { cards } = parseVocab(t);
  assert.equal(cards[0].collocations[1].zh, '□燈籠');
});
