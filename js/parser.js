// Parses pasted (or PDF-extracted) vocabulary text into card objects.
// Understands a strict template (EN:/ZH:/意思:/搭配: ...) as well as the free
// ChatGPT layout: "Word ⭐⭐⭐⭐", two English sentences, 中文翻譯, 常見搭配,
// "A vs. B" comparisons, 詞性變化, 🧩 拆解記憶, 🧠 最快記法 ...
// Words may be separated by "---", markdown headings, or simply by the next
// "Word ⭐⭐⭐" heading line (which is what a PDF export usually looks like).

const CJK = /[㐀-鿿豈-﫿]/;
const STARS = /[⭐★🌟]/gu;
const LEAD_SYMBOLS = /^[\p{Extended_Pictographic}️‍☀-➿\s]+/u;

const SECTIONS = {
  en: ['英文例句', '英文句子', '例句', 'english', 'examples', 'example', 'en'],
  zh: ['中文翻譯', '中文翻译', '中文例句', '例句翻譯', '例句翻译', '翻譯', '翻译', 'translation', 'translations', 'zh'],
  meaning: ['中文意思', '中文解釋', '中文解释', '意思', '釋義', '释义', '解釋', '解释', '詞義', '词义', '含義', '含义', '定義', '中文', 'meaning', 'definition'],
  collocations: ['常見搭配', '常见搭配', '常用搭配', '搭配詞', '搭配词', '常見片語', '搭配', '片語', '片语', '詞組', '词组', 'collocations', 'collocation', 'phrases'],
  forms: ['詞性變化', '词性变化', '詞形變化', '词形变化', '詞類變化', '字形變化', '衍生詞', '衍生词', '相關詞', '相关词', '詞性', '词性', 'word forms', 'forms'],
  compare: ['易混淆字', '易混淆', '比較', '比较', '辨析', '差異', '差异', '區別', '区别', 'comparison', 'compare'],
  memory: ['拆解記憶', '拆解记忆', '記憶方式', '记忆方式', '記憶方法', '记忆方法', '記憶技巧', '字根記憶', '記憶法', '记忆法', '字根', '字源', '拆解', '記憶', '记忆', '聯想', '联想', '助記', '助记', 'mnemonic', 'memory', 'etymology'],
  quick: ['最快記法', '最快记法', '快速記法', '快速記憶', '一句話記', '一句话记', '速記', '速记', '口訣', '口诀', 'quick tip'],
  synonyms: ['同反義詞', '同義詞', '同义词', '近義詞', '近义词', '反義詞', '反义词', 'synonyms', 'synonym', 'antonyms'],
  notes: ['注意文法', '文法', '語法', '语法', '用法', '注意', '補充', '补充', '備註', '备注', 'grammar', 'notes', 'note', 'tips', 'tip'],
  ipa: ['kk音標', '音標', '音标', '發音', '发音', 'ipa', 'pronunciation'],
  word: ['單字', '单字', '單詞', '单词', '詞彙', 'word', 'vocab'],
};

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const LABEL_RES = Object.entries(SECTIONS)
  .flatMap(([key, list]) => list.map((alias) => ({ key, alias })))
  .sort((a, b) => b.alias.length - a.alias.length)
  .map(({ key, alias }) => ({
    key,
    re: new RegExp(`^${escapeRe(alias)}\\s*\\d*\\s*(?:[（(][^)）]*[)）])?\\s*(?:([:：])\\s*(.*)|$)`, 'i'),
  }));

const SEPARATOR = /^(?:-{3,}|\*{3,}|_{3,}|={3,}|—{2,})$/;
const LIST_MARKER = /^(?:[-*•·▪◦]|\d+\s*[.)、]|[（(]\d+[)）]|[①-⑩])\s*/;
const IPA_RE = /([/[])([^/\]\n]{1,40})[/\]]/;

function stripMarkdown(line) {
  return line.replace(/\r/g, '').replace(/^\s*#{1,6}\s*/, '').replace(/\*\*|__|`/g, '').trim();
}

const stripLead = (text) => text.replace(LEAD_SYMBOLS, '').trim();

function matchLabel(text) {
  const t = stripLead(text);
  for (const { key, re } of LABEL_RES) {
    const m = t.match(re);
    if (m) return { key, colon: Boolean(m[1]), rest: (m[2] || '').trim() };
  }
  return null;
}

/** "Flagship vs. Premium vs. Mainstream" or "flagship 和 premium 的差別" */
function compareTitle(text) {
  const t = stripLead(text);
  if (t.length <= 100 && !CJK.test(t) && /\bvs\.?(\s|$)/i.test(t)) return t;
  if (t.length <= 40 && /(比較|比较|差異|差异|差別|差别|區別|区别|辨析)$/.test(t) && /[a-z]/i.test(t)) return t;
  return null;
}

/** "Flagship ⭐⭐⭐⭐" — an English headword decorated with rating stars. */
function isStarHeading(text) {
  if (!/[⭐★🌟]/u.test(text)) return false;
  const rest = text.replace(STARS, '').replace(IPA_RE, '').replace(/[（(][^)）]*[)）]/g, '').trim();
  return rest.length > 0 && rest.length <= 40 && /[a-z]/i.test(rest) && !CJK.test(rest);
}

const isSentence = (t) => !CJK.test(t) && /\s/.test(t) && t.length >= 15;

function stemOf(word) {
  const w = word.toLowerCase();
  return w.length > 4 ? w.replace(/(e|y)$/, '') : w;
}

/** A bare single word ("flagship") followed by an English sentence that uses it. */
function isBareHeading(text, next) {
  const t = text.trim();
  if (!/^[A-Za-z][A-Za-z'’-]{1,30}$/.test(t) || matchLabel(t)) return false;
  return Boolean(next) && isSentence(next) && next.toLowerCase().includes(stemOf(t));
}

function cleanWord(raw) {
  let w = raw.replace(STARS, ' ').replace(/[☆✨]/g, ' ').replace(LIST_MARKER, '').trim();
  w = w.replace(IPA_RE, ' ').split(/\s*[（(\[【|—–]\s*|\s+-\s+|[:：]/)[0].trim();
  if (/^[A-Z][a-z'’-]*(?: [a-z'’-]+)*$/.test(w)) w = w.toLowerCase();
  return w.replace(/\s+/g, ' ');
}

export function wordKey(word) {
  return word.trim().toLowerCase().replace(/\s+/g, ' ');
}

function parsePair(text) {
  const t = text.trim();
  if (!t) return null;
  const m = t.match(/^(.*?)\s*(?:\s[—–-]+\s|[—–]+|：|:)\s*(.+)$/);
  return m && m[1] ? { p: m[1].trim(), zh: m[2].trim() } : { p: t, zh: '' };
}

function splitBlocks(text) {
  const lines = text.split('\n');
  const blocks = [];
  let cur = [];
  const started = () => cur.some((l) => l.trim());
  const flush = () => {
    if (started()) blocks.push(cur);
    cur = [];
  };
  const nextLine = (i) => {
    for (let j = i + 1; j < lines.length; j++) {
      const t = stripMarkdown(lines[j]);
      if (t) return t;
    }
    return '';
  };

  lines.forEach((raw, i) => {
    const trimmed = raw.trim();
    if (SEPARATOR.test(trimmed)) { flush(); return; }
    const text = stripMarkdown(trimmed);
    const heading = trimmed.match(/^(#{1,6})\s*\S/);
    if (heading) {
      const label = matchLabel(text);
      // "### 常見搭配" is a section label; "# memory" is a vocabulary word.
      const isLabel = (label && (heading[1].length >= 3 || label.colon || CJK.test(text))) || compareTitle(text);
      if (!isLabel) flush();
    } else if (started() && (isStarHeading(text) || isBareHeading(text, nextLine(i)))) {
      flush();
    }
    cur.push(raw);
  });
  flush();
  return blocks;
}

function parseBlock(lines) {
  const rows = lines.map(stripMarkdown).filter(Boolean);
  if (!rows.length) return null;

  const head = rows[0];
  const first = matchLabel(head);
  let word;
  if (!first || !first.colon) word = cleanWord(head);
  else if (first.key === 'word' && first.rest) word = cleanWord(first.rest);
  else return { error: '找不到單字（每個單字的第一行要是單字本身）', snippet: head.slice(0, 40) };

  const card = {
    word,
    ipa: (head.match(IPA_RE) || [])[0] || '',
    aiStars: (head.match(STARS) || []).length,
    en: [],
    zh: [],
    meaning: '',
    collocations: [],
    forms: [],
    compares: [],
    memory: '',
    quick: '',
    synonyms: '',
    notes: '',
  };
  const wordColon = new RegExp(`^${escapeRe(word)}\\s*[:：]\\s*(.*)$`, 'i');
  let state = 'en';

  const addText = (key, text) => {
    const t = text.trim();
    if (t) card[key] = card[key] ? `${card[key]}\n${t}` : t;
  };
  const currentCompare = () => {
    if (!card.compares.length) card.compares.push({ title: '', items: [] });
    return card.compares[card.compares.length - 1];
  };
  const feed = (key, text) => {
    const t = text.trim();
    if (!t) return;
    if (key === 'en' || key === 'zh') (CJK.test(t) ? card.zh : card.en).push(t);
    else if (key === 'collocations' || key === 'forms') {
      t.split(/\s*\|\s*/).map(parsePair).filter(Boolean).forEach((x) => card[key].push(x));
    } else if (key === 'compare') {
      const pair = parsePair(t);
      if (pair) currentCompare().items.push(pair);
    } else addText(key, t);
  };

  for (const row of rows.slice(1)) {
    const title = compareTitle(row);
    if (title) {
      state = 'compare';
      card.compares.push({ title, items: [] });
      continue;
    }
    const label = matchLabel(row);
    if (label && label.key !== 'word') {
      if (label.key === 'ipa') {
        card.ipa = label.rest || card.ipa;
        continue;
      }
      if (label.key === 'compare') card.compares.push({ title: '', items: [] });
      state = label.key;
      if (label.rest) feed(state, label.rest);
      continue;
    }
    const plain = row.replace(LIST_MARKER, '');
    if (state === 'en' && !card.en.length && /^[/[][^/\]]+[/\]]$/.test(plain)) {
      card.ipa = plain;
      continue;
    }
    const wc = plain.match(wordColon);
    if (wc && ['en', 'zh', 'meaning'].includes(state)) {
      state = 'meaning';
      feed('meaning', wc[1]);
      continue;
    }
    feed(state, state === 'memory' || state === 'quick' ? stripLead(plain) || plain : plain);
  }

  card.meaning = card.meaning.replace(/\n+/g, '；');
  if (!card.meaning) {
    const key = wordKey(word);
    const form = card.forms.find((f) => wordKey(f.p).startsWith(key) && f.zh);
    const cmp = card.compares.flatMap((c) => c.items).find((x) => wordKey(x.p) === key && x.zh);
    card.meaning = (form || cmp || {}).zh || '';
  }
  card.compares = card.compares.filter((c) => c.items.length);
  if (!card.en.length && !card.zh.length && !card.meaning && !card.collocations.length) {
    return { error: '這一段看不出是單字內容', snippet: head.slice(0, 40) };
  }
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

export const AI_PROMPT = `請把我最後列出的英文單字，各自整理成一張單字卡，說明一律用繁體中文。
請「完全照下面這個範例的結構」輸出，每個單字之間用一行 --- 分隔，不要加任何開場白、結語或多餘說明。
⭐ 的數量（1–5 顆）代表這個字在日常與職場口說中的實用程度。
如果這個字沒有容易混淆的字，就省略「A vs. B」那一段。

範例：
Flagship ⭐⭐⭐⭐
音標: /ˈflæɡ.ʃɪp/
This is the company's flagship smartphone, with its most advanced features.
The brand opened a new flagship store in Taipei.
中文翻譯
這是該公司的旗艦智慧型手機，搭載了最先進的功能。
這個品牌在台北開了一間新的旗艦店。
意思: （n. / adj.）旗艦；旗艦級的、最具代表性的
常見搭配
flagship product — 旗艦產品、主打產品
flagship store — 旗艦店
flagship model — 旗艦機型
Flagship vs. Premium vs. Mainstream
flagship：品牌最具代表性、通常技術或定位最高階的產品。
premium：高級的、高品質或高價位的，不一定是品牌最高階。
mainstream：主流的，面向大多數消費者。
詞性變化
flagship（n. / adj.）— 旗艦；旗艦級的
flagship-level（adj.）— 旗艦級的
🧩 拆解記憶
flag（旗幟）＋ ship（船）＝ flagship（旗艦）
原本指艦隊中懸掛指揮官旗幟的主力艦，後來引申為品牌中最具代表性的產品。
🧠 最快記法：Flagship = 品牌拿來當門面的代表作。
---

要整理的單字：
`;
