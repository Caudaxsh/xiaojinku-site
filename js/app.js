import { parseVocab, wordKey, AI_PROMPT_PDF, AI_PROMPT_TEXT } from './parser.js';
import * as srs from './srs.js';
import { createStore } from './store.js';
import { say, unlockAudio, lookupIpa } from './audio.js';
import { icon, hydrateIcons } from './icons.js';
import { createPet } from './pet/pet.js';
import { readPackFile } from './pet/pack.js';

const APP_NAME = 'Cash Volcab';
const APP_VERSION = '2.4.0';
const DEFAULT_SETTINGS = { newPerDay: 50, autoPlay: true, pet: true, petQuiet: false };

const S = {
  store: null,
  cards: [],
  settings: { ...DEFAULT_SETTINGS },
  days: [],
  clock: srs.newClock(),
  newToday: { date: '', count: 0, bonus: 0 },
  tab: 'today',
  study: null,
  lib: { q: '', filter: 'all' },
  imp: { text: '', result: null, status: '' },
  lastImport: null,
};

const pet = createPet();
if (location.search.includes('petdebug')) window.__pet = pet;
const $ = (sel, root = document) => root.querySelector(sel);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ESC[c]);
const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const ICON_SPEAK = icon('speaker', { size: 20 });
const ICON_X = icon('close', { size: 18 });

const starsHtml = (n) => `<span class="stars" aria-label="${n} 顆星">${'★'.repeat(n)}<span class="off">${'★'.repeat(Math.max(0, 3 - n))}</span></span>`;
const cardById = (id) => S.cards.find((c) => c.id === id);

/** Two-tap confirmation that works everywhere (no browser dialog). Returns true on the second tap. */
function armed(el, text) {
  if (el.dataset.armed) return true;
  const original = el.innerHTML;
  el.dataset.armed = '1';
  el.textContent = text;
  setTimeout(() => {
    if (!el.isConnected) return;
    el.innerHTML = original;
    delete el.dataset.armed;
  }, 4000);
  return false;
}

const speakBtn = (text, kind, cls = 'mini-speak', label = '發音') =>
  `<button class="${cls}" data-act="speak" data-kind="${kind}" data-text="${esc(text)}" aria-label="${label}">${ICON_SPEAK}${cls === 'speak-big' ? '<span>發音</span>' : ''}</button>`;

const stemPattern = (w) => `${escRe(w.length > 4 ? w.replace(/(e|y)$/i, '') : w)}[a-z]*`;

/** Mark the word in a sentence, including inflections and split phrases ("based our decision on"). */
function highlight(sentence, word) {
  const safe = esc(sentence);
  const tokens = word.replace(/[（(][^)）]*[)）]/g, ' ').trim().split(/\s+/).filter(Boolean);
  if (!tokens.length) return safe;
  const pattern = tokens
    .map((t, i) => (i === 0 ? stemPattern(t) : `${escRe(esc(t))}\\b`))
    .join(String.raw`(?:\s+[^\s<]+){0,4}?\s+`);
  return safe.replace(new RegExp(`\\b(${pattern})`, 'gi'), '<b class="hit">$1</b>');
}

/** Words such as "base (something) on" are spoken without the placeholder brackets. */
const spoken = (word) => word.replace(/[（(]([^)）]*)[)）]/g, '$1').replace(/\s+/g, ' ').trim();

/** Long meanings: the first sentence is the headline, the rest is supporting detail. */
function meaningHtml(meaning, more = '') {
  if (!meaning) return '';
  const extra = more ? `<div class="meaning-extra">${textBlock(more, 'meaning-more')}</div>` : '';
  return meaningHead(meaning) + extra;
}

function meaningHead(meaning) {
  // "兩個意思：① …；② …" reads best as a short numbered list.
  if (/[①-⑩]/.test(meaning)) {
    const [lead, ...items] = meaning.split(/(?=[①-⑩])/);
    const list = (lead.match(/^[①-⑩]/) ? [lead, ...items] : items).map((x) => x.replace(/[；;，,\s]+$/, ''));
    const intro = lead.match(/^[①-⑩]/) ? '' : lead.trim();
    return `${intro ? `<p class="meaning-more">${esc(intro)}</p>` : ''}<ol class="meaning-list">${list.map((x) => `<li>${esc(x)}</li>`).join('')}</ol>`;
  }
  const cut = meaning.indexOf('。');
  const core = cut > 0 && cut < meaning.length - 1 ? meaning.slice(0, cut + 1) : meaning;
  const rest = core === meaning ? '' : meaning.slice(cut + 1).trim();
  const size = core.length > 34 ? ' long' : '';
  return `<p class="meaning${size}">${esc(core)}</p>${rest ? `<p class="meaning-more">${esc(rest)}</p>` : ''}`;
}

/** Multi-line text: "• " lines become a list, formula lines (a + b → c) get their own style. */
function textBlock(text, cls = 'memo') {
  const out = [];
  let list = [];
  const flushList = () => {
    if (list.length) out.push(`<ul class="bullets">${list.map((l) => `<li>${esc(l)}</li>`).join('')}</ul>`);
    list = [];
  };
  for (const line of text.split('\n').filter(Boolean)) {
    if (line.startsWith('• ')) { list.push(line.slice(2)); continue; }
    flushList();
    const formula = /[＋+]/.test(line) && /[＝=→]/.test(line) && line.length < 60;
    out.push(`<p class="${formula ? 'formula' : cls}">${esc(line)}</p>`);
  }
  flushList();
  return out.join('');
}

const rowHtml = (x, inner) => (x.note ? `<li class="row-note">${esc(x.note)}</li>` : inner);

function toast(message) {
  const el = $('#toast');
  el.textContent = message;
  el.classList.add('show');
  clearTimeout(toast.t);
  toast.t = setTimeout(() => el.classList.remove('show'), 2600);
}

/* ------------------------------------------------------------------ data */

async function saveCards(cards) {
  const map = new Map(S.cards.map((c) => [c.id, c]));
  cards.forEach((c) => map.set(c.id, c));
  S.cards = [...map.values()];
  await S.store.putMany(cards);
}

async function saveMeta(key, value) {
  try { await S.store.setMeta(key, value); } catch { /* storage blocked: keep going in memory */ }
}

function newState() {
  const today = srs.todayStr();
  if (S.newToday.date !== today) S.newToday = { date: today, count: 0, bonus: 0 };
  return S.newToday;
}

function remainingNew() {
  const n = newState();
  return Math.max(0, S.settings.newPerDay + n.bonus - n.count);
}

/** Which study day it is right now (a day only counts once you actually study). */
const day = () => srs.currentDay(S.clock);

function counts() {
  const fresh = S.cards.filter((c) => c.status === 'new');
  return {
    total: S.cards.length,
    fresh: fresh.length,
    freshToday: Math.min(fresh.length, remainingNew()),
    due: S.cards.filter((c) => srs.isDue(c, day())).length,
    mastered: S.cards.filter((c) => c.status === 'mastered').length,
  };
}

function buildQueue() {
  const due = S.cards
    .filter((c) => srs.isDue(c, day()))
    .sort((a, b) => a.due - b.due || b.stars - a.stars);
  const fresh = S.cards
    .filter((c) => c.status === 'new')
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
    .slice(0, remainingNew());
  return [...due, ...fresh].map((c) => ({ id: c.id, retry: false }));
}

async function markDay() {
  const today = srs.todayStr();
  const ticked = srs.tickClock(S.clock, today);
  if (ticked !== S.clock) {
    S.clock = ticked;
    await saveMeta('clock', S.clock);
  }
  if (!S.days.includes(today)) {
    S.days = [...S.days, today].slice(-400);
    await saveMeta('days', S.days);
  }
}

/** 待分級 → tag, scheduled → reviewing, due today → due, finished → mastered. */
function statusIcon(card) {
  if (card.status === 'new') return 'tag';
  if (card.status === 'mastered') return 'mastered';
  return srs.isDue(card, day()) ? 'due' : 'reviewing';
}

const dueLabel = (card) => srs.dueText(card, day());

/** Normalize cards saved by an older version so every field exists. */
function upgradeCard(c, studyDay = day()) {
  const out = {
    ipa: '', aiStars: 0, forms: [], compares: [], quick: '', synonyms: '', notes: '', memory: '', meaning: '', meaningMore: '',
    collocations: [], en: [], zh: [], extras: [],
    ...c,
  };
  // Cards scheduled under earlier rules (calendar dates, longer ladders) move onto study days.
  if (out.status === 'active') {
    const ladder = srs.LADDERS[out.stars] || [];
    if (!ladder.length) Object.assign(out, { status: 'mastered', due: null, relearn: false });
    else {
      if (out.step > ladder.length - 1) out.step = ladder.length - 1;
      if (typeof out.due !== 'number') {
        const left = typeof out.due === 'string' ? Math.max(0, srs.daysBetween(srs.todayStr(), out.due)) : 0;
        out.due = studyDay + Math.min(left, ladder[out.step]);
      }
    }
  }
  return out;
}

/* ------------------------------------------------------- card back sections */

function splitPos(text) {
  const m = text.match(/^(.*?)\s*[（(]([^)）]{1,24})[)）]\s*$/);
  return m ? { head: m[1], pos: m[2] } : { head: text, pos: '' };
}

function backSections(card) {
  const out = [];
  const key = wordKey(card.word);

  if (card.zh.length || card.en.length) {
    const n = Math.max(card.zh.length, card.en.length);
    const items = Array.from({ length: n }, (_, i) => `
      <li><p class="zh">${esc(card.zh[i] || '')}</p>${card.en[i] ? `<p class="en">${esc(card.en[i])}</p>` : ''}</li>`).join('');
    out.push({ id: 'zh', label: '例句翻譯', icon: 'translate', html: `<ol class="pairs">${items}</ol>` });
  }
  if (card.collocations.length) {
    const items = card.collocations.map((x) => rowHtml(x, `
      <li data-act="speak" data-kind="sentence" data-text="${esc(x.p)}"><b>${esc(x.p)}</b><span>${esc(x.zh)}</span></li>`)).join('');
    out.push({ id: 'col', label: '常見搭配', icon: 'tag', note: '點一下可聽發音', html: `<ul class="rows">${items}</ul>` });
  }
  if (card.compares.length) {
    const html = card.compares.map((c) => `
      ${c.title ? `<h4 class="cmp-title">${esc(c.title)}</h4>` : ''}
      <ul class="cmp">${c.items.map((x) => `<li class="${wordKey(x.p) === key ? 'self' : ''}"><b>${esc(x.p)}</b><span>${esc(x.zh)}</span></li>`).join('')}</ul>`).join('');
    out.push({ id: 'cmp', label: '易混淆比較', icon: 'compare', html });
  }
  if (card.forms.length) {
    const items = card.forms.map((f) => {
      if (f.note) return rowHtml(f);
      const { head, pos } = splitPos(f.p);
      return `<li><b>${esc(head)}${pos ? `<span class="pos">${esc(pos)}</span>` : ''}</b><span>${esc(f.zh)}</span></li>`;
    }).join('');
    out.push({ id: 'forms', label: '詞性變化', icon: 'forms', html: `<ul class="rows">${items}</ul>` });
  }
  if (card.memory || card.quick) {
    const [quickHead, ...quickRest] = (card.quick || '').split('\n');
    const quick = card.quick
      ? `<div class="quick"><small>最快記法</small><p>${esc(quickHead)}</p></div>${quickRest.length ? `<div class="quick-more">${textBlock(quickRest.join('\n'))}</div>` : ''}`
      : '';
    out.push({ id: 'mem', label: '記憶方式', icon: 'root', html: textBlock(card.memory || '') + quick });
  }
  (card.extras || []).forEach((x, i) => {
    out.push({ id: `extra${i}`, label: x.title, icon: 'tip', html: textBlock(x.text) });
  });
  if (card.synonyms) out.push({ id: 'syn', label: '同義・反義', icon: 'compare', html: textBlock(card.synonyms, 'prose') });
  if (card.notes) out.push({ id: 'notes', label: '文法・補充', icon: 'tip', html: textBlock(card.notes, 'prose') });
  return out;
}

const secHead = (iconName, label, note = '') =>
  `<div class="sec-h">${icon(iconName, { size: 18 })}<h3>${label}</h3>${note ? `<small>${note}</small>` : ''}</div>`;

const sectionsHtml = (secs, prefix = 'sec') => secs.map((s) => `
  <section class="sec" id="${prefix}-${s.id}">
    ${secHead(s.icon, s.label, s.note)}
    ${s.html}
  </section>`).join('');

// The four main categories get the mosaic tiles; any other section keeps a plain tab.
const MOSAIC = ['zh', 'col', 'forms', 'mem'];
const sectionNav = (secs, prefix = 'sec') =>
  `<nav class="sec-nav" aria-label="背面段落">${secs.map((s) => `<button class="${MOSAIC.includes(s.id) ? `mosaic t-${s.id}` : 'plain'}" data-act="jump" data-to="${prefix}-${s.id}">${icon(s.icon, { size: 15 })}${s.label}</button>`).join('')}</nav>`;

/* ---------------------------------------------------------------- shell */

function setView(html) {
  const el = $('#view');
  el.innerHTML = html;
  el.classList.remove('enter');
  void el.offsetWidth;
  el.classList.add('enter');
}

function render() {
  document.body.classList.toggle('studying', Boolean(S.study));
  document.querySelectorAll('.tab').forEach((t) => {
    const on = t.dataset.tab === S.tab && !S.study;
    t.classList.toggle('active', on);
    if (on) t.setAttribute('aria-current', 'page');
    else t.removeAttribute('aria-current');
  });
  if (S.study || S.tab !== 'today') pet.detach();
  if (S.study) return renderStudy();
  if (S.tab === 'library') return renderLibrary();
  if (S.tab === 'import') return renderImport();
  if (S.tab === 'settings') return renderSettings();
  return renderToday();
}

function go(tab) {
  S.tab = tab;
  S.study = null;
  closeSheet();
  render();
  scrollTo(0, 0);
}

const isStandalone = () => navigator.standalone === true || matchMedia('(display-mode: standalone)').matches;
const isIos = () => /iphone|ipad|ipod/i.test(navigator.userAgent);
const flag = (k) => { try { return localStorage.getItem(k) === '1'; } catch { return false; } };
const setFlag = (k) => { try { localStorage.setItem(k, '1'); } catch { /* ignore */ } };

const RULES = `
  <div class="rule">${starsHtml(3)}<p><b>最重要</b>（口說必備）：第 3 個學習日再複習一次，那張卡會變成深色卡</p></div>
  <div class="rule">${starsHtml(2)}<p><b>重要</b>：下次學習時看過這一次就好</p></div>
  <div class="rule">${starsHtml(1)}<p><b>艱深少用</b>：下次學習時看過這一次就好</p></div>
  <p class="muted small" style="margin-top:8px">匯入的單字會在你「下一次開始學習」時出現。有學習的那一天才算一個學習日，哪天沒學，所有複習就整體順延。</p>`;

/* ---------------------------------------------------------------- today */

function renderToday() {
  const c = counts();
  const todayTotal = c.due + c.freshToday;
  const now = new Date();
  const showBanner = isIos() && !isStandalone() && !flag('xj-banner');

  let main;
  if (!c.total) {
    main = `
      <div class="panel empty">
        <h2>還沒有單字</h2>
        <p>到「匯入」上傳 PDF 或貼上整理好的單字。</p>
        <div class="btn-row" style="justify-content:center;margin-top:16px">
          <button class="btn primary" data-act="tab" data-tab="import">去匯入單字</button>
        </div>
      </div>`;
  } else if (!todayTotal) {
    const more = c.fresh > 0;
    main = `
      <div class="panel empty">
        <h2>今天的都完成了</h2>
        <p>${more ? `還有 ${c.fresh} 個新字排隊中。` : '沒有要複習的單字，明天見。'}</p>
        <div class="btn-row" style="justify-content:center;margin-top:16px">
          ${more ? '<button class="btn primary" data-act="more-new">再多學 10 個新字</button>' : ''}
          <button class="btn" data-act="tab" data-tab="import">匯入新單字</button>
        </div>
      </div>`;
  } else {
    main = `<button class="btn primary big on-dark" data-act="start">${icon('reviewing', { size: 20 })}開始學習・${todayTotal} 張卡片</button>`;
  }

  setView(`
    <div class="page-head hero">
      <div><p class="eyebrow">${now.getMonth() + 1} 月 ${now.getDate()} 日</p><h1>${APP_NAME}</h1></div>
      <div class="streak">${icon('trophy', { size: 22 })}<b>${srs.streak(S.days)}</b><span>連續天數</span></div>
    </div>
    <div class="tiles">
      <div class="tile ${c.freshToday ? 'hot' : ''}">${icon('today', { size: 22 })}<div class="num">${c.freshToday}</div><div class="lbl">今日新字</div></div>
      <div class="tile ${c.due ? 'hot' : ''}">${icon('due', { size: 22 })}<div class="num">${c.due}</div><div class="lbl">待複習</div></div>
      <div class="tile">${icon('mastered', { size: 22 })}<div class="num">${c.mastered}</div><div class="lbl">已學完</div></div>
    </div>
    ${main}
    ${S.lastImport && S.lastImport.date === srs.todayStr() && S.lastImport.added.length + S.lastImport.updated.length ? `
    <div class="panel note banner" style="margin-top:12px">
      <span>剛匯入 ${S.lastImport.added.length + S.lastImport.updated.length} 個單字（新增 ${S.lastImport.added.length}、更新 ${S.lastImport.updated.length}）。匯入錯了可以復原。</span>
      <button class="ic-label" data-act="undo-import">${icon('undo', { size: 16 })}復原這次匯入</button>
    </div>` : ''}
    ${showBanner ? `
    <div class="panel note banner" style="margin-top:12px">
      <span>建議先用 Safari 的「分享 → 加入主畫面」，之後都從主畫面開啟。iPhone 上主畫面 App 和 Safari 的資料是分開存的。</span>
      <button data-act="dismiss-banner">知道了</button>
    </div>` : ''}
    <div class="panel" style="margin-top:12px">
      <h2 class="ic-label">${icon('difficulty', { size: 18 })}星級複習規則</h2>
      ${RULES}
    </div>`);
  pet.attach($('#view'), todayPlatforms);
}

/**
 * Where the pet may stand on the home page: on top of the title letters, the streak,
 * each stat tile, the start button and the panels. Viewport coordinates.
 */
/** Right edge of an element's text itself (a block element's own box is as wide as its column). */
function textRight(el) {
  if (!el) return null;
  const range = document.createRange();
  range.selectNodeContents(el);
  const rects = [...range.getClientRects()];
  return rects.length ? Math.max(...rects.map((r) => r.right)) : null;
}

function todayPlatforms() {
  const out = [];
  const title = $('.page-head h1');
  if (title && title.firstChild) {
    const range = document.createRange();
    range.selectNodeContents(title);
    const r = range.getClientRects()[0];
    const size = parseFloat(getComputedStyle(title).fontSize);
    // the line box is taller than the letters: stand on the cap height, not on the leading
    if (r) out.push({ key: 'title', avoidLeft: textRight($('.eyebrow')), bottom: r.bottom, left: r.left, right: r.right, top: r.top + (r.height - size) / 2 + size * 0.17 });
  }
  const add = (el, key) => { if (!el) return; const r = el.getBoundingClientRect(); if (r.width) out.push({ key, left: r.left, right: r.right, top: r.top, bottom: r.bottom }); };
  add($('.streak'), 'streak');
  document.querySelectorAll('.tile').forEach((el, i) => add(el, `tile${i}`));
  add($('[data-act="start"]'), 'start');
  document.querySelectorAll('#view > .panel').forEach((el, i) => add(el, `panel${i}`));
  return out;
}

/* ---------------------------------------------------------------- study */

function startStudy(queue = buildQueue(), practice = false) {
  if (!queue.length) return toast('沒有要學的卡片');
  S.study = { queue, i: 0, flipped: false, practice, busy: false, stats: { again: 0, good: 0, easy: 0, newRated: { 1: 0, 2: 0, 3: 0 }, seen: 0 } };
  render();
  scrollTo(0, 0);
  onCardShown();
}

function studyEntry() {
  const st = S.study;
  const entry = st && st.queue[st.i];
  return entry ? { entry, card: cardById(entry.id) } : null;
}

const ipaTried = new Set();
function onCardShown() {
  const cur = studyEntry();
  if (!cur) return;
  const { card } = cur;
  if (S.settings.autoPlay) say(spoken(card.word), { isWord: true });
  if (!card.ipa && !ipaTried.has(card.id)) {
    ipaTried.add(card.id);
    lookupIpa(card.word).then(async (ipa) => {
      if (!ipa) return;
      await saveCards([{ ...cardById(card.id), ipa }]);
      const el = $(`[data-ipa-for="${CSS.escape(card.id)}"]`);
      if (el) el.textContent = ipa;
    });
  }
}

function renderStudy(animate = '') {
  const st = S.study;
  const cur = studyEntry();
  if (!cur) return renderDone();
  const { entry, card } = cur;
  const total = st.queue.length;
  const pct = Math.round((st.i / total) * 100);

  // A card that comes back for its follow-up review is drawn dark on the front.
  const second = !st.practice && srs.isSecondReview(card);
  const badge = st.practice
    ? '<span class="chip quiet">練習</span>'
    : entry.retry
      ? '<span class="chip quiet">再看一次</span>'
      : second
        ? `<span class="chip gold">${icon('reviewing', { size: 13 })}第 2 次複習</span>`
        : card.status === 'new' ? '<span class="chip">NEW</span>' : starsHtml(card.stars);

  let face;
  let nav = '';
  if (!st.flipped) {
    face = `
      <article class="card front ${second ? 'review2' : ''} ${animate}" id="card" data-act="flip">
        <div class="card-top">${badge}<span class="muted small">點卡片翻面</span></div>
        <div class="headword">
          <h1 class="word">${esc(card.word)}</h1>
          <p class="ipa" data-ipa-for="${esc(card.id)}">${esc(card.ipa)}</p>
          ${speakBtn(card.word, 'word', 'speak-big', '播放單字發音')}
        </div>
        <ol class="sentences">
          ${card.en.length
            ? card.en.map((s, i) => `<li data-n="${i + 1}"><span class="txt">${highlight(s, card.word)}</span>${speakBtn(s, 'sentence', 'mini-speak', '朗讀例句')}</li>`).join('')
            : '<li data-n="•" class="muted">（這個單字沒有例句）</li>'}
        </ol>
        <p class="hint">先想想意思，再點一下卡片翻面</p>
      </article>`;
  } else {
    const secs = backSections(card);
    nav = secs.length > 1 ? sectionNav(secs) : '';
    const aiHint = card.status === 'new' && card.aiStars ? `<p class="ai-hint">ChatGPT 實用度標記：${'⭐'.repeat(Math.min(card.aiStars, 5))}</p>` : '';
    face = `
      <article class="card back ${animate}" id="card">
        <div class="card-top">${badge}</div>
        <div class="back-head" style="margin-top:10px">
          <div><div class="w">${esc(card.word)}</div><p class="ipa" data-ipa-for="${esc(card.id)}">${esc(card.ipa)}</p></div>
          ${speakBtn(card.word, 'word')}
        </div>
        ${meaningHtml(card.meaning, card.meaningMore)}
        ${aiHint}
        ${sectionsHtml(secs)}
      </article>`;
  }

  setView(`
    <section class="study">
      <header class="study-top">
        <div class="top-row">
          <button class="x-btn" data-act="exit-study" aria-label="結束學習">${ICON_X}</button>
          <div class="progress" role="progressbar" aria-valuemin="0" aria-valuemax="${total}" aria-valuenow="${st.i}"><span style="width:${pct}%"></span></div>
          <span class="count">${st.i + 1} / ${total}</span>
        </div>
        ${nav}
      </header>
      ${face}
      <footer class="actionbar" id="actionbar">${actionBar()}</footer>
    </section>`);
}

function actionBar() {
  const st = S.study;
  const { entry, card } = studyEntry();
  if (!st.flipped) return '<button class="btn primary big" data-act="flip">翻面看答案</button>';

  if (st.practice || entry.retry) {
    return `
      <div class="grade-grid" style="grid-template-columns:1fr 1fr">
        <button class="grade-btn again" data-act="retry" data-again="1"><b>還沒記住</b><small>等一下再看</small></button>
        <button class="grade-btn good" data-act="retry" data-again="0"><b>${st.practice ? '下一張' : '記得了'}</b><small>${st.practice ? '不影響複習排程' : '繼續'}</small></button>
      </div>`;
  }

  if (card.status === 'new') {
    return `
      <p class="ask"><b>這個字對你的重要性？</b></p>
      <div class="pick-grid">
        <button class="pick-btn s3" data-act="rate-new" data-stars="3">${starsHtml(3)}<b>最重要</b><small>第 3 個學習日再複習</small></button>
        <button class="pick-btn" data-act="rate-new" data-stars="2">${starsHtml(2)}<b>重要</b><small>看過這次就好</small></button>
        <button class="pick-btn" data-act="rate-new" data-stars="1">${starsHtml(1)}<b>艱深少用</b><small>看過這次就好</small></button>
      </div>`;
  }

  const hint = (g) => srs.previewInterval(card, g, day());
  return `
    <div class="grade-grid">
      <button class="grade-btn again" data-act="grade" data-grade="again"><b>忘了</b><small>${hint('again')}</small></button>
      <button class="grade-btn good" data-act="grade" data-grade="good"><b>記得</b><small>${hint('good')}</small></button>
      <button class="grade-btn easy" data-act="grade" data-grade="easy"><b>很熟</b><small>${hint('easy')}</small></button>
    </div>
    <div class="adjust"><span>重要性</span>
      ${[3, 2, 1].map((n) => `<button class="${card.stars === n ? 'on' : ''}" data-act="adjust" data-stars="${n}">${'★'.repeat(n)}</button>`).join('')}
    </div>`;
}

async function flipCard() {
  const st = S.study;
  if (!st || st.flipped || st.busy) return;
  st.busy = true;
  const el = $('#card');
  if (el && !reduceMotion) {
    el.classList.add('flip-out');
    await sleep(130);
  }
  st.flipped = true;
  st.busy = false;
  renderStudy(reduceMotion ? '' : 'flip-in');
  scrollTo(0, 0);
}

function advance() {
  const st = S.study;
  st.i += 1;
  st.flipped = false;
  st.stats.seen += 1;
  renderStudy();
  scrollTo(0, 0);
  onCardShown();
}

async function withLock(fn) {
  const st = S.study;
  if (!st || st.busy) return;
  st.busy = true;
  try { await fn(); } finally { if (S.study) S.study.busy = false; }
}

const rateNew = (stars) => withLock(async () => {
  const { card } = studyEntry();
  await saveCards([srs.firstRating(card, stars, day())]);
  const n = newState();
  n.count += 1;
  await saveMeta('newToday', n);
  await markDay();
  S.study.stats.newRated[stars] += 1;
  advance();
});

const gradeCard = (grade) => withLock(async () => {
  const { card } = studyEntry();
  await saveCards([srs.review(card, grade, day())]);
  await markDay();
  S.study.stats[grade] += 1;
  if (grade === 'again') S.study.queue.push({ id: card.id, retry: true });
  advance();
});

function retryCard(again) {
  const { card } = studyEntry();
  if (again) S.study.queue.push({ id: card.id, retry: true });
  advance();
}

async function adjustStars(stars) {
  const { card } = studyEntry();
  await saveCards([srs.changeStars(card, stars, day())]);
  $('#actionbar').innerHTML = actionBar();
  if (stars === 1) toast('改成 ★：這個字之後不再安排複習');
}

function renderDone() {
  const st = S.study;
  const r = st.stats;
  const newCount = r.newRated[1] + r.newRated[2] + r.newRated[3];
  const reviewed = r.again + r.good + r.easy;
  const c = counts();
  if (!st.practice && !st.announced) {
    st.announced = true;
    const total = r.again + r.good + r.easy + newCount;
    pet.emit(total && r.again / total > 0.4 ? 'again' : 'done');
  }
  const summary = st.practice
    ? `<div class="sum">${icon('stats', { size: 22 })}<div><b>${r.seen}</b>張練習</div></div>`
    : `<div class="sum">${icon('stats', { size: 22 })}<div><b>${newCount}</b>新字分級</div><div><b>${reviewed}</b>複習</div><div><b>${r.again}</b>忘記</div></div>`;
  setView(`
    <section class="study">
      <div class="done">
        <div class="mark">${icon('trophy', { size: 40 })}</div>
        <h1>${st.practice ? '練習完成' : '今天完成了'}</h1>
        ${summary}
        ${newCount ? `<p class="muted small">${starsHtml(3)} ${r.newRated[3]}　${starsHtml(2)} ${r.newRated[2]}　${starsHtml(1)} ${r.newRated[1]}</p>` : ''}
        ${!st.practice && c.fresh ? `<p class="muted small">還有 ${c.fresh} 個新字，明天繼續。</p>` : ''}
        <div class="btn-row" style="margin-top:14px;justify-content:center">
          ${!st.practice && c.fresh && remainingNew() === 0 ? '<button class="btn" data-act="more-new-start">再多學 10 個</button>' : ''}
          <button class="btn primary" data-act="tab" data-tab="${st.practice ? 'library' : 'today'}">${st.practice ? '回單字庫' : '回首頁'}</button>
        </div>
      </div>
    </section>`);
}

/* -------------------------------------------------------------- library */

const FILTERS = [
  ['all', '全部'],
  ['new', '待分級'],
  ['due', '待複習'],
  ['3', '★★★'],
  ['2', '★★'],
  ['1', '★'],
  ['mastered', '已學完'],
];

function matchFilter(c, filter) {
  if (filter === 'new') return c.status === 'new';
  if (filter === 'due') return srs.isDue(c, day());
  if (filter === 'mastered') return c.status === 'mastered';
  if (filter === 'all') return true;
  return c.stars === Number(filter) && c.status !== 'new';
}

function filteredCards() {
  const { q, filter } = S.lib;
  const needle = q.trim().toLowerCase();
  return S.cards
    .filter((c) => matchFilter(c, filter))
    .filter((c) => !needle || c.word.toLowerCase().includes(needle) || (c.meaning || '').toLowerCase().includes(needle))
    .sort((a, b) => (b.order ?? 0) - (a.order ?? 0));
}

function listHtml() {
  const list = filteredCards();
  const practice = list.length ? `<button class="btn sm practice" data-act="practice">${icon('reviewing', { size: 16 })}練習這 ${list.length} 個字（不影響排程）</button>` : '';
  if (!list.length) return '<div class="empty"><p>沒有符合的單字</p></div>';
  return `${practice}<div class="list">${list.map((c) => `
    <button class="item" data-act="open-card" data-id="${esc(c.id)}">
      <span class="w">${esc(c.word)}</span>
      <span class="m">${esc(c.meaning || c.zh[0] || '')}</span>
      <span class="meta">${c.status === 'new' ? '<span class="chip">NEW</span>' : starsHtml(c.stars)}<span class="ic-label state">${icon(statusIcon(c), { size: 14 })}${dueLabel(c)}</span></span>
    </button>`).join('')}</div>`;
}

function renderLibrary() {
  setView(`
    <div class="page-head"><h1>單字庫</h1><p class="sub">共 ${S.cards.length} 個單字</p></div>
    <div class="search">${icon('search', { size: 18 })}<input id="lib-q" class="input" type="search" placeholder="搜尋單字或中文意思" value="${esc(S.lib.q)}" autocomplete="off" autocapitalize="none"></div>
    <div class="filters" id="lib-filters">
      ${FILTERS.map(([k, label]) => `<button data-act="filter" data-filter="${k}" class="${S.lib.filter === k ? 'on' : ''}">${label} ${S.cards.filter((c) => matchFilter(c, k)).length}</button>`).join('')}
    </div>
    <div id="lib-list">${listHtml()}</div>`);
}

function openSheet(html) {
  const el = $('#sheet');
  el.innerHTML = `<div class="sheet-body" role="dialog" aria-modal="true"><div class="grab"></div>${html}</div>`;
  el.hidden = false;
  document.body.style.overflow = 'hidden';
}
function closeSheet() {
  const el = $('#sheet');
  if (el.hidden) return;
  el.hidden = true;
  el.innerHTML = '';
  document.body.style.overflow = '';
}

function openCardSheet(id) {
  const c = cardById(id);
  if (!c) return;
  const secs = backSections(c);
  openSheet(`
    <div class="back-head">
      <div><div class="w">${esc(c.word)}</div><p class="ipa">${esc(c.ipa)}</p></div>
      ${speakBtn(c.word, 'word')}
    </div>
    <p class="muted small ic-label sheet-status" style="margin-top:6px">${c.status === 'new' ? '<span class="chip">NEW</span> ' : `${starsHtml(c.stars)}・`}${icon(statusIcon(c), { size: 15 })}${dueLabel(c)}${c.lapses ? `・忘記 ${c.lapses} 次` : ''}</p>
    ${meaningHtml(c.meaning, c.meaningMore)}
    ${c.en.length ? `<section class="sec">${secHead('example', '英文例句')}<ol class="pairs">${c.en.map((s) => `<li><p class="zh">${highlight(s, c.word)}</p></li>`).join('')}</ol></section>` : ''}
    ${sectionsHtml(secs, 'sheet')}
    <section class="sec">${secHead('difficulty', '重要性')}
      <div class="adjust" style="justify-content:flex-start;margin:0">
        ${[3, 2, 1].map((n) => `<button class="${c.stars === n ? 'on' : ''}" data-act="sheet-stars" data-id="${esc(c.id)}" data-stars="${n}">${'★'.repeat(n)}</button>`).join('')}
      </div>
      ${c.status === 'new' ? '<p class="muted small" style="margin-top:8px">待分級的單字，會在第一次學習時由你決定星級。</p>' : ''}
    </section>
    <div class="btn-row" style="margin-top:22px"><button class="btn danger sm" data-act="delete-card" data-id="${esc(c.id)}">${icon('trash', { size: 16 })}刪除這個單字</button><button class="btn sm" data-act="close-sheet">關閉</button></div>`);
}

/* --------------------------------------------------------------- import */

const FORMAT_HELP = `Flagship ⭐⭐⭐⭐
音標: /ˈflæɡ.ʃɪp/                     ← 可省略，App 會自動查
This is the company's flagship smartphone.
The brand opened a new flagship store in Taipei.
中文翻譯
這是該公司的旗艦智慧型手機。
這個品牌在台北開了一間新的旗艦店。
意思: 旗艦；旗艦級的                    ← 可省略，會從詞性變化推出
常見搭配
flagship store — 旗艦店
Flagship vs. Premium vs. Mainstream
flagship：品牌最具代表性的產品。
詞性變化
flagship（n. / adj.）— 旗艦；旗艦級的
🧩 拆解記憶
flag（旗幟）＋ ship（船）＝ flagship（旗艦）
🧠 最快記法：Flagship = 品牌拿來當門面的代表作。
---                                     ← 單字之間的分隔線（PDF 沒有也可以）

・每個單字以「單字 ⭐⭐⭐」開頭，App 會靠這一行切開每個字
・段落標題可以用：中文翻譯、意思、常見搭配、A vs. B、詞性變化、
  拆解記憶 / 記憶方式、最快記法、同義詞 / 反義詞、注意文法 / 補充
・同一個單字再匯入一次，只會更新內容，不會動到複習進度`;

function renderImport() {
  const safariWarn = isIos() && !isStandalone();
  setView(`
    <div class="page-head"><h1>匯入單字</h1><p class="sub">PDF、文字檔或直接貼上，一次 40–50 個字也沒問題。</p></div>
    ${safariWarn ? `
    <div class="panel warn">
      <h2>你現在是在 Safari 裡</h2>
      <p class="small" style="color:var(--slate)">iPhone 上，「加入主畫面」的 App 和 Safari 是兩個分開的儲存空間。請先加入主畫面，再從主畫面的 App 匯入，單字才會在 App 裡。</p>
    </div>` : ''}
    <div class="panel">
      <h2>最省時間的流程</h2>
      <ol class="steps">
        <li><span>複製下面的<b>提示詞</b>，貼給 ChatGPT，最後接上這次要學的單字（一次最多 50 個）。</span></li>
        <li><span>用「PDF 版」提示詞，ChatGPT 會直接交給你一個 <b>PDF</b>；用「貼上版」就<b>全選複製</b>它的回覆。</span></li>
        <li><span>回到這裡上傳或貼上，看預覽確認每個字都切對了，按<b>匯入</b>。</span></li>
      </ol>
      <div class="btn-row" style="margin-top:14px">
        <button class="btn primary on-dark" data-act="copy-prompt" data-kind="pdf">${icon('copy', { size: 18 })}複製提示詞（PDF 版）</button>
        <button class="btn" data-act="copy-prompt" data-kind="text">${icon('copy', { size: 18 })}複製提示詞（貼上版）</button>
      </div>
      <div class="btn-row" style="margin-top:8px">
        <button class="btn sm" data-act="load-sample">載入範例</button>
      </div>
    </div>
    <div class="panel">
      <label class="file-drop" for="imp-file">
        ${icon('fileUp', { size: 30 })}
        <b>選擇 PDF 或文字檔</b>
        <span>支援 .pdf、.txt、.md，可以一次 40–50 個單字</span>
      </label>
      <input id="imp-file" type="file" accept="application/pdf,.pdf,.txt,.md,.markdown,text/plain" hidden>
      <p class="status" id="imp-status">${statusHtml(S.imp.status, S.imp.diag)}</p>
      <div class="or">或直接貼上</div>
      <textarea id="imp-text" class="textarea" placeholder="把 ChatGPT 的整段回覆貼在這裡" spellcheck="false" autocapitalize="none" autocorrect="off">${esc(S.imp.text)}</textarea>
      <div class="btn-row" style="margin-top:10px">
        <button class="btn sm" data-act="paste">${icon('paste', { size: 16 })}從剪貼簿貼上</button>
        <button class="btn sm" data-act="imp-clear">${icon('eraser', { size: 16 })}清空</button>
      </div>
      <div id="imp-preview"></div>
    </div>
    <details class="panel note"><summary>支援的格式</summary><pre>${esc(FORMAT_HELP)}</pre></details>`);
  updateImportPreview();
}

function cardTags(c) {
  const tags = [
    `例句 ${c.en.length}`,
    `翻譯 ${c.zh.length}`,
    c.collocations.length && `搭配 ${c.collocations.length}`,
    c.compares.length && '比較',
    c.forms.length && `詞性 ${c.forms.length}`,
    c.memory && '拆解記憶',
    c.meaningMore && '補充意思',
    c.quick && '最快記法',
    c.extras && c.extras.length && `其他段落 ${c.extras.length}`,
    c.notes && '補充',
    c.ipa && '音標',
  ].filter(Boolean);
  return tags.map((t) => `<span>${esc(t)}</span>`).join('');
}

function updateImportPreview() {
  const box = $('#imp-preview');
  if (!box) return;
  const result = parseVocab(S.imp.text);
  S.imp.result = result;
  if (!S.imp.text.trim()) { box.innerHTML = ''; return; }

  const existing = new Set(S.cards.map((c) => c.id));
  const updating = result.cards.filter((c) => existing.has(wordKey(c.word))).length;
  const adding = result.cards.length - updating;
  const warn = new Map(result.warnings.map((w) => [w.word, w.msgs]));
  const button = result.cards.length ? `<button class="btn primary big" style="margin-top:12px" data-act="do-import">匯入 ${result.cards.length} 個單字</button>` : '';

  const items = result.cards.map((c) => `
    <div class="pv">
      <div class="t"><b>${esc(c.word)}</b>${c.aiStars ? `<span class="small">${'⭐'.repeat(Math.min(c.aiStars, 5))}</span>` : ''}</div>
      <div class="muted small">${esc(c.meaning)}</div>
      <div class="tags">${cardTags(c)}</div>
      ${warn.has(c.word) ? `<div class="w">⚠ ${warn.get(c.word).map(esc).join('；')}</div>` : ''}
    </div>`).join('');
  const errs = result.errors.map((e) => `<div class="pv err"><div class="t"><b>略過一段</b></div><div class="w">${esc(e.error)}${e.snippet ? `：「${esc(e.snippet)}」` : ''}</div></div>`).join('');

  box.innerHTML = `
    ${result.ignored.length ? `<p class="summary muted small">已略過 PDF 開頭的 ${result.ignored.length} 段文字（${result.ignored.map((e) => `「${esc(e.snippet || '')}」`).join('、')}）。</p>` : ''}
    <p class="summary">解析到 <b>${result.cards.length}</b> 個單字${updating ? `（新增 <b>${adding}</b>、更新 <b>${updating}</b>）` : ''}${result.warnings.length ? `，<b>${result.warnings.length}</b> 個需要留意` : ''}${result.errors.length ? `，略過 <b>${result.errors.length}</b> 段` : ''}</p>
    ${button}
    <div class="preview">${errs}${items}</div>
    ${result.cards.length > 4 ? button : ''}`;
}

async function doImport() {
  const result = S.imp.result;
  if (!result || !result.cards.length) return;
  const byId = new Map(S.cards.map((c) => [c.id, c]));
  const base = Date.now();
  let added = 0;
  let updated = 0;
  const addedIds = [];
  const previous = [];
  const out = result.cards.map((fields, i) => {
    const id = wordKey(fields.word);
    const prev = byId.get(id);
    if (prev) {
      updated += 1;
      previous.push(prev);
      return { ...prev, ...fields, ipa: fields.ipa || prev.ipa, id };
    }
    added += 1;
    addedIds.push(id);
    return srs.newCard({ id, ...fields, order: base + i });
  });
  await saveCards(out);
  S.lastImport = { date: srs.todayStr(), added: addedIds, updated: previous };
  await saveMeta('lastImport', S.lastImport);
  S.imp = { text: '', result: null, status: '' };
  pet.emit('done');
  const perDay = S.settings.newPerDay;
  toast(`已匯入：新增 ${added}${updated ? `、更新 ${updated}` : ''}${added > perDay ? `（每天出 ${perDay} 個新字）` : ''}`);
  go('today');
}

const statusHtml = (text, diag) => `${esc(text)}${diag ? ` <button class="linkish" data-act="copy-diag">${icon('copy', { size: 14 })}複製診斷資訊</button>` : ''}`;

function setImportStatus(text, diag = null) {
  S.imp.status = text;
  S.imp.diag = diag;
  const el = $('#imp-status');
  if (el) el.innerHTML = statusHtml(text, diag);
}

/** Text files from other tools: honour a UTF-16 byte-order mark, and fall back to Big5 when UTF-8 comes out garbled. */
async function readTextFile(file) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes.subarray(2));
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be').decode(bytes.subarray(2));
  const utf8 = new TextDecoder('utf-8').decode(bytes).replace(/^\uFEFF/, '');
  const bad = (utf8.match(/\uFFFD/g) || []).length;
  if (bad > 3 && bad / Math.max(1, utf8.length) > 0.002) {
    try { return new TextDecoder('big5').decode(bytes); } catch { /* keep utf-8 */ }
  }
  return utf8;
}

async function readFileInto(file) {
  if (!file) return;
  setImportStatus('');
  try {
    // Decide by the file's header, not its name: iOS sometimes hands over a PDF with no extension or a wrong type.
    const { hasPdfHeader, pdfToTextWithStats, explain, formatDiag } = await import('./pdf.js');
    const head = new Uint8Array(await file.slice(0, 1024).arrayBuffer());
    const isPdf = hasPdfHeader(head) || file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
    if (isPdf) {
      setImportStatus('正在讀取 PDF…');
      try {
        const { text, stats } = await pdfToTextWithStats(file, (n, total) => setImportStatus(`正在讀取 PDF：第 ${n} / ${total} 頁`));
        S.imp.text = text;
        if (!text.trim()) {
          setImportStatus(explain('empty'), formatDiag(stats.diag, '結果：沒有文字'));
        } else {
          const notes = [];
          if (stats.headerLines) notes.push(`已自動移除 ${stats.headerLines} 行頁首／頁尾`);
          if (stats.restored) notes.push(`PDF 缺少 ${stats.restored} 個圓圈數字，已依序補回（建議請 ChatGPT 不要用 ①②）`);
          if (stats.missing) notes.push(`⚠ 有 ${stats.missing} 個字在 PDF 裡本來就是空白（字型缺字），已用「□」標記，請在下面的文字框補上：${stats.missingAt.slice(0, 3).map((x) => `「${x}」`).join('')}`);
          if (stats.tofu) notes.push(`⚠ 有 ${stats.tofu} 個字元在 PDF 裡顯示不出來（方塊或問號），請檢查那幾個字`);
          if (stats.via && stats.via !== 'direct') notes.push(`（這個瀏覽器改用備用方式讀取：${stats.via}）`);
          setImportStatus(`已讀取「${file.name}」，共 ${stats.pages} 頁${notes.length ? `。${notes.join('；')}` : ''}`);
        }
      } catch (err) {
        if (!err?.diag) throw err;
        setImportStatus(`${explain(err.kind)}（${err.message}）`, formatDiag(err.diag, `結果：${err.kind}：${err.message}`));
        return;
      }
    } else {
      S.imp.text = await readTextFile(file);
      setImportStatus(`已讀取「${file.name}」`);
    }
  } catch (err) {
    const info = `Cash Volcab 檔案讀取診斷\n檔案：${file.name}（${file.size} bytes，${file.type || '未知類型'}）\n錯誤：${err?.name}: ${err?.message}\n瀏覽器：${navigator.userAgent}`;
    setImportStatus(`檔案讀取失敗（${err?.message || err}），請改用複製貼上。`, info);
    return;
  }
  const ta = $('#imp-text');
  if (ta) ta.value = S.imp.text;
  updateImportPreview();
}

/* ------------------------------------------------------------- settings */

async function storageLine() {
  try {
    const est = await navigator.storage?.estimate?.();
    const persisted = await navigator.storage?.persisted?.();
    const mb = est && est.usage != null ? `${(est.usage / 1024 / 1024).toFixed(1)} MB` : '—';
    return `使用約 ${mb}・${persisted ? '已設為持久保存' : '一般保存'}`;
  } catch {
    return '';
  }
}

function petPanel() {
  const p = pet.pack;
  return `
    <div class="panel">
      <h2>首頁寵物</h2>
      <div class="set-row">
        <div><b>顯示寵物</b><p>${p ? `角色：${esc(p.name || '未命名')}${pet.builtin ? '（內建）' : '（自己載入）'}・${Object.keys(p.clips).length} 組動作` : '還沒有載入角色素材'}</p></div>
        <button class="switch" role="switch" aria-checked="${S.settings.pet}" data-act="toggle-pet" aria-label="顯示寵物"${p ? '' : ' disabled'}></button>
      </div>
      <div class="set-row">
        <div><b>安靜模式</b><p>寵物不再自己走動，只在你點牠時反應</p></div>
        <button class="switch" role="switch" aria-checked="${S.settings.petQuiet}" data-act="toggle-pet-quiet" aria-label="寵物安靜模式"${p ? '' : ' disabled'}></button>
      </div>
      <p class="muted small" style="margin-top:8px">網站內建一個角色；也可以載入自己的角色素材檔（.petpack.json，只存在這支手機裡）來更換。系統設定開啟「減少動態效果」時，寵物只會靜靜坐著。</p>
      <div class="btn-row" style="margin-top:12px">
        <label class="btn" for="pet-file">${icon('upload', { size: 18 })}${p ? '更換' : '載入'}角色素材</label>
        <input id="pet-file" type="file" accept="application/json,.json" hidden>
        ${p ? `<a class="btn" href="pet.html">${icon('reviewing', { size: 18 })}預覽所有動作</a>` : ''}
        ${p && !pet.builtin ? `<button class="btn danger" data-act="pet-remove">${icon('trash', { size: 18 })}改回內建角色</button>` : ''}
      </div>
    </div>`;
}

function renderSettings() {
  setView(`
    <div class="page-head"><h1>設定</h1><p class="sub">${APP_NAME} v${APP_VERSION}</p></div>
    <div class="panel">
      <div class="set-row">
        <div><b>每天新字上限</b><p>匯入很多字時，每天最多出幾個新字</p></div>
        <div class="stepper"><button data-act="new-per-day" data-d="-5" aria-label="減少">−</button><b>${S.settings.newPerDay}</b><button data-act="new-per-day" data-d="5" aria-label="增加">＋</button></div>
      </div>
      <div class="set-row">
        <div><b>自動播放單字發音</b><p>每張卡片出現時先念一次</p></div>
        <button class="switch" role="switch" aria-checked="${S.settings.autoPlay}" data-act="toggle-autoplay" aria-label="自動播放單字發音"></button>
      </div>
    </div>
    <div class="panel">
      <h2 class="ic-label">${icon('difficulty', { size: 18 })}星級複習規則</h2>
      ${RULES}
    </div>
    ${petPanel()}
    <div class="panel">
      <h2>單字存在哪裡？</h2>
      <ul class="facts">
        <li>存在這支手機、這個網址專屬的瀏覽器資料庫（IndexedDB）裡，不會上傳到 GitHub 或任何伺服器。</li>
        <li>iPhone 上「加入主畫面」的 App 有自己獨立的儲存空間，和 Safari 分開，所以請一律從主畫面開啟。</li>
        <li>刪除主畫面 App、清除 Safari 網站資料或換手機，資料就會消失。請定期匯出備份到「檔案」或 iCloud Drive。</li>
      </ul>
      <p class="muted small" style="margin-top:10px">儲存方式：${esc(S.store.kind)}・${S.cards.length} 個單字・<span id="storage-line"></span></p>
      <div class="btn-row" style="margin-top:12px">
        <button class="btn" data-act="export">${icon('download', { size: 18 })}匯出備份</button>
        <label class="btn" for="restore-file">${icon('upload', { size: 18 })}還原備份</label>
        <input id="restore-file" type="file" accept="application/json,.json" hidden>
      </div>
    </div>
    <div class="panel">
      <h2>測試與清除</h2>
      <p class="muted small" style="margin-bottom:12px">測試完要正式開始時，可以用下面的功能清掉測試資料。每個按鈕都要按兩次才會執行。</p>
      <div class="btn-row">
        ${S.lastImport && S.lastImport.added.length + S.lastImport.updated.length ? `<button class="btn" data-act="undo-import">${icon('undo', { size: 18 })}復原上一次匯入</button>` : ''}
        <button class="btn" data-act="reset-progress">${icon('reviewing', { size: 18 })}重設學習進度（保留單字）</button>
        <button class="btn danger" data-act="wipe">${icon('trash', { size: 18 })}清除所有單字與進度</button>
      </div>
    </div>`);
  storageLine().then((t) => { const el = $('#storage-line'); if (el) el.textContent = t; });
}

function exportBackup() {
  const data = { app: 'xiaojinku-vocab', version: 2, exportedAt: new Date().toISOString(), settings: S.settings, days: S.days, clock: S.clock, cards: S.cards };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `xiaojinku-backup-${srs.todayStr()}.json`;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  toast('已匯出備份檔');
}

async function restoreBackup(file) {
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    if (!Array.isArray(data.cards)) throw new Error('bad file');
    if (data.clock && typeof data.clock.count === 'number') { S.clock = data.clock; await saveMeta('clock', S.clock); }
    const cards = data.cards.filter((c) => c && c.id && c.word && Array.isArray(c.en) && Array.isArray(c.zh)).map(upgradeCard);
    await saveCards(cards);
    if (data.settings) { S.settings = { ...DEFAULT_SETTINGS, ...data.settings }; await saveMeta('settings', S.settings); }
    if (Array.isArray(data.days)) { S.days = [...new Set([...S.days, ...data.days])].slice(-400); await saveMeta('days', S.days); }
    toast(`已還原 ${cards.length} 個單字`);
    render();
  } catch {
    toast('這不是有效的備份檔');
  }
}

async function loadPetFile(file) {
  if (!file) return;
  try {
    const pack = await readPackFile(file);
    await S.store.setMeta('petpack', pack);
    await S.store.setMeta('petpackCustom', true);
    pet.builtin = false;
    pet.setPack(pack);
    toast(`已載入角色素材：${pack.name || ''}`);
    renderSettings();
  } catch (err) {
    toast(`這不是有效的角色素材檔（${err.message}）`);
  }
}

/* --------------------------------------------------------------- events */

const actions = {
  tab: (el) => go(el.dataset.tab),
  start: () => startStudy(),
  flip: flipCard,
  speak: (el) => say(el.dataset.kind === 'word' ? spoken(el.dataset.text) : el.dataset.text, { isWord: el.dataset.kind === 'word' }),
  jump: (el) => {
    const target = document.getElementById(el.dataset.to);
    if (target) target.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' });
  },
  'rate-new': (el) => rateNew(Number(el.dataset.stars)),
  grade: (el) => gradeCard(el.dataset.grade),
  retry: (el) => retryCard(el.dataset.again === '1'),
  adjust: (el) => adjustStars(Number(el.dataset.stars)),
  'exit-study': () => {
    if (!S.study) return;
    // Every rating is saved as it happens, so leaving never loses progress.
    const back = S.study.practice ? 'library' : 'today';
    S.study = null;
    go(back);
  },
  'more-new': () => { newState().bonus += 10; saveMeta('newToday', S.newToday); renderToday(); },
  'more-new-start': () => { newState().bonus += 10; saveMeta('newToday', S.newToday); S.study = null; startStudy(); },
  'dismiss-banner': () => { setFlag('xj-banner'); renderToday(); },
  filter: (el) => {
    S.lib.filter = el.dataset.filter;
    document.querySelectorAll('#lib-filters button').forEach((b) => b.classList.toggle('on', b === el));
    $('#lib-list').innerHTML = listHtml();
  },
  practice: () => {
    const list = filteredCards().map((c) => ({ id: c.id, retry: true }));
    for (let i = list.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [list[i], list[j]] = [list[j], list[i]];
    }
    startStudy(list.slice(0, 100), true);
  },
  'open-card': (el) => openCardSheet(el.dataset.id),
  'close-sheet': closeSheet,
  'sheet-stars': async (el) => {
    const c = cardById(el.dataset.id);
    await saveCards([srs.changeStars(c, Number(el.dataset.stars), day())]);
    openCardSheet(c.id);
    if (S.tab === 'library' && $('#lib-list')) $('#lib-list').innerHTML = listHtml();
  },
  'delete-card': async (el) => {
    const c = cardById(el.dataset.id);
    if (!armed(el, `再按一次，確認刪除「${c.word}」`)) return;
    await S.store.remove(c.id);
    S.cards = S.cards.filter((x) => x.id !== c.id);
    closeSheet();
    render();
    toast('已刪除');
  },
  'copy-prompt': async (el) => {
    try {
      await navigator.clipboard.writeText(el.dataset.kind === 'text' ? AI_PROMPT_TEXT : AI_PROMPT_PDF);
      toast('提示詞已複製，貼給 ChatGPT 後，在最後接上要學的單字');
    }
    catch { toast('複製失敗，請到「支援的格式」手動參考'); }
  },
  'copy-diag': async () => {
    try { await navigator.clipboard.writeText(S.imp.diag || ''); toast('診斷資訊已複製，貼給我就能查原因'); }
    catch { toast('複製失敗，請截圖這一頁'); }
  },
  'load-sample': async () => {
    try {
      const res = await fetch('samples/flagship.txt');
      const res2 = await fetch('samples/sample-words.txt');
      S.imp.text = `${await res.text()}\n---\n${await res2.text()}`;
      $('#imp-text').value = S.imp.text;
      updateImportPreview();
    } catch { toast('範例載入失敗（需要連線一次）'); }
  },
  paste: async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (!text) return toast('剪貼簿是空的');
      S.imp.text = text;
      $('#imp-text').value = text;
      updateImportPreview();
    } catch { toast('無法讀取剪貼簿，請在文字框長按選「貼上」'); }
  },
  'imp-clear': () => { S.imp.text = ''; $('#imp-text').value = ''; setImportStatus(''); updateImportPreview(); },
  'do-import': doImport,
  'new-per-day': async (el) => {
    S.settings.newPerDay = Math.min(100, Math.max(5, S.settings.newPerDay + Number(el.dataset.d)));
    await saveMeta('settings', S.settings);
    renderSettings();
  },
  'toggle-pet': async (el) => {
    S.settings.pet = !S.settings.pet;
    pet.enabled = S.settings.pet;
    el.setAttribute('aria-checked', String(S.settings.pet));
    await saveMeta('settings', S.settings);
  },
  'toggle-pet-quiet': async (el) => {
    S.settings.petQuiet = !S.settings.petQuiet;
    pet.quiet = S.settings.petQuiet;
    el.setAttribute('aria-checked', String(S.settings.petQuiet));
    await saveMeta('settings', S.settings);
  },
  'pet-remove': async (el) => {
    if (!armed(el, '再按一次，改回內建角色')) return;
    await saveMeta('petpack', null);
    await saveMeta('petpackCustom', false);
    await pet.reset(S.store);
    toast('已改回內建角色');
    renderSettings();
  },
  'toggle-autoplay': async (el) => {
    S.settings.autoPlay = !S.settings.autoPlay;
    el.setAttribute('aria-checked', String(S.settings.autoPlay));
    await saveMeta('settings', S.settings);
  },
  export: exportBackup,
  'undo-import': async (el) => {
    const li = S.lastImport;
    if (!li) return;
    if (!armed(el, `再按一次，刪除這次新增的 ${li.added.length} 個字${li.updated.length ? `並還原 ${li.updated.length} 個更新` : ''}`)) return;
    for (const id of li.added) await S.store.remove(id);
    S.cards = S.cards.filter((c) => !li.added.includes(c.id));
    if (li.updated.length) await saveCards(li.updated);
    S.lastImport = null;
    await saveMeta('lastImport', null);
    toast('已復原上一次匯入');
    render();
  },
  'reset-progress': async (el) => {
    if (!armed(el, '再按一次，所有單字回到「待分級」')) return;
    const reset = S.cards.map((c) => ({ ...c, stars: 0, status: 'new', step: 0, relearn: false, due: null, reps: 0, lapses: 0, lastReviewed: null }));
    await saveCards(reset);
    S.days = [];
    S.clock = srs.newClock();
    S.newToday = { date: '', count: 0, bonus: 0 };
    await saveMeta('days', S.days);
    await saveMeta('clock', S.clock);
    await saveMeta('newToday', S.newToday);
    newState();
    toast(`已重設 ${reset.length} 個單字的學習進度`);
    render();
  },
  wipe: async (el) => {
    if (!armed(el, '再按一次，確認清除全部資料（無法復原）')) return;
    await S.store.clear();
    if (pet.pack && !pet.builtin) { await saveMeta('petpack', pet.pack); await saveMeta('petpackCustom', true); }
    S.cards = []; S.days = []; S.clock = srs.newClock(); S.settings = { ...DEFAULT_SETTINGS }; S.newToday = { date: '', count: 0, bonus: 0 }; S.lastImport = null;
    toast('已清除');
    render();
  },
};

document.addEventListener('click', (e) => {
  if (e.target.classList?.contains('sheet')) return closeSheet();
  const el = e.target.closest('[data-act]');
  if (!el) return;
  const fn = actions[el.dataset.act];
  if (fn) fn(el);
});

document.addEventListener('pointerdown', () => unlockAudio(), { once: true, capture: true });

document.addEventListener('input', (e) => {
  if (e.target.id === 'imp-text') { S.imp.text = e.target.value; updateImportPreview(); }
  if (e.target.id === 'lib-q') { S.lib.q = e.target.value; $('#lib-list').innerHTML = listHtml(); }
});

document.addEventListener('change', (e) => {
  if (e.target.id === 'imp-file') { readFileInto(e.target.files[0]); e.target.value = ''; }
  if (e.target.id === 'restore-file') { restoreBackup(e.target.files[0]); e.target.value = ''; }
  if (e.target.id === 'pet-file') { loadPetFile(e.target.files[0]); e.target.value = ''; }
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') return closeSheet();
  if (!S.study || e.target.matches('input, textarea') || e.metaKey || e.ctrlKey) return;
  const cur = studyEntry();
  if (!cur) return;
  if (!S.study.flipped) {
    if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); flipCard(); }
    return;
  }
  const { entry, card } = cur;
  if (S.study.practice || entry.retry) {
    if (e.key === '1') retryCard(true);
    if (e.key === '2' || e.key === ' ') { e.preventDefault(); retryCard(false); }
  } else if (card.status === 'new') {
    if (['1', '2', '3'].includes(e.key)) rateNew(Number(e.key));
  } else {
    if (e.key === '1') gradeCard('again');
    if (e.key === '2' || e.key === ' ') { e.preventDefault(); gradeCard('good'); }
    if (e.key === '3') gradeCard('easy');
  }
});

document.querySelectorAll('.tab').forEach((t) => t.addEventListener('click', () => go(t.dataset.tab)));

/* ----------------------------------------------------------------- boot */

async function boot() {
  S.store = await createStore();
  try {
    S.clock = (await S.store.getMeta('clock')) || srs.newClock();
    S.cards = (await S.store.getAll()).map((c) => upgradeCard(c));
    S.settings = { ...DEFAULT_SETTINGS, ...((await S.store.getMeta('settings')) || {}) };
    S.days = (await S.store.getMeta('days')) || [];
    S.newToday = (await S.store.getMeta('newToday')) || S.newToday;
    S.lastImport = (await S.store.getMeta('lastImport')) || null;
  } catch {
    toast('讀取資料時發生問題');
  }
  newState();
  await pet.init(S.store);
  pet.enabled = S.settings.pet !== false;
  pet.quiet = Boolean(S.settings.petQuiet);
  pet.getWord = () => {
    const pool = buildQueue().map((e) => cardById(e.id)).filter(Boolean);
    const list = pool.length ? pool : S.cards;
    return list.length ? list[Math.floor(Math.random() * list.length)].word.replace(/\s*[（(].*$/, '') : null;
  };
  hydrateIcons();
  render();
  navigator.storage?.persist?.().catch(() => {});
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).catch(() => {});
}

boot();
