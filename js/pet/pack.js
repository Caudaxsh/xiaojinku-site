// A character pack is one JSON file: a sprite sheet (PNG data URL) plus a table of named clips.
// The site ships one built-in pack (pet/goku.petpack.json); a pack loaded from Settings replaces it on that device.
//
//   { v: 1, name, w, h, cols, count, scale, base,
//     sheet: "data:image/png;base64,...",
//     clips: { idle: { label, mode: "loop"|"once"|"hold", side: bool, seq: [[frame, ms], ...], cardRect?: [x0,y0,x1,y1] } } }
//
// `side` clips are drawn facing right; the player mirrors them for left.

export const REQUIRED_CLIPS = ['idle'];
export const MAX_PACK_BYTES = 2 * 1024 * 1024;

export function validatePack(p) {
  if (!p || typeof p !== 'object') return 'not a pack';
  if (p.v !== 1) return 'unsupported version';
  for (const k of ['w', 'h', 'cols', 'count']) if (!Number.isInteger(p[k]) || p[k] < 1 || p[k] > 4096) return `bad ${k}`;
  if (typeof p.sheet !== 'string' || !p.sheet.startsWith('data:image/png;base64,')) return 'sheet must be a PNG data URL';
  if (!p.clips || typeof p.clips !== 'object') return 'no clips';
  for (const name of REQUIRED_CLIPS) if (!p.clips[name]) return `missing clip "${name}"`;
  for (const [name, c] of Object.entries(p.clips)) {
    if (!['loop', 'once', 'hold'].includes(c.mode)) return `clip ${name}: bad mode`;
    if (!Array.isArray(c.seq) || !c.seq.length) return `clip ${name}: empty`;
    for (const step of c.seq) {
      if (!Array.isArray(step) || !Number.isInteger(step[0]) || step[0] < 0 || step[0] >= p.count || !(step[1] > 0)) return `clip ${name}: bad frame`;
    }
  }
  return null;
}

export async function readPackFile(file) {
  if (!file) throw new Error('no file');
  if (file.size > MAX_PACK_BYTES) throw new Error('檔案太大');
  const pack = JSON.parse(await file.text());
  const err = validatePack(pack);
  if (err) throw new Error(err);
  return pack;
}

export const BUILTIN_URL = 'pet/goku.petpack.json';

/** The character that ships with the site. */
export async function loadBuiltin() {
  try {
    const res = await fetch(new URL(`../../${BUILTIN_URL}`, import.meta.url));
    const pack = await res.json();
    return validatePack(pack) ? null : pack;
  } catch {
    return null;
  }
}

/** A pack the user loaded on this device wins; otherwise the built-in character. */
export async function loadPack(store) {
  try {
    const own = await store.getMeta('petpack');
    if (own && !validatePack(own)) return { pack: own, builtin: false };
  } catch { /* fall through to the built-in character */ }
  const pack = await loadBuiltin();
  return pack ? { pack, builtin: true } : { pack: null, builtin: false };
}
