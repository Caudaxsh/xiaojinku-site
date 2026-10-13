// Extracts plain text from a PDF in the browser with pdf.js (vendored, loaded
// only when a PDF is picked). Rebuilds lines from text positions and re-joins
// lines that the PDF wrapped at the right margin, so one English sentence
// does not turn into two.

// Plain .js names on purpose: every static host serves .js as JavaScript, while some serve .mjs as
// application/octet-stream, which makes browsers refuse to load a module.
const LIB = new URL('../vendor/pdfjs/pdf.min.js', import.meta.url).href;
const WORKER = new URL('../vendor/pdfjs/pdf.worker.min.js', import.meta.url).href;
// pdf.js 3.x (classic scripts, legacy build): runs on far older and odder browsers than 6.x, so it goes first.
const LIB3 = new URL('../vendor/pdfjs3/pdf.min.js', import.meta.url).href;
const WORKER3 = new URL('../vendor/pdfjs3/pdf.worker.min.js', import.meta.url).href;

const NOISE = [/^\d{1,3}$/, /^page\s*\d+/i, /^\d+\s*\/\s*\d+$/, /^第\s*\d+\s*頁/, /^-\s*\d+\s*-$/];
const TERMINAL = /[.!?。！？」”"]$/;
// A line that starts a new heading, list item or IPA line is never the tail of a wrapped line.
const STRUCTURAL = /^(?:#{1,6}\s*\S|[-•*·●○■]\s|\d+\s*[.)、]\s|[/[][^\s]*[/\]]$|音標[:：])/;
const CIRCLED = '①②③④⑤⑥⑦⑧⑨⑩';

/**
 * Glyphs the PDF font could not map come out as NUL. Two very different things cause that:
 *  - ① ② in a numbered list (ChatGPT's font has no circled numbers): restore them in order;
 *  - a rare Chinese character the font does not contain, which is simply missing from the PDF:
 *    nothing can recover it, so mark the spot with □ and tell the user where it was.
 * A NUL counts as a list number only where a number could stand: at the start of a line, after a
 * colon / semicolon / opening bracket, or when the same line has several of them in a row.
 */
export function fixGlyphs(text, stats) {
  stats.missingAt ||= [];
  const out = text
    .split('\n')
    .map((line) => {
      const nuls = (line.match(/\u0000/g) || []).length;
      if (!nuls) return line;
      let n = 0;
      return line.replace(/\u0000/g, (m, offset) => {
        const before = line.slice(0, offset).replace(/\s+$/, '');
        const asNumber = nuls >= 2 || !before || /[：:；;（(]$/.test(before);
        if (asNumber) { stats.restored += 1; return CIRCLED[n++] || '•'; }
        stats.missing = (stats.missing || 0) + 1;
        stats.missingAt.push(line.replace(/\u0000/g, '□').trim().slice(0, 60));
        return '□';
      });
    })
    .join('\n')
    .replace(/[\u0001-\u0008\u000b-\u001f\u007f]/g, '');
  stats.tofu += (out.match(/\uFFFD/g) || []).length;
  return out;
}
const LATIN_END = /[A-Za-z0-9,;'’)\]-]$/;
const LATIN_START = /^[A-Za-z0-9('‘"“]/;

function pageLines(items, pageWidth, pageHeight, stats) {
  const lines = [];
  let cur = null;
  for (const it of items) {
    if (typeof it.str !== 'string') continue;
    const [, , , d, x, y] = it.transform;
    const h = Math.abs(d) || it.height || 10;
    if (it.str.trim() || cur) {
      if (!cur || Math.abs(y - cur.y) > h * 0.5) {
        if (cur) lines.push(cur);
        cur = { y, h, x0: x, x1: x, text: '' };
      }
      if (cur.text && x - cur.x1 > h * 0.2 && !/\s$/.test(cur.text) && !/^\s/.test(it.str)) cur.text += ' ';
      cur.text += it.str;
      cur.x0 = Math.min(cur.x0, x);
      cur.x1 = Math.max(cur.x1, x + (it.width || 0));
    }
    if (it.hasEOL && cur) {
      lines.push(cur);
      cur = null;
    }
  }
  if (cur) lines.push(cur);
  return lines
    .map((l) => ({ ...l, text: fixGlyphs(l.text, stats).replace(/\s+/g, ' ').trim(), pageWidth, pageHeight }))
    .filter((l) => l.text && !NOISE.some((re) => re.test(l.text)));
}

const CJK_CHAR = /[\u3400-\u9fff\uf900-\ufaff]/;
const CJK_WIDTH = 1.7; // a CJK glyph is roughly this many Latin letters wide

const weighted = (text) => [...text].reduce((n, ch) => n + (CJK_CHAR.test(ch) ? CJK_WIDTH : 1), 0);

/** Width of one Latin letter on this line, measured from the line itself. */
function letterWidth(line) {
  const w = weighted(line.text);
  return w > 0 && line.x1 > line.x0 ? (line.x1 - line.x0) / w : line.h * 0.55;
}

/** Width of the first thing that could not be split further at the start of a line. */
function leadWidth(line) {
  const u = letterWidth(line);
  if (CJK_CHAR.test(line.text[0])) return CJK_WIDTH * u;
  const run = line.text.match(/^[^\s\u3400-\u9fff\uf900-\ufaff]+/);
  return (run ? weighted(run[0]) : 1) * u;
}

/**
 * A PDF wraps a line only when the next word does not fit. So the next line is a
 * continuation when the space left at the end of this line is smaller than that word.
 */
export function joinWrapped(lines) {
  if (!lines.length) return [];
  const right = Math.max(...lines.map((l) => l.x1));
  const left = Math.min(...lines.map((l) => l.x0));
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    let line = { ...lines[i] };
    while (i + 1 < lines.length) {
      const next = lines[i + 1];
      const u = letterWidth(next);
      const slack = right - line.x1;
      const couldNotFit = slack < leadWidth(next) + u * 1.2 && slack > -line.h;
      const nearlyFull = slack < (right - left) * 0.4;
      const sentenceDone = /[。！？]$/.test(line.text) || (TERMINAL.test(line.text) && !/^[a-z]/.test(next.text));
      // A paragraph may run over a page break, so only the page size has to match.
      const samePaper = next.pageWidth === line.pageWidth;
      if (!couldNotFit || !nearlyFull || sentenceDone || !samePaper || STRUCTURAL.test(next.text)) break;
      const hyphenBreak = line.text.endsWith('-') && /^[a-z]/.test(next.text);
      const glue = !hyphenBreak && LATIN_END.test(line.text) && LATIN_START.test(next.text) ? ' ' : '';
      line = { ...line, text: line.text + glue + next.text, x1: next.x1 };
      i += 1;
    }
    out.push(line);
  }
  return out;
}

const shape = (t) => t.toLowerCase().replace(/\d+/g, '#').replace(/\s+/g, ' ').trim();

/**
 * Drop running headers/footers: the same text (page numbers ignored) sitting in the
 * top or bottom band of at least half of the pages.
 */
export function stripRunningLines(lines, pageCount) {
  if (pageCount < 3) return { lines, removed: 0 };
  const seen = new Map();
  const band = (l) => (l.y > l.pageHeight * 0.9 ? 'top' : l.y < l.pageHeight * 0.1 ? 'bottom' : null);
  for (const l of lines) {
    const b = band(l);
    if (!b) continue;
    const key = `${b}|${shape(l.text)}`;
    if (!seen.has(key)) seen.set(key, new Set());
    seen.get(key).add(l.page);
  }
  const need = Math.max(2, Math.ceil(pageCount * 0.5));
  const drop = new Set([...seen].filter(([, pages]) => pages.size >= need).map(([k]) => k));
  if (!drop.size) return { lines, removed: 0 };
  const kept = lines.filter((l) => !(band(l) && drop.has(`${band(l)}|${shape(l.text)}`)));
  return { lines: kept, removed: lines.length - kept.length };
}

/* ------------------------------------------------------------- loading pdf.js */

const STALL_MS = 25000;

const withTimeout = (promise, ms, what) => new Promise((resolve, reject) => {
  const t = setTimeout(() => reject(new Error(`${what} 超過 ${ms / 1000} 秒沒有回應`)), ms);
  promise.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
});

/** Import a script even if the host serves it with the wrong MIME type: fetch it and re-wrap it as a Blob. */
async function importViaBlob(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`下載 ${url.split('/').pop()} 失敗（HTTP ${res.status}）`);
  const blobUrl = URL.createObjectURL(new Blob([await res.text()], { type: 'text/javascript' }));
  return { mod: await import(blobUrl), blobUrl };
}

function loadScript(url) {
  return new Promise((resolve, reject) => {
    const el = document.createElement('script');
    el.src = url;
    el.onload = () => resolve();
    el.onerror = () => reject(new Error(`載入 ${url.split('/').slice(-2).join('/')} 失敗`));
    document.head.append(el);
  });
}

/** Run pdf.js in this thread: pdf.js falls back to that by itself when creating a Worker throws. */
function withoutWorkers() {
  const real = globalThis.Worker;
  globalThis.Worker = function Disabled() { throw new Error('worker disabled'); };
  return () => { globalThis.Worker = real; };
}

/**
 * Ways to start pdf.js, from the most compatible to the newest. The first that works is used.
 *   v3          — pdf.js 3.x as classic scripts + Web Worker (runs on old and unusual browsers)
 *   v3-main     — the same without a Web Worker
 *   v6          — pdf.js 6.x modules + Web Worker
 *   v6-blob     — same files re-wrapped as Blobs (hosts that serve the wrong file type)
 *   v6-main     — pdf.js 6.x without a Web Worker
 */
const LOADERS = [
  { id: 'v3', async load() {
    if (!globalThis.pdfjsLib) await loadScript(LIB3);
    globalThis.pdfjsLib.GlobalWorkerOptions.workerSrc = WORKER3;
    return { pdfjs: globalThis.pdfjsLib, cleanup() {} };
  } },
  { id: 'v3-main', async load() {
    if (!globalThis.pdfjsLib) await loadScript(LIB3);
    globalThis.pdfjsLib.GlobalWorkerOptions.workerSrc = WORKER3;
    return { pdfjs: globalThis.pdfjsLib, cleanup: withoutWorkers() };
  } },
  { id: 'v6', async load() {
    const pdfjs = await import(LIB);
    pdfjs.GlobalWorkerOptions.workerSrc = WORKER;
    return { pdfjs, cleanup() {} };
  } },
  { id: 'v6-blob', async load() {
    const { mod: pdfjs } = await importViaBlob(LIB);
    const { blobUrl } = await importViaBlob(WORKER);
    pdfjs.GlobalWorkerOptions.workerPort = new Worker(blobUrl, { type: 'module' });
    return { pdfjs, cleanup() { pdfjs.GlobalWorkerOptions.workerPort?.terminate(); pdfjs.GlobalWorkerOptions.workerPort = null; } };
  } },
  { id: 'v6-main', async load() {
    const { mod: pdfjs } = await importViaBlob(LIB);
    const { mod: worker } = await importViaBlob(WORKER);
    globalThis.pdfjsWorker = worker;
    return { pdfjs, cleanup: withoutWorkers() };
  } },
];

async function extract(pdfjs, data, onProgress) {
  const task = pdfjs.getDocument({ data: data.slice(), isEvalSupported: false });
  try {
    const doc = await withTimeout(task.promise, STALL_MS, '開啟 PDF');
    const stats = { pages: doc.numPages, restored: 0, missing: 0, missingAt: [], tofu: 0, headerLines: 0 };
    let lines = [];
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await withTimeout(doc.getPage(n), STALL_MS, `讀取第 ${n} 頁`);
      const { width, height } = page.getViewport({ scale: 1 });
      const content = await withTimeout(page.getTextContent(), STALL_MS, `讀取第 ${n} 頁文字`);
      pageLines(content.items, width, height, stats).forEach((l) => lines.push({ ...l, page: n }));
      onProgress(n, doc.numPages);
    }
    const stripped = stripRunningLines(lines, doc.numPages);
    lines = stripped.lines;
    stats.headerLines = stripped.removed;
    return { text: joinWrapped(lines).map((l) => l.text).join('\n'), stats };
  } finally {
    try { task.destroy(); } catch { /* already gone */ }
  }
}

/** True for a real PDF: the header "%PDF-" appears within the first KB (the PDF spec allows junk before it). */
export function hasPdfHeader(bytes) {
  const head = new TextDecoder('latin1').decode(bytes.subarray(0, 1024));
  return head.includes('%PDF-');
}

export class PdfReadError extends Error {
  constructor(kind, message, diag) { super(message); this.name = 'PdfReadError'; this.kind = kind; this.diag = diag; }
}

/** What the user is told for each kind of failure. */
export function explain(kind) {
  return {
    password: '這個 PDF 有密碼保護，讀不了。請先解除密碼，或請 ChatGPT 重新輸出一份。',
    invalid: '這個檔案不是完整的 PDF（可能下載到一半，或被改過副檔名）。請重新下載，或改用「貼上版」。',
    empty: '這個 PDF 裡讀不到文字，可能是掃描成圖片的 PDF。請改用「貼上版」提示詞，直接複製 ChatGPT 的回覆。',
    engine: '這個瀏覽器跑不起 PDF 讀取元件（已經試過 5 種方式）。請改用「貼上版」提示詞：複製 ChatGPT 的回覆再貼上就好。',
  }[kind] || '讀取失敗。';
}

/** Same as pdfToText, plus a small report the import screen can show. Throws PdfReadError. */
export async function pdfToTextWithStats(file, onProgress = () => {}) {
  const data = new Uint8Array(await file.arrayBuffer());
  const diag = { file: { name: file.name, size: file.size, type: file.type }, tries: [], pdfjs: '3.11.174 + 6.3.289' };
  if (!data.length) throw new PdfReadError('invalid', '檔案是空的', diag);
  if (!hasPdfHeader(data)) throw new PdfReadError('invalid', '找不到 %PDF 檔頭', diag);
  for (const loader of LOADERS) {
    let session = null;
    const t0 = performance.now();
    try {
      session = await withTimeout(loader.load(), STALL_MS, '載入 PDF 元件');
      const out = await extract(session.pdfjs, data, onProgress);
      diag.tries.push({ step: loader.id, ok: true, ms: Math.round(performance.now() - t0) });
      out.stats.via = loader.id;
      out.stats.diag = diag;
      return out;
    } catch (err) {
      const name = err?.name || 'Error';
      diag.tries.push({ step: loader.id, ok: false, error: `${name}: ${err?.message || err}`, ms: Math.round(performance.now() - t0) });
      // These are about the file, not about how pdf.js was started: retrying cannot help.
      if (name === 'PasswordException') throw new PdfReadError('password', err.message, diag);
      if (name === 'InvalidPDFException' || name === 'FormatError') throw new PdfReadError('invalid', err.message, diag);
    } finally {
      session?.cleanup();
    }
  }
  throw new PdfReadError('engine', '所有載入方式都失敗', diag);
}

export async function pdfToText(file, onProgress = () => {}) {
  return (await pdfToTextWithStats(file, onProgress)).text;
}

/** Plain-text report the user can copy and send when something fails. */
export function formatDiag(diag, extra = '') {
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
  return [
    'Cash Volcab PDF 診斷', extra, `檔案：${diag.file.name}（${diag.file.size} bytes，${diag.file.type || '未知類型'}）`,
    ...diag.tries.map((t) => `- ${t.step}: ${t.ok ? '成功' : `失敗 ${t.error}`} (${t.ms}ms)`),
    `瀏覽器：${ua}`,
  ].filter(Boolean).join('\n');
}
