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

    /**
     * Next autonomous action. ctx: { idleFor (ms since the last interaction), x, min, max,
     * can(type) — whether the character pack has that action; missing actions are never picked }
     */
    next(ctx) {
      const can = ctx.can || (() => true);
      if (can('sleep') && ctx.idleFor >= SLEEP_AFTER_MS && last !== 'sleep') return { type: mark('sleep') };
      if (last === 'sleep') return { type: 'sleep' }; // stays asleep until someone interacts
      const options = Object.entries(WEIGHTS).filter(([type]) => type !== last && ready(type) && can(type));
      if (!options.length) return { type: mark('idle') };
      let roll = rng() * options.reduce((n, [, w]) => n + w, 0);
      let pick = options[options.length - 1][0];
      for (const [type, w] of options) { roll -= w; if (roll <= 0) { pick = type; break; } }
      if (pick === 'walk') {
        // somewhere else on the page (another platform), or along the one it stands on
        const others = ctx.others || [];
        const span = ctx.max - ctx.min;
        if (others.length && (rng() < 0.4 || span < 24)) {
          return { type: mark('walk'), platform: others[Math.floor(rng() * others.length)] };
        }
        if (span < 24) return { type: mark(can('sit') ? 'sit' : 'idle') };
        const gap = Math.min(60, span * 0.45);
        let target = ctx.min + rng() * span;
        if (Math.abs(target - ctx.x) < gap) target = ctx.x < ctx.min + span / 2 ? ctx.max - rng() * span * 0.25 : ctx.min + rng() * span * 0.25;
        return { type: mark('walk'), x: Math.round(target) };
      }
      return { type: mark(pick) };
    },

    /** A tap: wake up with a wave, otherwise cycle through reactions without repeating. */
    tap(can = () => true) {
      const pool = TAP_BAG.filter(can);
      if (!pool.length) return mark('walk'); // a pack with no reactions: stroll somewhere else
      if (last === 'sleep') { last = null; return mark(can('wave') ? 'wave' : pool[0]); }
      bag = bag.filter(can);
      if (!bag.length) {
        bag = [...pool].sort(() => rng() - 0.5);
        if (bag[bag.length - 1] === lastTap) bag.unshift(bag.pop()); // never the same reaction twice in a row
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
