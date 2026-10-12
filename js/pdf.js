// Extracts plain text from a PDF in the browser with pdf.js (vendored, loaded
// only when a PDF is picked). Rebuilds lines from text positions and re-joins
// lines that the PDF wrapped at the right margin, so one English sentence
// does not turn into two.

const LIB = new URL('../vendor/pdfjs/pdf.min.mjs', import.meta.url).href;
const WORKER = new URL('../vendor/pdfjs/pdf.worker.min.mjs', import.meta.url).href;

const NOISE = [/^\d{1,3}$/, /^page\s*\d+/i, /^\d+\s*\/\s*\d+$/, /^第\s*\d+\s*頁/, /^-\s*\d+\s*-$/];
const TERMINAL = /[.!?。！？」”"]$/;
// A line that starts a new heading, list item or IPA line is never the tail of a wrapped line.
const STRUCTURAL = /^(?:#{1,6}\s|[-•*·]\s|\d+\s*[.)、]\s|[/[][^\s]*[/\]]$)/;
const CIRCLED = '①②③④⑤⑥⑦⑧⑨⑩';

/** Glyphs the PDF font could not map (e.g. ① ②) come out as NUL; restore them in order. */
function fixGlyphs(text) {
  let n = 0;
  return text
    .replace(/\u0000/g, () => CIRCLED[n++] || '•')
    .replace(/[\u0001-\u0008\u000b-\u001f\u007f]/g, '');
}
const LATIN_END = /[A-Za-z0-9,;'’)\]-]$/;
const LATIN_START = /^[A-Za-z0-9('‘"“]/;

function pageLines(items, pageWidth) {
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
    .map((l) => ({ ...l, text: fixGlyphs(l.text).replace(/\s+/g, ' ').trim(), pageWidth }))
    .filter((l) => l.text && !NOISE.some((re) => re.test(l.text)));
}

/** Join a line with the next one when it ran into the right margin. */
export function joinWrapped(lines) {
  if (!lines.length) return [];
  const left = Math.min(...lines.map((l) => l.x0));
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    let line = { ...lines[i] };
    while (i + 1 < lines.length) {
      const next = lines[i + 1];
      const rightLimit = line.pageWidth - left;
      const reachedMargin = line.x1 >= rightLimit - line.h * 2.5;
      const sentenceDone = /[。！？]$/.test(line.text) || (TERMINAL.test(line.text) && !/^[a-z]/.test(next.text));
      const samePage = next.pageWidth === line.pageWidth && next.page === line.page;
      if (!reachedMargin || sentenceDone || !samePage || STRUCTURAL.test(next.text)) break;
      const glue = LATIN_END.test(line.text) && LATIN_START.test(next.text) ? ' ' : '';
      line = { ...line, text: line.text + glue + next.text, x1: next.x1 };
      i += 1;
    }
    out.push(line);
  }
  return out;
}

export async function pdfToText(file, onProgress = () => {}) {
  const pdfjs = await import(LIB);
  pdfjs.GlobalWorkerOptions.workerSrc = WORKER;
  const data = new Uint8Array(await file.arrayBuffer());
  const task = pdfjs.getDocument({ data, isEvalSupported: false });
  const doc = await task.promise;
  const lines = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n);
    const { width } = page.getViewport({ scale: 1 });
    const content = await page.getTextContent();
    pageLines(content.items, width).forEach((l) => lines.push({ ...l, page: n }));
    onProgress(n, doc.numPages);
  }
  task.destroy();
  return joinWrapped(lines).map((l) => l.text).join('\n');
}
