// Parses pasted vocabulary text into card objects.
// Accepts a strict template (EN:/ZH:/意思:/搭配:/記憶:) and the looser
// "ChatGPT style" layout (heading, numbered sentences, 中文翻譯, 常見搭配 ...).

const CJK = /[㐀-鿿豈-﫿]/;
const DECORATION = /[⭐★☆🌟✨]/gu;

const SECTIONS = {
  en: ['英文例句', '英文句子', '例句', 'english', 'examples', 'example', 'en'],
  zh: ['中文翻譯', '中文翻译', '中文例句', '例句翻譯', '例句翻译', '翻譯', '翻译', 'translation', 'translations', 'zh'],
  meaning: ['中文意思', '中文解釋', '中文解释', '意思', '釋義', '释义', '解釋', '解释', '詞義', '词义', '含義', '中文', 'meaning', 'definition'],
  collocations: ['常見搭配', '常见搭配', '常用搭配', '搭配詞', '搭配词', '搭配', '片語', '片语', '詞組', '词组', 'collocations', 'collocation', 'phrases'],
  memory: ['記憶方式', '记忆方式', '記憶方法', '记忆方法', '記憶技巧', '記憶法', '记忆法', '記憶', '记忆', '聯想', '联想', '助記', '助记', 'mnemonic', 'memory', 'tips', 'tip'],
  notes: ['注意文法', '文法', '語法', '语法', '用法', '注意', '補充', '补充', '備註', '备注', 'grammar', 'notes', 'note'],
  word: ['單字', '单字', '單詞', '单词', '詞彙', 'word', 'vocab'],
};

const ALIASES = Object.entries(SECTIONS)
  .flatMap(([key, list]) => list.map((alias) => ({ key, alias })))
  .sort((a, b) => b.alias.length - a.alias.length);

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const LABEL_RES = ALIASES.map(({ key, alias }) => ({
  key,
  re: new RegExp(`^${escapeRe(alias)}\\s*\\d*\\s*(?:[（(][^)）]*[)）])?\\s*(?:([:：])\\s*(.*)|$)`, 'i'),
}));

const SEPARATOR = /^(?:-{3,}|\*{3,}|_{3,}|={3,})$/;
const LIST_MARKER = /^(?:[-*•·▪◦]|\d+\s*[.)、]|[（(]\d+[)）]|[①-⑩])\s*/;

function stripMarkdown(line) {
  return line.replace(/\r/g, '').replace(/^\s*#{1,6}\s*/, '').replace(/\*\*|__|`/g, '').trim();
}

function matchLabel(text) {
  for (const { key, re } of LABEL_RES) {
    const m = text.match(re);
    if (m) return { key, colon: Boolean(m[1]), rest: (m[2] || '').trim() };
  }
  return null;
}

function cleanWord(raw) {
  let w = raw.replace(DECORATION, ' ').replace(LIST_MARKER, '').trim();
  w = w.split(/\s*[（(/\[【|—–]\s*|\s+-\s+|[:：]/)[0].trim();
  if (/^[A-Z][a-z'’-]*(?: [a-z'’-]+)*$/.test(w)) w = w.toLowerCase();
  return w;
}

export function wordKey(word) {
  return word.trim().toLowerCase().replace(/\s+/g, ' ');
}

function parseCollocation(text) {
  const t = text.trim();
  if (!t) return null;
  const m = t.match(/^(.*?)\s*(?:\s[—–-]+\s|[—–]|：|:)\s*(.+)$/);
  return m && m[1] ? { p: m[1].trim(), zh: m[2].trim() } : { p: t, zh: '' };
}

function splitBlocks(text) {
  const blocks = [];
  let cur = [];
  const flush = () => {
    if (cur.some((l) => l.trim())) blocks.push(cur);
    cur = [];
  };
  for (const raw of text.split('\n')) {
    const trimmed = raw.trim();
    if (SEPARATOR.test(trimmed)) { flush(); continue; }
    const heading = trimmed.match(/^(#{1,6})\s*\S/);
    if (heading) {
      const text = stripMarkdown(trimmed);
      const label = matchLabel(text);
      // "### 常見搭配" is a section label; "# memory" is a vocabulary word.
      const isLabel = label && (heading[1].length >= 3 || label.colon || CJK.test(text));
      if (!isLabel && cur.some((l) => l.trim())) flush();
    }
    cur.push(raw);
  }
  flush();
  return blocks;
}

function parseBlock(lines) {
  const rows = lines.map(stripMarkdown).filter(Boolean);
  if (!rows.length) return null;

  let word = '';
  let start = 0;
  const first = matchLabel(rows[0]);
  if (!first || !first.colon) {
    word = cleanWord(rows[0]);
  } else if (first.key === 'word' && first.rest) {
    word = cleanWord(first.rest);
  } else {
    return { error: '找不到單字（區塊第一行需要是單字）', snippet: rows[0].slice(0, 40) };
  }
  start = 1;

  const card = { word, en: [], zh: [], meaning: '', collocations: [], memory: '', notes: '' };
  const wordColon = new RegExp(`^${escapeRe(word)}\\s*[:：]\\s*(.*)$`, 'i');
  let state = 'en';

  const addSentence = (text) => {
    const t = text.trim();
    if (!t) return;
    (CJK.test(t) ? card.zh : card.en).push(t);
  };
  const addText = (key, text) => {
    const t = text.trim();
    if (!t) return;
    card[key] = card[key] ? `${card[key]}\n${t}` : t;
  };
  const addCollocations = (text) => {
    text.split(/\s*\|\s*/).forEach((part) => {
      const c = parseCollocation(part);
      if (c) card.collocations.push(c);
    });
  };
  const feed = (key, text) => {
    if (key === 'en' || key === 'zh') addSentence(text);
    else if (key === 'collocations') addCollocations(text);
    else if (key === 'meaning') addText('meaning', text);
    else if (key === 'memory' || key === 'notes') addText(key, text);
  };

  for (let i = start; i < rows.length; i++) {
    const row = rows[i];
    const label = matchLabel(row);
    if (label && label.key !== 'word') {
      state = label.key;
      if (label.rest) feed(state, label.rest);
      continue;
    }
    const wc = row.match(wordColon);
    if (wc && state !== 'collocations') {
      state = 'meaning';
      feed('meaning', wc[1]);
      continue;
    }
    feed(state, row.replace(LIST_MARKER, ''));
  }

  card.meaning = card.meaning.replace(/\n+/g, '；');
  return { card };
}

export function parseVocab(text) {
  const result = { cards: [], warnings: [], errors: [] };
  const seen = new Set();
  for (const block of splitBlocks(String(text || '').replace(/\r\n?/g, '\n'))) {
    const parsed = parseBlock(block);
    if (!parsed) continue;
    if (parsed.error) { result.errors.push(parsed); continue; }
    const { card } = parsed;
    if (!card.word) { result.errors.push({ error: '單字是空的' }); continue; }
    const key = wordKey(card.word);
    if (seen.has(key)) {
      result.warnings.push({ word: card.word, msgs: ['同一批裡重複出現，已略過後面這筆'] });
      continue;
    }
    seen.add(key);
    const msgs = [];
    if (!card.en.length) msgs.push('沒有英文例句');
    if (!card.zh.length) msgs.push('沒有中文翻譯');
    if (card.en.length && card.zh.length && card.en.length !== card.zh.length) {
      msgs.push(`英文例句 ${card.en.length} 句、翻譯 ${card.zh.length} 句，數量不一致`);
    }
    if (!card.meaning) msgs.push('沒有中文意思');
    if (msgs.length) result.warnings.push({ word: card.word, msgs });
    result.cards.push(card);
  }
  return result;
}

export const AI_PROMPT = `請幫我整理下面的英文單字，每個單字都用「完全相同」的格式輸出，不要加任何其他說明文字。
每個單字之間用一行 --- 分隔。格式如下：

# 單字（小寫原形）
EN: 英文例句 1（自然、口語、日常或職場可用）
EN: 英文例句 2
ZH: 例句 1 的繁體中文翻譯
ZH: 例句 2 的繁體中文翻譯
意思: 單字的繁體中文意思（多個意思用「；」分隔，並標註詞性）
搭配:
- 常見搭配 1 — 中文意思
- 常見搭配 2 — 中文意思
- 常見搭配 3 — 中文意思
記憶: 一個好記的方式（字根、諧音、聯想或情境）
---

要整理的單字：
`;
