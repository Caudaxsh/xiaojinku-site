// Extracts plain text from a PDF in the browser with pdf.js (vendored, loaded
// only when a PDF is picked). Rebuilds lines from text positions and re-joins
// lines that the PDF wrapped at the right margin, so one English sentence
// does not turn into two.

const LIB = new URL('../vendor/pdfjs/pdf.min.mjs', import.meta.url).href;
const WORKER = new URL('../vendor/pdfjs/pdf.worker.min.mjs', import.meta.url).href;

const NOISE = [/^\d{1,3}$/, /^page\s*\d+/i, /^\d+\s*\/\s*\d+$/, /^第\s*\d+\s*頁/, /^-\s*\d+\s*-$/];
const TERMINAL = /[.!?。！？」”"]$/;
// A line that starts a new heading, list item or IPA line is never the tail of a wrapped line.
const STRUCTURAL = /^(?:#{1,6}\s*\S|[-•*·●○■]\s|\d+\s*[.)、]\s|[/[][^\s]*[/\]]$|音標[:：])/;
const CIRCLED = '①②③④⑤⑥⑦⑧⑨⑩';

/** Glyphs the PDF font could not map (e.g. ① ②) come out as NUL; restore them in order. */
function fixGlyphs(text, stats) {
  let n = 0;
  const out = text
    .replace(/\u0000/g, () => { stats.restored += 1; return CIRCLED[n++] || '•'; })
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

/** Same as pdfToText, plus a small report the import screen can show. */
export async function pdfToTextWithStats(file, onProgress = () => {}) {
  const pdfjs = await import(LIB);
  pdfjs.GlobalWorkerOptions.workerSrc = WORKER;
  const data = new Uint8Array(await file.arrayBuffer());
  const task = pdfjs.getDocument({ data, isEvalSupported: false });
  const doc = await task.promise;
  const stats = { pages: doc.numPages, restored: 0, tofu: 0, headerLines: 0 };
  let lines = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n);
    const { width, height } = page.getViewport({ scale: 1 });
    const content = await page.getTextContent();
    pageLines(content.items, width, height, stats).forEach((l) => lines.push({ ...l, page: n }));
    onProgress(n, doc.numPages);
  }
  task.destroy();
  const stripped = stripRunningLines(lines, doc.numPages);
  lines = stripped.lines;
  stats.headerLines = stripped.removed;
  return { text: joinWrapped(lines).map((l) => l.text).join('\n'), stats };
}

export async function pdfToText(file, onProgress = () => {}) {
  return (await pdfToTextWithStats(file, onProgress)).text;
}
