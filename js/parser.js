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
  compare: ['易混淆字比較', '易混淆比較', '相近字比較', '相似字比較', '易混淆字', '易混淆', '比較', '比较', '辨析', '差異', '差异', '區別', '区别', 'comparison', 'compare'],
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
const LIST_MARKER = /^(?:[-*•·▪◦●○■◆◇▸▶➤‣◉–]|\d+\s*[.)、]|[（(]\d+[)）]|[①-⑩])\s*/;
const IPA_RE = /([/[])([^/\]\n]{1,40})[/\]]/;

const FULLWIDTH_DIGITS = /[０-９]/g;

/** Make text from different PDF tools look alike before any parsing. */
export function normalizeText(input) {
  return String(input || '')
    .replace(/\r\n?|\u2028|\u2029/g, '\n')
    .replace(/\u0000/g, '')
    .replace(/[\u200b-\u200d\u2060\ufeff\u00ad]/g, '')
    .replace(/[\u00a0\u1680\u2000-\u200a\u202f\u205f\u3000]/g, ' ')
    .replace(FULLWIDTH_DIGITS, (d) => String.fromCharCode(d.charCodeAt(0) - 0xfee0))
    .replace(/^([ \t]*\d+)[．。][ \t]*/gm, '$1. ')
    .replace(/＃/g, '#')
    .replace(/[ \t]+$/gm, '')
    .replace(/([.!?。！？」”)])[ \t]*(#{2,6})[ \t]*(?=[^\s#])/g, '$1\n$2 ');
}

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
  // A list item such as "- other — 另一個字的差別" is content, never a title.
  if (LIST_MARKER.test(t) || /[—–]/.test(t)) return null;
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

const POS_TAIL = /\s*[（(](?:n|v|vt|vi|adj|adv|prep|phr|phrasal|conj|pron|int|idiom)\b[^)）]*[)）]\s*$/i;

function cleanWord(raw) {
  let w = raw.replace(STARS, ' ').replace(/[☆✨]/g, ' ').replace(LIST_MARKER, '').replace(IPA_RE, ' ').trim();
  // Keep placeholders such as "base (something) on"; only cut at real separators.
  w = w.split(/\s*[[【|—–]\s*|\s+-\s+|[:：]/)[0].replace(POS_TAIL, '').trim().replace(/\s+/g, ' ');
  if (/^[A-Z][a-z'’-]*(?:\s+[a-z()（）'’-]+)*$/.test(w)) w = w.toLowerCase();
  return w;
}

export function wordKey(word) {
  return word.trim().toLowerCase().replace(/\s+/g, ' ');
}

const IPA_ONLY = /^[/[][^/\]\n]{1,40}[/\]]$/;

function parsePair(text) {
  const t = text.trim();
  if (!t) return null;
  const m = t.match(/^(.*?)\s*(?:\s[—–-]+\s|[—–]+|：|:)\s*(.+)$/);
  return m && m[1] ? { p: m[1].trim(), zh: m[2].trim() } : { p: t, zh: '' };
}

/** "Base something on something：以…" → "以…" (drops an English lead-in before the colon). */
function dropLatinLead(text) {
  const m = text.match(/^[A-Za-z][A-Za-z ()'’.,/-]{0,60}[:：]\s*(.+)$/);
  return m ? m[1] : text;
}

const bulletize = (row) => row.replace(/^[-*•·▪◦]\s*/, '• ');

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
  // An IPA line written just above a headword belongs to that next word.
  const takeTrailingIpa = () => {
    for (let k = cur.length - 1; k >= 0; k--) {
      const t = cur[k].trim();
      if (!t) continue;
      return IPA_ONLY.test(stripMarkdown(t)) ? cur.splice(k)[0] : null;
    }
    return null;
  };

  lines.forEach((raw, i) => {
    const trimmed = raw.trim();
    if (SEPARATOR.test(trimmed)) { flush(); return; }
    const text = stripMarkdown(trimmed);
    const heading = trimmed.match(/^(#{1,6})\s*\S/);
    let startsWord = false;
    if (heading) {
      const label = matchLabel(text);
      // "### 常見搭配" or "## 中文翻譯" are sections; "# memory" or "## Lovely ★★★" are words.
      const labelLike = label && (label.colon || CJK.test(text));
      startsWord = isStarHeading(text)
        || (heading[1].length <= 2 && !CJK.test(text) && !labelLike && !compareTitle(text));
    } else {
      startsWord = isStarHeading(text) || (started() && isBareHeading(text, nextLine(i)));
    }
    if (startsWord) {
      const ipa = takeTrailingIpa();
      flush();
      cur.push(raw);
      if (ipa) cur.push(ipa);
      return;
    }
    cur.push(raw);
  });
  flush();
  return blocks;
}

function parseBlock(lines) {
  const rows = lines
    .map((raw) => ({ text: stripMarkdown(raw), level: (raw.trim().match(/^#{1,6}/) || [''])[0].length }))
    .filter((r) => r.text);
  if (!rows.length) return null;

  const head = rows[0].text;
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
    meaningMore: '',
    collocations: [],
    forms: [],
    compares: [],
    memory: '',
    quick: '',
    synonyms: '',
    notes: '',
    extras: [],
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
  /** A list row ("x — 中文") becomes a pair; a loose explanatory sentence becomes a note. */
  const pairOrNote = (row, plain) => {
    const isItem = LIST_MARKER.test(row);
    const pair = parsePair(plain);
    if (!pair) return null;
    if (!isItem && (!pair.zh || CJK.test(pair.p))) return { note: plain };
    return pair;
  };
  const feed = (key, row) => {
    const plain = row.replace(LIST_MARKER, '').trim();
    if (!plain) return;
    if (key === 'en' || key === 'zh') (CJK.test(plain) ? card.zh : card.en).push(plain);
    else if (key === 'collocations' || key === 'forms') {
      plain.split(/\s*\|\s*/).map((part) => pairOrNote(row, part)).filter(Boolean).forEach((x) => card[key].push(x));
    } else if (key === 'compare') {
      const x = pairOrNote(row, plain);
      if (x) currentCompare().items.push(x);
    } else if (key === 'extra') {
      const ex = card.extras[card.extras.length - 1];
      ex.text = ex.text ? `${ex.text}\n${bulletize(row)}` : bulletize(row);
    } else if (key === 'meaning') addText('meaning', LIST_MARKER.test(row) ? `• ${plain}` : plain);
    else addText(key, bulletize(row));
  };

  for (const { text: row, level } of rows.slice(1)) {
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
    if (level >= 2) {
      // A heading we do not know ("### 科技領域特別常見的用法") becomes its own section.
      state = 'extra';
      card.extras.push({ title: stripLead(row), text: '' });
      continue;
    }
    const plain = row.replace(LIST_MARKER, '');
    if (state === 'en' && !card.en.length && IPA_ONLY.test(plain)) {
      card.ipa = plain;
      continue;
    }
    const wc = plain.match(wordColon);
    if (wc && ['en', 'zh', 'meaning'].includes(state)) {
      state = 'meaning';
      feed('meaning', wc[1]);
      continue;
    }
    // After the translations, an unnumbered Chinese paragraph is the word's meaning.
    if (state === 'zh' && !LIST_MARKER.test(row) && CJK.test(plain) && card.en.length && card.zh.length >= card.en.length) {
      state = 'meaning';
      feed('meaning', dropLatinLead(plain));
      continue;
    }
    feed(state, state === 'memory' || state === 'quick' ? stripLead(row) || row : row);
  }

  const meaningLines = card.meaning.split('\n').filter(Boolean);
  card.meaning = (meaningLines[0] || '').replace(/^• /, '');
  card.meaningMore = meaningLines.slice(1).join('\n');
  if (!card.meaning) {
    const key = wordKey(word);
    const form = card.forms.find((f) => f.p && wordKey(f.p).startsWith(key) && f.zh);
    const cmp = card.compares.flatMap((c) => c.items).find((x) => x.p && wordKey(x.p) === key && x.zh);
    card.meaning = (form || cmp || {}).zh || '';
  }
  card.compares = card.compares.filter((c) => c.items.length);
  card.extras = card.extras.filter((x) => x.text);
  if (!card.en.length && !card.zh.length && !card.meaning && !card.collocations.length) {
    return { error: '這一段看不出是單字內容', snippet: head.slice(0, 40) };
  }
  return { card };
}

export function parseVocab(text) {
  const result = { cards: [], warnings: [], errors: [], ignored: [] };
  const seen = new Set();
  const clean = normalizeText(text);
  for (const block of splitBlocks(clean)) {
    const parsed = parseBlock(block);
    if (!parsed) continue;
    if (parsed.error) {
      // Text before the first word (a PDF title, "Week 3 notes") is not a mistake.
      (result.cards.length ? result.errors : result.ignored).push(parsed);
      continue;
    }
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
    const tokens = card.word.split(/\s+/).length;
    if (tokens > 5 || card.word.length > 40 || CJK.test(card.word)) {
      msgs.push('單字名稱看起來不對，可能把句子或標題當成單字了');
    }
    if (msgs.length) result.warnings.push({ word: card.word, msgs });
    result.cards.push(card);
  }
  return result;
}

// One card, written exactly as the app reads it best. Used by both prompts below.
export const CARD_TEMPLATE = `## Flagship ★★★★
音標：/ˈflæɡ.ʃɪp/
1. This is the company's flagship smartphone, with its most advanced features.
2. The brand opened a new flagship store in Taipei.
### 中文翻譯
1. 這是該公司的旗艦智慧型手機，搭載了最先進的功能。
2. 這個品牌在台北開了一間新的旗艦店。
### 意思
旗艦；旗艦級的
- （n.）品牌最具代表性、定位最高階的產品、店面或計畫
- （adj.）旗艦級的，最頂級的
### 常見搭配
- flagship product — 旗艦產品、主打產品
- flagship store — 旗艦店
- flagship model — 旗艦機型
- flagship program — 核心計畫、代表性計畫
- flagship university — 具代表性的核心大學
### 易混淆比較
- flagship — 品牌最具代表性、通常技術或定位最高階的產品
- premium — 高級的、高價位的，不一定是品牌最高階
- mainstream — 主流的，面向大多數消費者
### 詞性變化
- flagship (n.) — 旗艦
- flagship (adj.) — 旗艦級的
- flagship-level (adj.) — 旗艦級的
### 拆解記憶
flag（旗幟）＋ ship（船）＝ flagship（旗艦）
原本指艦隊中懸掛指揮官旗幟的主力艦，後來引申為品牌中最具代表性的產品。
### 最快記法：Flagship = 品牌拿來當門面的代表作
---`;

const CONTENT_RULES = `【內容規則】
1. 單字標題：英文單字寫小寫原形。片語照原樣寫，可替換的部分用括號，例如 base (something) on。標題後面接 1–5 顆「★」，代表這個字在日常與職場口說的實用程度（5 最高）。
2. 音標：Cambridge 字典的美式音標，寫成「音標：/…/」，放在標題的下一行。
3. 英文例句：剛好 2 句，各占一行，用 1. 2. 編號。自然、口語、日常或職場可用，長度約 8–20 個字，一定要包含這個單字（可以是變化形態）；片語要完整出現。每句寫成一行，不要自己在句子中間換行。
4. 中文翻譯：剛好 2 句，順序和英文例句一一對應，用 1. 2. 編號。
5. 意思：第一行只寫最核心的中文意思，不超過 20 個字，結尾不要加句號，多個意思用「、」或「；」隔開。如果想補充（其他詞性的意思、用法情境），每點一行，用「- 」開頭。
6. 常見搭配：5–8 項，每項一行：「- 英文搭配 — 中文意思」，中間用破折號「—」。
7. 易混淆比較（沒有容易混淆的字就整段省略）：每項「- 單字 — 差別說明」，要包含這個字本身。
8. 詞性變化：每項「- 單字 (詞性) — 中文」，詞性只寫 n. v. adj. adv. 這幾種。
9. 拆解記憶：字根、拆解或聯想，1–3 行。有公式時用「＋」「＝」連接。
10. 最快記法：寫成「### 最快記法：」後面直接接一句話。需要補充時，下面每點一行，用「- 」開頭。
11. 想補充別的內容時，可以自己新增「### 標題」段落，放在「最快記法」之前。
12. 全程不要使用 ①②③ 這類圓圈數字，也不要用 emoji；列點一律用「- 」，星星一律用「★」。`;

const FOOTER = `
【我的單字清單】
（照這個順序，一個都不要漏，也不要自己加字）
`;

export const AI_PROMPT_PDF = `你要幫我製作「英文單字卡 PDF」。我會在最後列出單字，請為每個單字各做一張卡，全部放進同一個 PDF。
這個 PDF 會由我的網頁 App 用程式讀取，所以格式必須完全照下面做。

【PDF 規格】
1. A4 直式、單欄、純文字。字型必須完整顯示繁體中文和音標符號；如果有字變成空白或方塊，請換字型再做。特別留意罕用漢字（例如「瀕」「闢」「鬱」「讚」）：字型沒有這個字時，PDF 會留下空白，App 讀不到，請改用常用的說法。
2. 不要頁首、頁尾、頁碼、浮水印、封面、目錄、圖片、表格、色塊。
3. 下面範例裡的 ##、###、「- 」這些符號，要「原樣印在 PDF 上」，不要轉成粗體、大標題或圓點。
4. 單字之間空一行，並單獨用一行寫 ---。單字順序和我的清單完全一樣。
5. 一個 PDF 最多 50 個單字，超過就拆成多個 PDF。
6. 做完後請自己檢查：把 PDF 的文字讀出來，確認單字數量和清單一致、沒有空白方塊或亂碼，有問題先修好再交給我。PDF 必須是可選取文字的 PDF（不是把頁面拍成圖片），也不要設定密碼。
7. 除了 PDF，只回覆一句「完成，共 N 個單字」，不要其他說明。

【每個單字的格式】（標題文字一律照範例，不要改字、不要換順序）
${CARD_TEMPLATE}

${CONTENT_RULES}
${FOOTER}`;

export const AI_PROMPT_TEXT = `請幫我把下面的英文單字，各做成一張單字卡。這段文字會由我的網頁 App 用程式讀取，所以格式必須完全照下面做。

【輸出規格】
1. 直接在對話裡輸出純文字，不要放進程式碼區塊，不要開場白、結語或任何說明。
2. 下面範例裡的 ##、###、「- 」符號要原樣輸出。
3. 單字之間空一行，並單獨用一行寫 ---。單字順序和我的清單完全一樣。
4. 一次最多 50 個單字。

【每個單字的格式】（標題文字一律照範例，不要改字、不要換順序）
${CARD_TEMPLATE}

${CONTENT_RULES}
${FOOTER}`;

export const AI_PROMPT = AI_PROMPT_TEXT;
