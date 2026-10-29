// Pronunciation: the phone's own English voice only (works offline).
//
// Why not <audio> files: on iPhone, playing an <audio> element takes over the audio session, which
// pauses the music you are listening to and never resumes it. The system speech voice plays as a
// brief overlay instead, so background music carries on. We also ask for the "ambient" audio
// session (iOS 16.4+), which means "mix with whatever is already playing".

let voices = [];
let chosen = null;

function mixWithOthers() {
  try { if (navigator.audioSession) navigator.audioSession.type = 'ambient'; } catch { /* not supported */ }
}

function loadVoices() {
  if (!('speechSynthesis' in window)) return;
  voices = speechSynthesis.getVoices();
  const us = voices.filter((v) => /^en[-_]US/i.test(v.lang));
  // Prefer the better-sounding downloaded voices when the phone has them.
  chosen = us.find((v) => /premium|enhanced/i.test(v.name)) || us.find((v) => /samantha|ava|allison|nicky/i.test(v.name)) || us[0] || null;
}

/**
 * Speak a word or sentence with the system voice. Resolves to 'device' or 'none'.
 */
export async function say(text) {
  const clean = String(text || '').trim();
  if (!clean || !('speechSynthesis' in window)) return 'none';
  mixWithOthers();
  if (!voices.length) loadVoices();
  if (speechSynthesis.speaking || speechSynthesis.pending) speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(clean);
  u.lang = 'en-US';
  u.rate = 0.92;
  if (chosen) u.voice = chosen;
  speechSynthesis.speak(u);
  return 'device';
}

/** Call from the first tap: loads the voice list and sets the audio session so later speech never interrupts music. */
export function unlockAudio() {
  mixWithOthers();
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
