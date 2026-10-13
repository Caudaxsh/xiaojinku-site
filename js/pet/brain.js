// Decisions only: what the pet does next, and how it reacts to taps and learning events.
// Pure and deterministic given an rng and a clock, so it can be unit tested.
//
// The pet is autonomous: after every action it rests briefly, then picks the next one by itself.
// Taps are an extra, not a requirement.

export const REST_MS = [2200, 5200];
export const MOVES = ['walk', 'run'];
const COOLDOWN = { jump: 6000, run: 5000, think: 14000, sleep: 45000, peek: 30000, peek_title: 30000, climb: 25000, wave: 60000, cheer: 20000, encourage: 30000 };
const WEIGHTS = { walk: 24, run: 15, idle: 8, jump: 13, think: 12, sleep: 11, peek: 9, peek_title: 8, climb: 11, sit: 8, wave: 3 };
export const TAP_BAG = ['wave', 'jump', 'card', 'think', 'run'];
const MIN_SLEEP_SPAN = 56; // lying down needs room on the platform

export function createBrain({ rng = Math.random, now = () => Date.now() } = {}) {
  let last = null;
  let lastTap = null;
  let bag = [];
  const at = {}; // last time each action ran

  const ready = (type) => !COOLDOWN[type] || !at[type] || now() - at[type] >= COOLDOWN[type];
  const mark = (type) => { at[type] = now(); last = type; return type; };
  const between = ([a, b]) => a + rng() * (b - a);

  /** A walk/run order: somewhere on this platform, or over to another one. */
  function move(type, ctx) {
    const others = ctx.others || [];
    const span = ctx.max - ctx.min;
    if (others.length && (rng() < 0.45 || span < 24)) {
      return { type: mark(type), platform: others[Math.floor(rng() * others.length)] };
    }
    if (span < 24) return { type: mark('idle') };
    const gap = Math.min(60, span * 0.45);
    let target = ctx.min + rng() * span;
    if (Math.abs(target - ctx.x) < gap) target = ctx.x < ctx.min + span / 2 ? ctx.max - rng() * span * 0.25 : ctx.min + rng() * span * 0.25;
    return { type: mark(type), x: Math.round(target) };
  }

  return {
    /** How long to rest before the next autonomous action. */
    restFor: () => between(REST_MS),

    /**
     * Next autonomous action. ctx: { x, min, max (feet range on this platform), others (indices of
     * other platforms in reach), canPeek (the platform is a box that can hide the pet), can(type) — whether the character pack has that action }
     */
    next(ctx) {
      const can = ctx.can || (() => true);
      const span = ctx.max - ctx.min;
      const options = Object.entries(WEIGHTS).filter(([type]) => type !== last && ready(type) && can(type)
        && (type !== 'sleep' || span >= MIN_SLEEP_SPAN)
        && (type !== 'peek' || ctx.canPeek)             // only behind boxes that have a solid face
        && (type !== 'peek_title' || ctx.canPeekTitle)  // only from behind the title letters
        && (type !== 'climb' || ctx.canClimb));         // only where a box stands right above the pet
      if (!options.length) return { type: mark('idle') };
      let roll = rng() * options.reduce((n, [, w]) => n + w, 0);
      let pick = options[options.length - 1][0];
      for (const [type, w] of options) { roll -= w; if (roll <= 0) { pick = type; break; } }
      return MOVES.includes(pick) ? move(pick, ctx) : { type: mark(pick) };
    },

    /** A tap: cycle through reactions without repeating. */
    tap(can = () => true) {
      const pool = TAP_BAG.filter(can);
      if (!pool.length) return mark('walk');
      bag = bag.filter(can);
      if (!bag.length) {
        bag = [...pool].sort(() => rng() - 0.5);
        if (bag[bag.length - 1] === lastTap && bag.length > 1) bag.unshift(bag.pop()); // never the same reaction twice in a row
      }
      lastTap = bag.pop();
      return mark(lastTap);
    },

    /** Learning events. Returns the action to play, or null while on cooldown / not in the pack. */
    react(event, can = () => true) {
      const type = event === 'again' ? 'encourage' : 'cheer';
      if (!can(type) || !ready(type)) return null;
      return mark(type);
    },

    greet(can = () => true) { return can('wave') ? mark('wave') : null; },
    get last() { return last; },
    reset() { last = null; },
  };
}
