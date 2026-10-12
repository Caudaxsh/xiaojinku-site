import { parseVocab, wordKey, AI_PROMPT } from './parser.js';
import * as srs from './srs.js';
import { createStore } from './store.js';

const APP_VERSION = '1.0.0';
const DEFAULT_SETTINGS = { newPerDay: 15 };

const S = {
  store: null,
  cards: [],
  settings: { ...DEFAULT_SETTINGS },
  days: [],
  newToday: { date: '', count: 0, bonus: 0 },
  tab: 'today',
  study: null,
  lib: { q: '', filter: 'all' },
  imp: { text: '', result: null },
};

const $ = (sel, root = document) => root.querySelector(sel);
const view = () => $('#view');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ESC[c]);
const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const starsHtml = (n) => `<span class="stars" aria-label="${n} 顆星">${'★'.repeat(n)}<span class="off">${'★'.repeat(3 - n)}</span></span>`;
const cardById = (id) => S.cards.find((c) => c.id === id);

function highlight(sentence, word) {
  const safe = esc(sentence);
  let pattern;
  if (/\s/.test(word)) pattern = escRe(esc(word));
  else {
    const stem = word.length > 4 ? word.replace(/(e|y)$/i, '') : word;
    pattern = `${escRe(stem)}[a-z]*`;
  }
  return safe.replace(new RegExp(`\\b(${pattern})`, 'gi'), '<b class="hit">$1</b>');
}

function toast(message) {
  const el = $('#toast');
  el.textContent = message;
  el.classList.add('show');
  clearTimeout(toast.t);
  toast.t = setTimeout(() => el.classList.remove('show'), 2400);
}

let voices = [];
function speak(text) {
  if (!('speechSynthesis' in window)) return toast('這個瀏覽器不支援發音');
  if (!voices.length) voices = speechSynthesis.getVoices();
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = 'en-US';
  u.rate = 0.92;
  const v = voices.find((x) => /^en[-_]US/i.test(x.lang));
  if (v) u.voice = v;
  speechSynthesis.speak(u);
}

/* ------------------------------------------------------------------ data */

async function saveCards(cards) {
  const map = new Map(S.cards.map((c) => [c.id, c]));
  cards.forEach((c) => map.set(c.id, c));
  S.cards = [...map.values()];
  await S.store.putMany(cards);
}

async function saveMeta(key, value) {
  try { await S.store.setMeta(key, value); } catch { /* storage full or blocked: keep going in memory */ }
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

function counts() {
  const today = srs.todayStr();
  const fresh = S.cards.filter((c) => c.status === 'new');
  return {
    total: S.cards.length,
    fresh: fresh.length,
    freshToday: Math.min(fresh.length, remainingNew()),
    due: S.cards.filter((c) => srs.isDue(c, today)).length,
    mastered: S.cards.filter((c) => c.status === 'mastered').length,
  };
}

function buildQueue() {
  const today = srs.todayStr();
  const due = S.cards
    .filter((c) => srs.isDue(c, today))
    .sort((a, b) => a.due.localeCompare(b.due) || b.stars - a.stars);
  const fresh = S.cards
    .filter((c) => c.status === 'new')
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
    .slice(0, remainingNew());
  return [...due, ...fresh].map((c) => ({ id: c.id, retry: false }));
}

async function markDay() {
  const today = srs.todayStr();
  if (!S.days.includes(today)) {
    S.days = [...S.days, today].slice(-400);
    await saveMeta('days', S.days);
  }
}

function dueLabel(card) {
  if (card.status === 'new') return '待分級';
  if (card.status === 'mastered') return '已掌握';
  const d = srs.daysBetween(srs.todayStr(), card.due);
  if (d <= 0) return '今天複習';
  if (d === 1) return '明天複習';
  return `${d} 天後複習`;
}

/* ---------------------------------------------------------------- shell */

function setView(html) {
  const el = view();
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

/* ---------------------------------------------------------------- today */

const isStandalone = () => navigator.standalone === true || matchMedia('(display-mode: standalone)').matches;
const isIos = () => /iphone|ipad|ipod/i.test(navigator.userAgent);
const bannerDismissed = () => { try { return localStorage.getItem('xj-banner') === '1'; } catch { return false; } };

function renderToday() {
  const c = counts();
  const streak = srs.streak(S.days);
  const todayTotal = c.due + c.freshToday;
  const now = new Date();
  const dateText = `${now.getMonth() + 1} 月 ${now.getDate()} 日`;
  const showBanner = isIos() && !isStandalone() && !bannerDismissed();

  let main;
  if (!c.total) {
    main = `
      <div class="panel empty">
        <h2>還沒有單字</h2>
        <p>先到「匯入」把第一批單字貼進來。</p>
        <div class="btn-row" style="justify-content:center;margin-top:16px">
          <button class="btn primary" data-act="tab" data-tab="import">去匯入單字</button>
        </div>
      </div>`;
  } else if (!todayTotal) {
    const moreAvail = c.fresh > c.freshToday || (c.fresh > 0 && remainingNew() === 0);
    main = `
      <div class="panel empty">
        <h2>今天的都完成了</h2>
        <p>${c.fresh ? `還有 ${c.fresh} 個新字等著第一次分級。` : '沒有要複習的單字，明天見。'}</p>
        <div class="btn-row" style="justify-content:center;margin-top:16px">
          ${moreAvail ? '<button class="btn primary" data-act="more-new">再多學 5 個新字</button>' : ''}
          <button class="btn" data-act="tab" data-tab="import">匯入新單字</button>
        </div>
      </div>`;
  } else {
    main = `<button class="btn primary big" data-act="start">開始學習・${todayTotal} 張卡片</button>`;
  }

  setView(`
    <div class="page-head hero">
      <div><h1>小金庫單字</h1><p class="sub">${dateText}・今天也來背幾個字</p></div>
      <div class="streak"><b>${streak}</b><span>連續天數</span></div>
    </div>
    <div class="tiles">
      <div class="tile ${c.freshToday ? 'hot' : ''}"><div class="num">${c.freshToday}</div><div class="lbl">今日新字</div></div>
      <div class="tile ${c.due ? 'hot' : ''}"><div class="num">${c.due}</div><div class="lbl">待複習</div></div>
      <div class="tile"><div class="num">${c.mastered}</div><div class="lbl">已掌握</div></div>
    </div>
    ${main}
    ${showBanner ? `
    <div class="panel banner" style="margin-top:14px">
      <span>用 iPhone 當 App：Safari 點「分享」→「加入主畫面」，就能全螢幕離線使用。</span>
      <button data-act="dismiss-banner">知道了</button>
    </div>` : ''}
    <div class="panel" style="margin-top:14px">
      <h2>星級複習規則</h2>
      <div class="ladder-row">${starsHtml(3)}<p><b>最重要</b>（口說必備）：1・3・7・14・30・60・120 天，持續複習不退場</p></div>
      <div class="ladder-row">${starsHtml(2)}<p><b>重要</b>：3・10・30 天，複習三次後視為已掌握</p></div>
      <div class="ladder-row">${starsHtml(1)}<p><b>艱深少用</b>：7 天後再複習一次，就視為已掌握</p></div>
    </div>
  `);
}

/* ---------------------------------------------------------------- study */

function startStudy() {
  const queue = buildQueue();
  if (!queue.length) return toast('今天沒有要學的卡片');
  S.study = { queue, i: 0, flipped: false, stats: { again: 0, good: 0, easy: 0, newRated: { 1: 0, 2: 0, 3: 0 } } };
  render();
}

function studyEntry() {
  const st = S.study;
  const entry = st.queue[st.i];
  return entry ? { entry, card: cardById(entry.id) } : null;
}

function renderStudy(animate = '') {
  const st = S.study;
  const cur = studyEntry();
  if (!cur) return renderDone();
  const { entry, card } = cur;
  const total = st.queue.length;
  const pct = Math.round((st.i / total) * 100);

  const badge = entry.retry
    ? '<span class="chip quiet">再看一次</span>'
    : card.status === 'new'
      ? '<span class="chip">NEW</span>'
      : starsHtml(card.stars);

  const speakBtn = (text, label = '發音') =>
    `<button class="speak" data-act="speak" data-text="${esc(text)}" aria-label="${label}">🔊</button>`;

  let face;
  if (!st.flipped) {
    face = `
      <article class="card front ${animate}" id="card" data-act="flip">
        <div class="card-top">${badge}</div>
        <div class="word-wrap"><h1 class="word">${esc(card.word)}</h1>${speakBtn(card.word)}</div>
        <ol class="sentences">
          ${card.en.length
            ? card.en.map((s, i) => `<li data-n="${i + 1}"><span class="txt">${highlight(s, card.word)}</span><button class="mini-speak" data-act="speak" data-text="${esc(s)}" aria-label="朗讀例句">🔊</button></li>`).join('')
            : '<li data-n="•" class="muted">（這個單字沒有例句）</li>'}
        </ol>
        <p class="hint">先想想意思，再點一下卡片翻面</p>
      </article>`;
  } else {
    face = `
      <article class="card ${animate}" id="card">
        <div class="card-top">
          <div class="back-word"><b>${esc(card.word)}</b>${speakBtn(card.word)}</div>
          ${badge}
        </div>
        ${card.meaning ? `<p class="meaning-big">${esc(card.meaning)}</p>` : ''}
        ${card.zh.length ? `<section class="block"><h3>例句翻譯</h3><ol class="zh-list">${card.zh.map((s, i) => `<li>${i + 1}. ${esc(s)}</li>`).join('')}</ol></section>` : ''}
        ${card.collocations.length ? `<section class="block"><h3>搭配詞</h3><ul class="colloc">${card.collocations.map((x) => `<li data-act="speak" data-text="${esc(x.p)}"><b>${esc(x.p)}</b><span>${esc(x.zh)}</span></li>`).join('')}</ul></section>` : ''}
        ${card.memory ? `<section class="block"><h3>記憶方式</h3><p class="memory">${esc(card.memory)}</p></section>` : ''}
        ${card.notes ? `<section class="block"><h3>補充</h3><p class="notes">${esc(card.notes)}</p></section>` : ''}
      </article>`;
  }

  setView(`
    <section class="study">
      <div class="study-top">
        <button class="x-btn" data-act="exit-study" aria-label="結束學習">✕</button>
        <div class="progress" role="progressbar" aria-valuemin="0" aria-valuemax="${total}" aria-valuenow="${st.i}"><span style="width:${pct}%"></span></div>
        <span class="count">${st.i + 1} / ${total}</span>
      </div>
      <div class="stage">${face}</div>
      <div class="actionbar" id="actionbar">${actionBar()}</div>
    </section>`);
}

function actionBar() {
  const st = S.study;
  const { entry, card } = studyEntry();
  if (!st.flipped) return '<button class="btn primary big" data-act="flip">翻面看答案</button>';

  if (entry.retry) {
    return `
      <div class="grade-grid" style="grid-template-columns:1fr 1fr">
        <button class="grade-btn again" data-act="retry" data-again="1"><b>還沒記住</b><small>稍後再看</small></button>
        <button class="grade-btn good" data-act="retry" data-again="0"><b>記得了</b><small>下一張</small></button>
      </div>`;
  }

  if (card.status === 'new') {
    return `
      <p class="ask"><b>這個字對你的重要性？</b><br><span class="nw">★★★ 口說必備</span> <span class="nw">★★ 較少用但重要</span> <span class="nw">★ 艱深，只再複習一次</span></p>
      <div class="pick-grid">
        <button class="pick-btn s3" data-act="rate-new" data-stars="3">${starsHtml(3)}<b>最重要</b></button>
        <button class="pick-btn" data-act="rate-new" data-stars="2">${starsHtml(2)}<b>重要</b></button>
        <button class="pick-btn" data-act="rate-new" data-stars="1">${starsHtml(1)}<b>艱深少用</b></button>
      </div>`;
  }

  const hint = (g) => srs.previewInterval(card, g);
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
}

function advance() {
  const st = S.study;
  st.i += 1;
  st.flipped = false;
  renderStudy();
}

async function rateNew(stars) {
  const { card } = studyEntry();
  await saveCards([srs.firstRating(card, stars)]);
  const n = newState();
  n.count += 1;
  await saveMeta('newToday', n);
  await markDay();
  S.study.stats.newRated[stars] += 1;
  advance();
}

async function gradeCard(grade) {
  const { card } = studyEntry();
  await saveCards([srs.review(card, grade)]);
  await markDay();
  S.study.stats[grade] += 1;
  if (grade === 'again') S.study.queue.push({ id: card.id, retry: true });
  advance();
}

function retryCard(again) {
  const { card } = studyEntry();
  if (again) S.study.queue.push({ id: card.id, retry: true });
  advance();
}

async function adjustStars(stars) {
  const { card } = studyEntry();
  await saveCards([srs.changeStars(card, stars)]);
  $('#actionbar').innerHTML = actionBar();
}

function renderDone() {
  const st = S.study;
  const r = st.stats;
  const newCount = r.newRated[1] + r.newRated[2] + r.newRated[3];
  const reviewed = r.again + r.good + r.easy;
  const c = counts();
  setView(`
    <section class="study">
      <div class="done enter">
        <div class="big">✓</div>
        <h1>今天完成了</h1>
        <div class="sum">
          <div><b>${newCount}</b>新字分級</div>
          <div><b>${reviewed}</b>複習</div>
          <div><b>${r.again}</b>忘記</div>
        </div>
        ${newCount ? `<p class="muted small">${starsHtml(3)} ${r.newRated[3]}　${starsHtml(2)} ${r.newRated[2]}　${starsHtml(1)} ${r.newRated[1]}</p>` : ''}
        ${c.fresh ? `<p class="muted small">還有 ${c.fresh} 個新字還沒學，明天繼續。</p>` : ''}
        <div class="btn-row" style="margin-top:14px;justify-content:center">
          ${c.fresh && remainingNew() === 0 ? '<button class="btn" data-act="more-new-start">再多學 5 個</button>' : ''}
          <button class="btn primary" data-act="tab" data-tab="today">回首頁</button>
        </div>
      </div>
    </section>`);
}

/* -------------------------------------------------------------- library */

const FILTERS = [
  ['all', '全部'],
  ['new', '待分級'],
  ['3', '★★★'],
  ['2', '★★'],
  ['1', '★'],
  ['mastered', '已掌握'],
];

function filteredCards() {
  const { q, filter } = S.lib;
  const needle = q.trim().toLowerCase();
  return S.cards
    .filter((c) => {
      if (filter === 'new') return c.status === 'new';
      if (filter === 'mastered') return c.status === 'mastered';
      if (filter === 'all') return true;
      return c.stars === Number(filter) && c.status !== 'new';
    })
    .filter((c) => !needle || c.word.toLowerCase().includes(needle) || (c.meaning || '').toLowerCase().includes(needle))
    .sort((a, b) => (b.order ?? 0) - (a.order ?? 0));
}

function listHtml() {
  const list = filteredCards();
  if (!list.length) return '<div class="empty"><p>沒有符合的單字</p></div>';
  return `<div class="list">${list.map((c) => `
    <button class="item" data-act="open-card" data-id="${esc(c.id)}">
      <span class="w">${esc(c.word)}</span>
      <span class="m">${esc(c.meaning || c.zh[0] || '')}</span>
      <span class="meta">${c.status === 'new' ? '<span class="chip">NEW</span>' : starsHtml(c.stars)}<span>${dueLabel(c)}</span></span>
    </button>`).join('')}</div>`;
}

function renderLibrary() {
  const filterCount = (key) => {
    if (key === 'all') return S.cards.length;
    if (key === 'new') return S.cards.filter((c) => c.status === 'new').length;
    if (key === 'mastered') return S.cards.filter((c) => c.status === 'mastered').length;
    return S.cards.filter((c) => c.stars === Number(key) && c.status !== 'new').length;
  };
  setView(`
    <div class="page-head"><h1>單字庫</h1><p class="sub">共 ${S.cards.length} 個單字</p></div>
    <input id="lib-q" class="input" type="search" placeholder="搜尋單字或中文意思" value="${esc(S.lib.q)}" autocomplete="off" autocapitalize="none">
    <div class="filters" id="lib-filters">
      ${FILTERS.map(([k, label]) => `<button data-act="filter" data-filter="${k}" class="${S.lib.filter === k ? 'on' : ''}">${label} ${filterCount(k)}</button>`).join('')}
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
  const pairs = c.en.map((en, i) => `<div class="pair"><span class="en">${highlight(en, c.word)}</span><span class="zh">${esc(c.zh[i] || '')}</span></div>`).join('');
  openSheet(`
    <div class="card-top"><div class="back-word"><b style="font-size:28px">${esc(c.word)}</b><button class="speak" data-act="speak" data-text="${esc(c.word)}" aria-label="發音">🔊</button></div>
      ${c.status === 'new' ? '<span class="chip">NEW</span>' : starsHtml(c.stars)}</div>
    <p class="muted small">${dueLabel(c)}${c.lapses ? `・忘記 ${c.lapses} 次` : ''}</p>
    ${c.meaning ? `<p class="meaning-big" style="font-size:22px">${esc(c.meaning)}</p>` : ''}
    ${pairs ? `<section class="block"><h3>例句</h3>${pairs}</section>` : ''}
    ${c.collocations.length ? `<section class="block"><h3>搭配詞</h3><ul class="colloc">${c.collocations.map((x) => `<li data-act="speak" data-text="${esc(x.p)}"><b>${esc(x.p)}</b><span>${esc(x.zh)}</span></li>`).join('')}</ul></section>` : ''}
    ${c.memory ? `<section class="block"><h3>記憶方式</h3><p class="memory">${esc(c.memory)}</p></section>` : ''}
    ${c.notes ? `<section class="block"><h3>補充</h3><p class="notes">${esc(c.notes)}</p></section>` : ''}
    <section class="block"><h3>重要性</h3>
      <div class="adjust" style="justify-content:flex-start;margin:0">
        ${[3, 2, 1].map((n) => `<button class="${c.stars === n ? 'on' : ''}" data-act="sheet-stars" data-id="${esc(c.id)}" data-stars="${n}">${'★'.repeat(n)}</button>`).join('')}
      </div>
      ${c.status === 'new' ? '<p class="muted small" style="margin-top:6px">待分級的單字，會在第一次複習時由你決定星級。</p>' : ''}
    </section>
    <div class="btn-row" style="margin-top:22px"><button class="btn danger sm" data-act="delete-card" data-id="${esc(c.id)}">刪除這個單字</button><button class="btn sm" data-act="close-sheet">關閉</button></div>`);
}

/* --------------------------------------------------------------- import */

const FORMAT_HELP = `# entail
EN: Starting a business entails taking financial risks.
EN: The job entails working long hours.
ZH: 創業必然涉及承擔財務風險。
ZH: 這份工作需要長時間工作。
意思: 涉及、必然需要
搭配:
- entail risks — 涉及風險
- entail costs — 涉及成本
記憶: 聯想法：en- + tail（尾巴）
---
# 下一個單字 ...

也看得懂 ChatGPT 常見的排版：
單字 → 編號英文例句 → 「中文翻譯」→ 「單字：意思」→ 「常見搭配」→ 「記憶方式」，
單字與單字之間用 --- 分開即可。同一個單字再次匯入會更新內容，但不會動到複習進度。`;

function renderImport() {
  setView(`
    <div class="page-head"><h1>匯入單字</h1><p class="sub">每天把新單字貼進來，資料只存在這支手機裡。</p></div>
    <div class="panel">
      <h2>每天的流程</h2>
      <ol class="steps">
        <li><span><b>複製提示詞</b>，貼給 ChatGPT，後面接上今天要學的單字。</span></li>
        <li><span>把它的回覆<b>整段複製</b>。</span></li>
        <li><span>回到這裡<b>貼上</b>，看預覽確認後按匯入。</span></li>
      </ol>
      <div class="btn-row" style="margin-top:14px">
        <button class="btn primary" data-act="copy-prompt">複製 AI 提示詞</button>
        <button class="btn" data-act="load-sample">載入範例</button>
      </div>
    </div>
    <div class="panel">
      <h2>貼上單字</h2>
      <textarea id="imp-text" class="textarea" placeholder="把整段內容貼在這裡" spellcheck="false" autocapitalize="none" autocorrect="off">${esc(S.imp.text)}</textarea>
      <div class="btn-row" style="margin-top:10px">
        <button class="btn sm" data-act="paste">從剪貼簿貼上</button>
        <label class="btn sm" for="imp-file">選擇檔案</label>
        <input id="imp-file" type="file" accept=".txt,.md,.markdown,text/plain" hidden>
        <button class="btn sm" data-act="imp-clear">清空</button>
      </div>
      <div id="imp-preview"></div>
    </div>
    <details class="panel"><summary>支援的格式</summary><pre>${esc(FORMAT_HELP)}</pre></details>`);
  updateImportPreview();
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

  const items = result.cards.map((c) => `
    <div class="pv">
      <div class="t"><b>${esc(c.word)}</b><span>例句 ${c.en.length}・翻譯 ${c.zh.length}・搭配 ${c.collocations.length}${c.memory ? '・記憶 ✓' : ''}</span></div>
      <div class="muted small">${esc(c.meaning)}</div>
      ${warn.has(c.word) ? `<div class="w">⚠ ${warn.get(c.word).map(esc).join('；')}</div>` : ''}
    </div>`).join('');
  const dupes = result.warnings.filter((w) => !result.cards.some((c) => c.word === w.word));
  const errs = result.errors.map((e) => `<div class="pv err"><div class="t"><b>無法解析</b></div><div class="w">${esc(e.error)}${e.snippet ? `：${esc(e.snippet)}` : ''}</div></div>`).join('');

  box.innerHTML = `
    <p class="summary">解析到 <b>${result.cards.length}</b> 個單字${updating ? `（新增 <b>${adding}</b>、更新 <b>${updating}</b>）` : ''}${result.errors.length ? `，<span style="color:var(--danger)">${result.errors.length} 段無法解析</span>` : ''}</p>
    <div class="preview">${errs}${items}${dupes.map((w) => `<div class="pv"><div class="w">⚠ ${esc(w.word)}：${w.msgs.map(esc).join('；')}</div></div>`).join('')}</div>
    ${result.cards.length ? `<button class="btn primary big" style="margin-top:14px" data-act="do-import">匯入 ${result.cards.length} 個單字</button>` : ''}`;
}

async function doImport() {
  const result = S.imp.result;
  if (!result || !result.cards.length) return;
  const byId = new Map(S.cards.map((c) => [c.id, c]));
  const base = Date.now();
  let added = 0;
  let updated = 0;
  const out = result.cards.map((fields, i) => {
    const id = wordKey(fields.word);
    const prev = byId.get(id);
    if (prev) {
      updated += 1;
      return { ...prev, ...fields, id };
    }
    added += 1;
    return srs.newCard({ id, ...fields, order: base + i });
  });
  await saveCards(out);
  S.imp = { text: '', result: null };
  toast(`已匯入：新增 ${added}${updated ? `、更新 ${updated}` : ''}`);
  go('today');
}

async function readFileInto(file) {
  if (!file) return;
  S.imp.text = await file.text();
  const ta = $('#imp-text');
  if (ta) ta.value = S.imp.text;
  updateImportPreview();
}

/* ------------------------------------------------------------- settings */

function renderSettings() {
  setView(`
    <div class="page-head"><h1>設定</h1><p class="sub">小金庫單字 v${APP_VERSION}</p></div>
    <div class="panel">
      <div class="set-row">
        <div><b>每天新字數量上限</b><p>每天最多進入第一次分級的新字</p></div>
        <div class="stepper"><button data-act="new-per-day" data-d="-1" aria-label="減少">−</button><b>${S.settings.newPerDay}</b><button data-act="new-per-day" data-d="1" aria-label="增加">＋</button></div>
      </div>
    </div>
    <div class="panel">
      <h2>備份與還原</h2>
      <p class="muted small" style="margin-bottom:12px">資料只存在這支手機的瀏覽器裡。換手機、清除網站資料前，請先匯出備份。</p>
      <div class="btn-row">
        <button class="btn" data-act="export">匯出備份</button>
        <label class="btn" for="restore-file">還原備份</label>
        <input id="restore-file" type="file" accept="application/json,.json" hidden>
      </div>
    </div>
    <div class="panel">
      <h2>儲存狀態</h2>
      <p class="muted small">儲存方式：${esc(S.store.kind)}・共 ${S.cards.length} 個單字</p>
    </div>
    <div class="panel">
      <h2>危險區</h2>
      <button class="btn danger" data-act="wipe">清除所有單字與進度</button>
    </div>`);
}

function exportBackup() {
  const data = { app: 'xiaojinku-vocab', version: 1, exportedAt: new Date().toISOString(), settings: S.settings, days: S.days, cards: S.cards };
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
    const cards = data.cards.filter((c) => c && c.id && c.word && Array.isArray(c.en) && Array.isArray(c.zh));
    cards.forEach((c) => { c.collocations = Array.isArray(c.collocations) ? c.collocations : []; });
    await saveCards(cards);
    if (data.settings) { S.settings = { ...DEFAULT_SETTINGS, ...data.settings }; await saveMeta('settings', S.settings); }
    if (Array.isArray(data.days)) { S.days = [...new Set([...S.days, ...data.days])].slice(-400); await saveMeta('days', S.days); }
    toast(`已還原 ${cards.length} 個單字`);
    render();
  } catch {
    toast('這不是有效的備份檔');
  }
}

/* --------------------------------------------------------------- events */

const actions = {
  tab: (el) => go(el.dataset.tab),
  start: startStudy,
  flip: flipCard,
  speak: (el) => speak(el.dataset.text),
  'rate-new': (el) => rateNew(Number(el.dataset.stars)),
  grade: (el) => gradeCard(el.dataset.grade),
  retry: (el) => retryCard(el.dataset.again === '1'),
  adjust: (el) => adjustStars(Number(el.dataset.stars)),
  'exit-study': () => {
    if (!S.study) return;
    const doneAny = S.study.i > 0;
    if (!doneAny || confirm('要結束今天的學習嗎？已完成的進度都會保留。')) { S.study = null; render(); }
  },
  'more-new': () => { newState().bonus += 5; saveMeta('newToday', S.newToday); renderToday(); },
  'more-new-start': () => { newState().bonus += 5; saveMeta('newToday', S.newToday); S.study = null; startStudy(); },
  'dismiss-banner': () => { try { localStorage.setItem('xj-banner', '1'); } catch { /* ignore */ } renderToday(); },
  filter: (el) => {
    S.lib.filter = el.dataset.filter;
    document.querySelectorAll('#lib-filters button').forEach((b) => b.classList.toggle('on', b === el));
    $('#lib-list').innerHTML = listHtml();
  },
  'open-card': (el) => openCardSheet(el.dataset.id),
  'close-sheet': closeSheet,
  'sheet-stars': async (el) => {
    const c = cardById(el.dataset.id);
    await saveCards([srs.changeStars(c, Number(el.dataset.stars))]);
    openCardSheet(c.id);
    if (S.tab === 'library') $('#lib-list').innerHTML = listHtml();
  },
  'delete-card': async (el) => {
    const c = cardById(el.dataset.id);
    if (!confirm(`刪除「${c.word}」？此動作無法復原。`)) return;
    await S.store.remove(c.id);
    S.cards = S.cards.filter((x) => x.id !== c.id);
    closeSheet();
    render();
    toast('已刪除');
  },
  'copy-prompt': async () => {
    try { await navigator.clipboard.writeText(AI_PROMPT); toast('提示詞已複製，貼給 ChatGPT 後接上今天的單字'); }
    catch { toast('複製失敗，請長按選取文字手動複製'); }
  },
  'load-sample': async () => {
    try {
      const res = await fetch('samples/sample-words.txt');
      S.imp.text = await res.text();
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
  'imp-clear': () => { S.imp.text = ''; $('#imp-text').value = ''; updateImportPreview(); },
  'do-import': doImport,
  'new-per-day': async (el) => {
    S.settings.newPerDay = Math.min(100, Math.max(1, S.settings.newPerDay + Number(el.dataset.d)));
    await saveMeta('settings', S.settings);
    renderSettings();
  },
  export: exportBackup,
  wipe: async () => {
    if (!confirm('確定要清除所有單字與進度嗎？')) return;
    if (!confirm('再確認一次：這會刪除全部資料，且無法復原。')) return;
    await S.store.clear();
    S.cards = []; S.days = []; S.settings = { ...DEFAULT_SETTINGS }; S.newToday = { date: '', count: 0, bonus: 0 };
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

document.addEventListener('input', (e) => {
  if (e.target.id === 'imp-text') { S.imp.text = e.target.value; updateImportPreview(); }
  if (e.target.id === 'lib-q') { S.lib.q = e.target.value; $('#lib-list').innerHTML = listHtml(); }
});

document.addEventListener('change', (e) => {
  if (e.target.id === 'imp-file') { readFileInto(e.target.files[0]); e.target.value = ''; }
  if (e.target.id === 'restore-file') { restoreBackup(e.target.files[0]); e.target.value = ''; }
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
  if (entry.retry) {
    if (e.key === '1') retryCard(true);
    if (e.key === '2' || e.key === ' ') retryCard(false);
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
    S.cards = await S.store.getAll();
    S.settings = { ...DEFAULT_SETTINGS, ...((await S.store.getMeta('settings')) || {}) };
    S.days = (await S.store.getMeta('days')) || [];
    S.newToday = (await S.store.getMeta('newToday')) || S.newToday;
  } catch {
    toast('讀取資料時發生問題');
  }
  newState();
  render();

  if ('speechSynthesis' in window) {
    voices = speechSynthesis.getVoices();
    speechSynthesis.onvoiceschanged = () => { voices = speechSynthesis.getVoices(); };
  }
  navigator.storage?.persist?.().catch(() => {});
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
}

boot();
