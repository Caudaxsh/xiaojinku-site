import test from 'node:test';
import assert from 'node:assert/strict';
import { createBrain, TAP_BAG } from '../js/pet/brain.js';
import { validatePack } from '../js/pet/pack.js';

const seeded = (seed = 7) => () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
const ctx = (extra = {}) => ({ x: 100, min: -4, max: 230, ...extra });

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

test('autonomous: with every action available it keeps switching between many different actions', () => {
  let t = 0;
  const brain = createBrain({ rng: seeded(21), now: () => (t += 8000) });
  const counts = {};
  for (let i = 0; i < 300; i++) { const a = brain.next(ctx({ others: [1, 2] })); counts[a.type] = (counts[a.type] || 0) + 1; }
  for (const type of ['walk', 'run', 'jump', 'think', 'sleep']) assert.ok(counts[type] > 8, `${type}: ${JSON.stringify(counts)}`);
});

test('sleep needs room and has a long cooldown', () => {
  let t = 1e9;
  const brain = createBrain({ rng: seeded(4), now: () => t });
  for (let i = 0; i < 200; i++) assert.notEqual(brain.next(ctx({ min: 0, max: 30 })).type, 'sleep');
  const gaps = []; let lastSleep = null;
  for (let i = 0; i < 400; i++) { t += 3000; if (brain.next(ctx()).type === 'sleep') { if (lastSleep !== null) gaps.push(t - lastSleep); lastSleep = t; } }
  assert.ok(gaps.length > 2 && gaps.every((g) => g >= 45000), gaps.join(','));
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
    const a = brain.next(ctx({ can }));
    assert.ok(['walk', 'idle'].includes(a.type), a.type);
  }
  assert.equal(brain.tap(can), 'walk');
  assert.equal(brain.react('done', can), null);
  assert.equal(brain.greet(can), null);
});

test('peeking only happens on a box that can hide the pet, and has a cooldown', () => {
  let t = 1e9;
  const brain = createBrain({ rng: seeded(31), now: () => t });
  for (let i = 0; i < 200; i++) assert.notEqual(brain.next(ctx({ canPeek: false })).type, 'peek');
  const times = [];
  for (let i = 0; i < 500; i++) { t += 4000; if (brain.next(ctx({ canPeek: true })).type === 'peek') times.push(t); }
  assert.ok(times.length > 3, `peeks: ${times.length}`);
  times.slice(1).forEach((x, i) => assert.ok(x - times[i] >= 30000));
});

test('title peek and climbing only happen where the page allows them', () => {
  let t = 1e9;
  const brain = createBrain({ rng: seeded(41), now: () => (t += 4000) });
  for (let i = 0; i < 300; i++) {
    const a = brain.next(ctx({ canPeek: false, canPeekTitle: false, canClimb: false })).type;
    assert.ok(!['peek', 'peek_title', 'climb'].includes(a), a);
  }
  const seen = new Set();
  for (let i = 0; i < 600; i++) seen.add(brain.next(ctx({ canPeek: true, canPeekTitle: true, canClimb: true })).type);
  for (const k of ['peek', 'peek_title', 'climb']) assert.ok(seen.has(k), `${k} never chosen: ${[...seen]}`);
});

test('calm actions never follow each other, and they last long with long pauses after', async () => {
  const { CALM, HOLD_MS } = await import('../js/pet/brain.js');
  let t = 0;
  const brain = createBrain({ rng: seeded(11), now: () => (t += 60000) });
  let prev = null;
  for (let i = 0; i < 500; i++) {
    const a = brain.next(ctx());
    assert.ok(!(CALM.includes(prev) && CALM.includes(a.type)), `${prev} -> ${a.type}`);
    if (CALM.includes(a.type)) assert.ok(brain.restFor() >= 5500, 'long pause after a calm action');
    prev = a.type;
  }
  for (const k of ['think', 'sleep']) {
    const h = brain.holdFor(k);
    assert.ok(h >= HOLD_MS[k][0] && h <= HOLD_MS[k][1]);
  }
  assert.ok(HOLD_MS.think[0] >= 9000 && HOLD_MS.sleep[0] >= 20000);
});

test('every visit differs: different seeds give different opening moves', () => {
  const seen = new Set();
  for (let s = 1; s < 60; s++) seen.add(createBrain({ rng: seeded(s), now: () => 1e9 }).start(ctx()).type);
  assert.ok(seen.size >= 5, [...seen].join());
});
