// Pronunciation. Main path: the phone's own English voice (works offline, plays over background music
// instead of stopping it). Safety net: if the system voice does not actually start (iOS sometimes
// drops speech after a cancel, or stays silent), the same text is played from Google's voice so you
// never get a silent button. Settings has a test button that shows which path worked.

const TIMEOUT_MS = 5000;
const START_WATCHDOG_MS = 1400; // the system voice must start speaking within this time

let voices = [];
let chosen = null;
let failStreak = 0; // consecutive times the system voice stayed silent; after 2 we go straight to the fallback
const info = { lastPath: '', voices: 0, speechSupported: 'speechSynthesis' in window, note: '' };
export const audioInfo = info;

function loadVoices() {
  if (!('speechSynthesis' in window)) return;
  voices = speechSynthesis.getVoices();
  info.voices = voices.length;
  const us = voices.filter((v) => /^en[-_]US/i.test(v.lang));
  // Prefer the better-sounding downloaded voices when the phone has them.
  chosen = us.find((v) => /premium|enhanced/i.test(v.name)) || us.find((v) => /samantha|ava|allison|nicky/i.test(v.name)) || us[0] || null;
}

const player = new Audio();
player.preload = 'auto';

function googleUrl(text) {
  return `https://translate.google.com/translate_tts?ie=UTF-8&client=tw-ob&tl=en-US&q=${encodeURIComponent(text.slice(0, 200))}`;
}

function playFile(src) {
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

/** Speak with the system voice. Resolves true once it has really started, false if it stayed silent. */
function systemSpeak(text) {
  return new Promise((resolve) => {
    if (!('speechSynthesis' in window)) return resolve(false);
    if (!voices.length) loadVoices();
    let started = false;
    let done = false;
    const finish = (ok) => { if (!done) { done = true; clearTimeout(watch); resolve(ok); } };
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'en-US';
    u.rate = 0.92;
    if (chosen) u.voice = chosen;
    u.onstart = () => { started = true; finish(true); };
    u.onerror = (e) => { if (e.error !== 'canceled' && e.error !== 'interrupted') finish(false); };
    const watch = setTimeout(() => finish(started), START_WATCHDOG_MS);
    try {
      // iOS drops a speak() that comes right after cancel(): clear first, wait a moment, resume, then speak.
      if (speechSynthesis.speaking || speechSynthesis.pending || speechSynthesis.paused) speechSynthesis.cancel();
      setTimeout(() => {
        try { speechSynthesis.resume(); speechSynthesis.speak(u); } catch { finish(false); }
      }, 60);
    } catch { finish(false); }
  });
}

let token = 0;

/**
 * Speak a word or sentence. Resolves to 'device' (system voice), 'google' (fallback voice) or 'none'.
 */
export async function say(text) {
  const clean = String(text || '').trim();
  if (!clean) return 'none';
  const mine = ++token;
  if (failStreak < 2 && (await systemSpeak(clean))) {
    failStreak = 0;
    info.lastPath = 'device';
    return 'device';
  }
  if (mine !== token) return 'none';
  failStreak += 1;
  if (navigator.onLine !== false && (await playFile(googleUrl(clean)))) {
    info.lastPath = 'google';
    return 'google';
  }
  info.lastPath = 'none';
  return 'none';
}

/** For the Settings test button: forget earlier failures, try again, and report which path worked. */
export async function testVoice() {
  failStreak = 0;
  const path = await say('Hello, this is a test.');
  return path;
}

/** Call from the first tap: loads the voice list. */
export function unlockAudio() {
  if ('speechSynthesis' in window) {
    loadVoices();
    speechSynthesis.onvoiceschanged = loadVoices;
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
