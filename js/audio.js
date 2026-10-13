// Pronunciation. Words try Cambridge Dictionary's US recording first, then
// Google Translate's voice, then the phone's built-in English voice.
// Sentences skip Cambridge (it only has single words).
//
// One shared <audio> element is used on purpose: iOS only lets a page play
// sound programmatically after that same element has been started by a tap.

const SILENT = 'data:audio/wav;base64,UklGRiwAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQgAAACAgICAgICAgA==';
const STORE_KEY = 'xj-audio-src';
const TIMEOUT_MS = 5000;

const player = new Audio();
player.preload = 'auto';

let memo = {};
try { memo = JSON.parse(localStorage.getItem(STORE_KEY)) || {}; } catch { memo = {}; }
const remember = (key, src) => {
  memo[key] = src;
  const keys = Object.keys(memo);
  if (keys.length > 3000) keys.slice(0, 500).forEach((k) => delete memo[k]);
  try { localStorage.setItem(STORE_KEY, JSON.stringify(memo)); } catch { /* full or blocked */ }
};

export function cambridgeUrl(word) {
  const w = word.trim().toLowerCase();
  if (!/^[a-z]+$/.test(w)) return null;
  const pad = (n) => (w + '_'.repeat(n)).slice(0, n);
  return `https://dictionary.cambridge.org/media/english/us_pron/${w[0]}/${pad(3)}/${pad(5)}/${w}.mp3`;
}

export function googleUrl(text) {
  return `https://translate.google.com/translate_tts?ie=UTF-8&client=tw-ob&tl=en-US&q=${encodeURIComponent(text.slice(0, 200))}`;
}

function tryPlay(src) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (ok) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      player.removeEventListener('playing', onPlaying);
      player.removeEventListener('error', onError);
      if (!ok) player.pause();
      resolve(ok);
    };
    const onPlaying = () => finish(true);
    const onError = () => finish(false);
    const timer = setTimeout(() => finish(false), TIMEOUT_MS);
    player.addEventListener('playing', onPlaying);
    player.addEventListener('error', onError);
    player.src = src;
    const p = player.play();
    if (p && p.catch) p.catch(() => finish(false));
  });
}

let voices = [];
function deviceVoice(text) {
  if (!('speechSynthesis' in window)) return false;
  if (!voices.length) voices = speechSynthesis.getVoices();
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = 'en-US';
  u.rate = 0.92;
  const v = voices.find((x) => /^en[-_]US/i.test(x.lang));
  if (v) u.voice = v;
  speechSynthesis.speak(u);
  return true;
}

let token = 0;

/**
 * Speak a word or sentence. Resolves to the source used:
 * 'cambridge' | 'google' | 'device' | 'none'.
 */
export async function say(text, { isWord = false } = {}) {
  const clean = String(text || '').trim();
  if (!clean) return 'none';
  const mine = ++token;
  if ('speechSynthesis' in window) speechSynthesis.cancel();

  const key = `${isWord ? 'w' : 's'}:${clean.toLowerCase()}`;
  const candidates = [];
  const cam = isWord ? cambridgeUrl(clean) : null;
  if (cam) candidates.push(['cambridge', cam]);
  candidates.push(['google', googleUrl(clean)]);

  // Once Cambridge has no recording for a word, go straight to Google next time.
  const ordered = memo[key] === 'google' ? candidates.filter(([name]) => name !== 'cambridge') : candidates;

  if (navigator.onLine !== false) {
    for (const [name, src] of ordered) {
      if (mine !== token) return 'none';
      if (await tryPlay(src)) {
        if (memo[key] !== name) remember(key, name);
        document.body.dataset.audio = name;
        return name;
      }
    }
  }
  if (mine !== token) return 'none';
  const ok = deviceVoice(clean);
  document.body.dataset.audio = ok ? 'device' : 'none';
  return ok ? 'device' : 'none';
}

/** Call from the first tap so later automatic playback is allowed on iOS. */
export function unlockAudio() {
  player.src = SILENT;
  const p = player.play();
  if (p && p.catch) p.catch(() => {});
  if ('speechSynthesis' in window) {
    voices = speechSynthesis.getVoices();
    speechSynthesis.onvoiceschanged = () => { voices = speechSynthesis.getVoices(); };
  }
}

/** IPA from the free dictionary API, used only when the card has none. */
export async function lookupIpa(word) {
  if (!/^[a-z][a-z' -]*$/i.test(word) || navigator.onLine === false) return '';
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 6000);
  try {
    const res = await fetch(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word)}`, { signal: ctrl.signal });
    if (!res.ok) return '';
    const data = await res.json();
    const entry = Array.isArray(data) ? data[0] : null;
    if (!entry) return '';
    const us = (entry.phonetics || []).find((p) => p.text && /-us\./.test(p.audio || ''));
    return (us && us.text) || entry.phonetic || ((entry.phonetics || []).find((p) => p.text) || {}).text || '';
  } catch {
    return '';
  } finally {
    clearTimeout(timer);
  }
}
