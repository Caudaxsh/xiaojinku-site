import test from 'node:test';
import assert from 'node:assert/strict';
import { createBrain, SLEEP_AFTER_MS, TAP_BAG } from '../js/pet/brain.js';
import { validatePack } from '../js/pet/pack.js';

const seeded = (seed = 7) => () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
const ctx = (extra = {}) => ({ idleFor: 0, x: 100, min: -4, max: 230, ...extra });

test('never repeats the same autonomous action twice in a row', () => {
  let t = 0;
  const brain = createBrain({ rng: seeded(), now: () => (t += 20000) });
  let prev = null;
  for (let i = 0; i < 400; i++) {
    const a = brain.next(ctx());
    assert.notEqual(a.type, prev, `repeat at ${i}`);
    prev = a.type;
  }
});

test('walk targets stay on the platform and are a real distance away', () => {
  const brain = createBrain({ rng: seeded(3), now: () => 1e9 });
  for (let i = 0; i < 300; i++) {
    const x = Math.round(-4 + (i % 7) * 40);
    const a = brain.next(ctx({ x }));
    if (a.type === 'walk') {
      assert.ok(a.x >= -4 && a.x <= 230);
      assert.ok(Math.abs(a.x - x) >= 30);
    }
  }
});

test('a tiny platform: hop elsewhere if possible, otherwise stay put', () => {
  const brain = createBrain({ rng: seeded(5), now: () => 1e9 });
  for (let i = 0; i < 200; i++) {
    const a = brain.next(ctx({ min: 0, max: 10 }));
    assert.ok(a.type !== 'walk' || a.x === undefined);
  }
  const hops = [];
  for (let i = 0; i < 200; i++) { const a = brain.next(ctx({ min: 0, max: 10, others: [2, 5] })); if (a.type === 'walk') hops.push(a.platform); }
  assert.ok(hops.length > 0 && hops.every((p) => p === 2 || p === 5));
});

test('sometimes moves to another platform', () => {
  const brain = createBrain({ rng: seeded(13), now: () => 1e9 });
  let hops = 0; let strolls = 0;
  for (let i = 0; i < 300; i++) { const a = brain.next(ctx({ others: [1, 3] })); if (a.type === 'walk') (a.platform !== undefined ? hops++ : strolls++); }
  assert.ok(hops > 10 && strolls > 10, `${hops} hops, ${strolls} strolls`);
});

test('falls asleep when left alone, stays asleep, and a tap wakes it with a wave', () => {
  const brain = createBrain({ rng: seeded(), now: () => 1e9 });
  assert.equal(brain.next(ctx({ idleFor: SLEEP_AFTER_MS })).type, 'sleep');
  assert.equal(brain.next(ctx({ idleFor: SLEEP_AFTER_MS + 5000 })).type, 'sleep');
  assert.equal(brain.tap(), 'wave');
  assert.notEqual(brain.next(ctx()).type, 'sleep');
});

test('taps cycle through every reaction without repeating back to back', () => {
  const brain = createBrain({ rng: seeded(11), now: () => 1e9 });
  const seen = [];
  for (let i = 0; i < 40; i++) seen.push(brain.tap());
  seen.forEach((t, i) => { if (i) assert.notEqual(t, seen[i - 1]); assert.ok(TAP_BAG.includes(t)); });
  assert.equal(new Set(seen.slice(0, 4)).size, 4);
});

test('celebrations have a cooldown', () => {
  let t = 1e9;
  const brain = createBrain({ now: () => t });
  assert.equal(brain.react('done'), 'cheer');
  t += 5000;
  assert.equal(brain.react('done'), null);
  t += 20000;
  assert.equal(brain.react('done'), 'cheer');
  assert.equal(brain.react('again'), 'encourage');
});

test('pack validation', () => {
  const good = { v: 1, w: 64, h: 64, cols: 2, count: 2, sheet: 'data:image/png;base64,AAAA', clips: { idle: { mode: 'loop', seq: [[0, 100], [1, 100]] } } };
  assert.equal(validatePack(good), null);
  assert.ok(validatePack({ ...good, v: 2 }));
  assert.ok(validatePack({ ...good, sheet: 'https://x/y.png' }));
  assert.ok(validatePack({ ...good, clips: {} }));
  assert.ok(validatePack({ ...good, clips: { idle: { mode: 'loop', seq: [[9, 100]] } } }));
  assert.ok(validatePack(null));
});

test('a pack with only idle + walk: never picks missing actions, taps stroll', () => {
  const brain = createBrain({ rng: seeded(9), now: () => 1e9 });
  const can = (type) => type === 'walk';
  for (let i = 0; i < 200; i++) {
    const a = brain.next(ctx({ can, idleFor: SLEEP_AFTER_MS * 2 }));
    assert.ok(['walk', 'idle'].includes(a.type), a.type);
  }
  assert.equal(brain.tap(can), 'walk');
  assert.equal(brain.react('done', can), null);
  assert.equal(brain.greet(can), null);
});
