// Cash Volcab icon system.
// One grid (24×24), one stroke (1.75, round caps and joins), one line colour
// (deep ink green), and small accent touches in mint, coral or cream.
// Accents are drawn first so the ink line always sits on top, like the reference sheet.
//
// Generic UI glyphs are adapted from Lucide (ISC licence, https://lucide.dev);
// the vocabulary icons are drawn for this app following the reference sheet.
//
// Usage: icon('translate')  ·  icon('due', { size: 28, label: '待複習' })

// Accent classes, styled in styles.css (.ic .m / .mf / .c / .cf / .y / .yf):
//   m = mint stroke, mf = mint fill, c = coral stroke, cf = coral fill, y = cream stroke, yf = cream fill.
const PATHS = {
  /* ---------------- vocabulary icons ---------------- */
  example: `
    <path class="m" d="M8.5 12.5h7"/>
    <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/>
    <path d="M14 3v5h5"/>
    <path d="M8.5 9h3M8.5 16h5"/>`,
  translate: `
    <path class="c" d="M10.5 16.5h5l3 2.6v-2.6h.5a2 2 0 0 0 2-2v-4.5a2 2 0 0 0-2-2h-1.2"/>
    <path d="M5 3.5h10a2 2 0 0 1 2 2V12a2 2 0 0 1-2 2H9.5L6 17v-3H5a2 2 0 0 1-2-2V5.5a2 2 0 0 1 2-2z"/>
    <path d="M7 8.75h.01M10 8.75h.01M13 8.75h.01" stroke-width="2.4"/>`,
  tip: `
    <path class="y" d="M12 1.8v1.6M5.4 4.2l1.1 1.1M18.6 4.2l-1.1 1.1M3 10.2h1.6M19.4 10.2h1.6"/>
    <path d="M9.6 17.4v-1.2c0-1-.5-1.8-1.3-2.6A5 5 0 1 1 15.7 13.6c-.8.8-1.3 1.6-1.3 2.6v1.2"/>
    <path d="M9.6 17.4h4.8M10.6 20.6h2.8"/>`,
  root: `
    <circle class="mf" cx="17.2" cy="13.5" r="2.1"/>
    <path d="M4 9a2 2 0 0 1 2-2h2.2a2.3 2.3 0 1 1 4.6 0H15a2 2 0 0 1 2 2v2.2a2.3 2.3 0 1 1 0 4.6V18a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-2.2a2.3 2.3 0 1 0 0-4.6Z"/>`,
  forms: `
    <circle class="mf" cx="18.5" cy="17.5" r="2.5"/>
    <path class="c" d="M12 2.5a2.5 2.5 0 0 1 2.5 2.5"/>
    <circle cx="12" cy="5" r="2.5"/>
    <circle cx="5.5" cy="17.5" r="2.5"/>
    <circle cx="18.5" cy="17.5" r="2.5"/>
    <path d="M10.85 7.22 6.65 15.28M13.15 7.22l4.2 8.06"/>`,
  tag: `
    <path d="M11.41 2.59A2 2 0 0 1 12.83 2H20a2 2 0 0 1 2 2v7.17a2 2 0 0 1-.59 1.42l-8.7 8.7a2.43 2.43 0 0 1-3.42 0l-6.58-6.58a2.43 2.43 0 0 1 0-3.42z"/>
    <circle class="c" cx="16.5" cy="7.5" r="1.6"/>`,
  difficulty: `
    <clipPath id="{{id}}"><path d="M13 11.5 24 9.5V24H12.5z"/></clipPath>
    <path class="yf" clip-path="url(#{{id}})" d="M11.53 2.3a.53.53 0 0 1 .95 0l2.31 4.68a2.12 2.12 0 0 0 1.6 1.16l5.16.76a.53.53 0 0 1 .3.9l-3.74 3.64a2.12 2.12 0 0 0-.61 1.88l.88 5.14a.53.53 0 0 1-.77.56l-4.62-2.43a2.12 2.12 0 0 0-1.97 0L6.4 21.01a.53.53 0 0 1-.77-.56l.88-5.14a2.12 2.12 0 0 0-.61-1.88L2.16 9.8a.53.53 0 0 1 .3-.91l5.16-.75a2.12 2.12 0 0 0 1.6-1.16z"/>
    <path d="M11.53 2.3a.53.53 0 0 1 .95 0l2.31 4.68a2.12 2.12 0 0 0 1.6 1.16l5.16.76a.53.53 0 0 1 .3.9l-3.74 3.64a2.12 2.12 0 0 0-.61 1.88l.88 5.14a.53.53 0 0 1-.77.56l-4.62-2.43a2.12 2.12 0 0 0-1.97 0L6.4 21.01a.53.53 0 0 1-.77-.56l.88-5.14a2.12 2.12 0 0 0-.61-1.88L2.16 9.8a.53.53 0 0 1 .3-.91l5.16-.75a2.12 2.12 0 0 0 1.6-1.16z"/>`,
  familiarity: `
    <path class="m" d="M4 16a8 8 0 0 1 3-6.25"/>
    <path d="M4 16a8 8 0 0 1 16 0"/>
    <path d="M12 16l3.6-4.4"/>
    <circle cx="12" cy="16" r="1.2"/>
    <path d="M3 19.5h18"/>`,
  mastered: `
    <circle cx="12" cy="12" r="9"/>
    <path class="m" d="m8.2 12.3 2.6 2.6 5-5.3" stroke-width="2"/>`,
  reviewing: `
    <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/>
    <path d="M21 3v5h-5"/>
    <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/>
    <path d="M8 16H3v5"/>
    <path class="m" d="M21 12a9 9 0 0 1-3.6 7.2"/>`,
  due: `
    <path class="yf" d="M8.4 20.4h7.2l-.3-2.3L12 15.4l-3.3 2.7z"/>
    <path class="yf" d="M9.4 7.3h5.2L12 9.8z"/>
    <path d="M5 22h14M5 2h14"/>
    <path d="M17 22v-4.17a2 2 0 0 0-.59-1.42L12 12l-4.41 4.41A2 2 0 0 0 7 17.83V22"/>
    <path d="M7 2v4.17a2 2 0 0 0 .59 1.42L12 12l4.41-4.41A2 2 0 0 0 17 6.17V2"/>`,
  book: `
    <path class="m" d="M5.5 8h3M5.5 11h3"/>
    <path class="c" d="M15.5 8h3M15.5 11h3"/>
    <path d="M12 7v14"/>
    <path d="M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3z"/>`,
  search: `
    <path class="c" d="m15.6 15.6 5.4 5.4" stroke-width="2.4"/>
    <circle cx="10.5" cy="10.5" r="6.8"/>`,
  today: `
    <path class="c" d="M9.3 14.1 10.8 13v6.2M13.6 13h3.3l-2.1 6.2"/>
    <rect x="3" y="4" width="18" height="18" rx="2"/>
    <path d="M16 2v4M8 2v4M3 10h18"/>`,
  stats: `
    <path class="m" d="M12 12.2v5.6"/>
    <path class="c" d="M18 7.2v10.6"/>
    <rect x="3.5" y="13" width="5" height="8" rx="1.6"/>
    <rect x="9.5" y="9" width="5" height="12" rx="1.6"/>
    <rect x="15.5" y="4" width="5" height="17" rx="1.6"/>`,
  trophy: `
    <path class="yf" d="M12 4.9 12.62 6.55 14.38 6.63 13 7.72 13.47 9.42 12 8.45 10.53 9.42 11 7.72 9.62 6.63 11.38 6.55Z"/>
    <path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6M18 9h1.5a2.5 2.5 0 0 0 0-5H18M4 22h16"/>
    <path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22"/>
    <path d="M18 2H6v7a6 6 0 0 0 12 0V2Z"/>`,
  compare: `
    <path class="m" d="M20 17H4m12 4 4-4-4-4"/>
    <path d="M8 3 4 7l4 4M4 7h16"/>`,

  /* ---------------- generic UI (Lucide) ---------------- */
  close: '<path d="M18 6 6 18M6 6l12 12"/>',
  speaker: `
    <path d="M11 4.7a.7.7 0 0 0-1.2-.5L6.41 7.59A1.4 1.4 0 0 1 5.42 8H3a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2.42a1.4 1.4 0 0 1 1 .41l3.38 3.38A.7.7 0 0 0 11 19.3z"/>
    <path d="M16 9a5 5 0 0 1 0 6M19.36 18.36a9 9 0 0 0 0-12.73"/>`,
  download: '<path d="M12 15V3M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5"/>',
  upload: '<path d="M12 3v12M17 8l-5-5-5 5M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>',
  settings: '<path d="M21 4h-7M10 4H3M21 12h-9M8 12H3M21 20h-5M12 20H3M14 2v4M8 10v4M16 18v4"/>',
  copy: '<rect x="8" y="8" width="14" height="14" rx="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>',
  paste: '<path d="M11 14h10M16 4h2a2 2 0 0 1 2 2v1.34M17 18l4-4-4-4M8 4H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 1.79-1.11"/><rect x="8" y="2" width="8" height="4" rx="1"/>',
  fileUp: '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4M12 12v6M15 15l-3-3-3 3"/>',
  eraser: '<path d="M21 21H8a2 2 0 0 1-1.42-.59l-3.99-4a2 2 0 0 1 0-2.82l10-10a2 2 0 0 1 2.83 0l6 6a2 2 0 0 1 0 2.82L12.83 21M5.08 11.09l8.83 8.83"/>',
  undo: '<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/>',
  trash: '<path d="M3 6h18M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2M10 11v6M14 11v6"/>',
};

/** Names and Chinese labels, in the order of the reference sheet. Used by the showcase page. */
export const ICON_CATALOG = [
  ['example', '例句'], ['translate', '中文翻譯'], ['tip', '用法提示'], ['root', '字根拆解'], ['forms', '相關詞形'],
  ['tag', '標籤'], ['difficulty', '難度'], ['mastered', '已掌握'], ['reviewing', '複習中'], ['due', '待複習'],
  ['book', '單字本'], ['search', '搜尋'], ['today', '今日任務'], ['stats', '學習統計'], ['trophy', '成就'],
  ['familiarity', '熟悉度'], ['compare', '易混淆比較'],
];
export const UI_CATALOG = [
  ['close', '關閉'], ['speaker', '發音'], ['download', '匯入'], ['upload', '還原'], ['settings', '設定'],
  ['copy', '複製'], ['paste', '貼上'], ['fileUp', '上傳檔案'], ['eraser', '清空'], ['undo', '復原'], ['trash', '刪除'],
];

export const ICON_NAMES = Object.keys(PATHS);

let uid = 0;

/**
 * Returns an inline SVG string. Decorative by default (aria-hidden);
 * pass `label` when the icon is the only thing that names a control.
 */
export function icon(name, { size = 20, label = '', cls = '' } = {}) {
  if (!PATHS[name]) throw new Error(`Unknown icon: ${name}`);
  // Icons with a clip path need an id that is unique on the page.
  const id = `ic${(uid += 1)}`;
  const body = PATHS[name].replace(/\{\{id\}\}/g, id);
  const a11y = label ? `role="img" aria-label="${label}"` : 'aria-hidden="true" focusable="false"';
  return `<svg class="ic${cls ? ` ${cls}` : ''}" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" ${a11y}>${body}</svg>`;
}

/** Fill every <… data-icon="name" data-size="20"> placeholder inside root. */
export function hydrateIcons(root = document) {
  root.querySelectorAll('[data-icon]').forEach((el) => {
    el.innerHTML = icon(el.dataset.icon, { size: Number(el.dataset.size) || 20 });
  });
}
