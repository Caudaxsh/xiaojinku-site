// Decisions only: what the pet does next, and how it reacts to taps and learning events.
// Pure and deterministic given an rng and a clock, so it can be unit tested.

export const REST_MS = [4000, 9000];
export const SLEEP_AFTER_MS = 55000;
const COOLDOWN = { jump: 9000, wave: 60000, think: 25000, cheer: 20000, encourage: 30000 };
const WEIGHTS = { walk: 38, sit: 22, idle: 14, jump: 10, think: 8, wave: 4 };
export const TAP_BAG = ['wave', 'jump', 'card', 'think'];

export function createBrain({ rng = Math.random, now = () => Date.now() } = {}) {
  let last = null;
  let lastTap = null;
  let bag = [];
  const at = {}; // last time each action ran

  const ready = (type) => !COOLDOWN[type] || !at[type] || now() - at[type] >= COOLDOWN[type];
  const mark = (type) => { at[type] = now(); last = type; return type; };
  const between = ([a, b]) => a + rng() * (b - a);

  return {
    /** How long to rest before the next autonomous action. */
    restFor: () => between(REST_MS),

    /** Next autonomous action. ctx: { idleFor (ms since the last interaction), x, min, max } */
    next(ctx) {
      if (ctx.idleFor >= SLEEP_AFTER_MS && last !== 'sleep') return { type: mark('sleep') };
      if (last === 'sleep') return { type: 'sleep' }; // stays asleep until someone interacts
      const options = Object.entries(WEIGHTS).filter(([type]) => type !== last && ready(type));
      let roll = rng() * options.reduce((n, [, w]) => n + w, 0);
      let pick = options[options.length - 1][0];
      for (const [type, w] of options) { roll -= w; if (roll <= 0) { pick = type; break; } }
      if (pick === 'walk') {
        const span = ctx.max - ctx.min;
        if (span < 80) return { type: mark('sit') };
        let target = ctx.min + rng() * span;
        if (Math.abs(target - ctx.x) < 60) target = ctx.x < ctx.min + span / 2 ? ctx.max - rng() * span * 0.25 : ctx.min + rng() * span * 0.25;
        return { type: mark('walk'), x: Math.round(target) };
      }
      return { type: mark(pick) };
    },

    /** A tap: wake up with a wave, otherwise cycle through reactions without repeating. */
    tap() {
      if (last === 'sleep') { last = null; return mark('wave'); }
      if (!bag.length) {
        bag = [...TAP_BAG].sort(() => rng() - 0.5);
        if (bag[bag.length - 1] === lastTap) bag.unshift(bag.pop()); // never the same reaction twice in a row
      }
      lastTap = bag.pop();
      return mark(lastTap);
    },

    /** Learning events. Returns the action to play, or null while on cooldown. */
    react(event) {
      const type = event === 'again' ? 'encourage' : 'cheer';
      if (!ready(type)) return null;
      return mark(type);
    },

    greet() { return mark('wave'); },
    get last() { return last; },
    reset() { last = null; },
  };
}
