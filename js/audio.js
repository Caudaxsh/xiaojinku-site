// Pronunciation, two modes (Settings: "靜音鍵開著也要出聲"):
//  - on (default): recordings (Cambridge for words, Google otherwise) through an <audio> element, which the
//    silent switch does not mute; the phone's own voice is the fallback.
//  - off: the phone's own voice first (plays over music, but the silent switch mutes it), recordings as fallback.
// Settings has a test button that shows which path worked.

const SILENT = 'data:audio/wav;base64,UklGRiwAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQgAAACAgICAgICAgA==';
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
let loud = true; // play even when the ringer/silent switch is on (see setLoud)

/**
 * loud = true (default): play recordings through an <audio> element in the "playback" session. iOS does
 * not mute these with the silent switch (the system voice IS muted by it), but they can pause music.
 * loud = false: system voice first, which plays over music but stays silent while the switch is on.
 */
export function setLoud(on) { loud = Boolean(on); }

function session(type) {
  try { if (navigator.audioSession) navigator.audioSession.type = type; } catch { /* not supported */ }
}
// When a recording ends, give the audio focus back so music that was paused can carry on.
player.addEventListener('ended', () => session('auto'));
player.addEventListener('pause', () => { if (player.ended || player.currentTime === 0) session('auto'); });

export function cambridgeUrl(word) {
  const w = word.trim().toLowerCase();
  if (!/^[a-z]+$/.test(w)) return null;
  const pad = (n) => (w + '_'.repeat(n)).slice(0, n);
  return `https://dictionary.cambridge.org/media/english/us_pron/${w[0]}/${pad(3)}/${pad(5)}/${w}.mp3`;
}

async function playRecording(clean, isWord) {
  if (navigator.onLine === false) return false;
  session('playback');
  const cam = isWord ? cambridgeUrl(clean) : null;
  if (cam && (await playFile(cam))) return true;
  return playFile(googleUrl(clean));
}

/**
 * Speak a word or sentence. Resolves to 'device' (system voice), 'google' (recording) or 'none'.
 */
export async function say(text, { isWord = false } = {}) {
  const clean = String(text || '').trim();
  if (!clean) return 'none';
  const mine = ++token;
  if ('speechSynthesis' in window) speechSynthesis.cancel();
  if (loud) {
    if (await playRecording(clean, isWord)) { info.lastPath = 'google'; return 'google'; }
    if (mine !== token) return 'none';
    if (await systemSpeak(clean)) { info.lastPath = 'device'; return 'device'; }
    info.lastPath = 'none';
    return 'none';
  }
  if (failStreak < 2 && (await systemSpeak(clean))) {
    failStreak = 0;
    info.lastPath = 'device';
    return 'device';
  }
  if (mine !== token) return 'none';
  failStreak += 1;
  if (await playRecording(clean, isWord)) { info.lastPath = 'google'; return 'google'; }
  info.lastPath = 'none';
  return 'none';
}

/** For the Settings test button: forget earlier failures, try again, and report which path worked. */
export async function testVoice() {
  failStreak = 0;
  return say('Hello, this is a test.', { isWord: false });
}

/** Call from the first tap: loads the voice list, and (loud mode) lets later automatic playback through on iOS. */
export function unlockAudio() {
  if ('speechSynthesis' in window) {
    loadVoices();
    speechSynthesis.onvoiceschanged = loadVoices;
  }
  if (loud) {
    session('playback');
    player.src = SILENT;
    const p = player.play();
    if (p && p.catch) p.catch(() => {});
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
