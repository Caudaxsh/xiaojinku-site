// Glue: puts the pet on the page itself. The page tells it which elements are "platforms"
// (the title text, the stat tiles, panels...). The pet stands on their top edges, walks along
// them and hops between them. It lives in a click-through layer, so only the pet takes taps,
// and nothing on the page moves because of it.
import { Sprite } from './sprite.js';
import { createBrain } from './brain.js';
import { loadPack } from './pack.js';

const SPEED = 34; // px per second while walking
const EDGE = 10; // keep the feet this far inside a platform's ends
const reduceMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

export function createPet() {
  const brain = createBrain();
  const pet = { pack: null, builtin: false, enabled: true, quiet: false, getWord: () => null };

  let sprite = null; let layer = null; let host = null; let getPlatforms = () => [];
  let platforms = []; let on = 0; // index of the platform the pet stands on
  let homeKey = null; let homeOffset = 0.5; // remembered across re-renders
  let token = 0; let timer = 0; let visible = true; let lastTouch = Date.now();
  let pending = null; let ro = null; let io = null;

  const wait = (ms, t) => new Promise((resolve) => { timer = setTimeout(() => resolve(t === token), ms); });
  const supported = () => Boolean(pet.pack && pet.enabled);
  const can = (type) => Boolean(sprite && sprite.has(type));
  const interrupt = () => { token += 1; clearTimeout(timer); timer = 0; };

  /** Read the platforms from the page, in layer coordinates. */
  function measure() {
    if (!layer) return [];
    const base = layer.getBoundingClientRect();
    return getPlatforms()
      .map((p) => ({ key: p.key, left: p.left - base.left, right: p.right - base.left, top: p.top - base.top }))
      .filter((p) => p.right - p.left >= sprite.pw * 0.6);
  }

  /** Sprite left edge for a feet position (fraction 0..1 along the platform). */
  function xOn(p, f) {
    const lo = p.left + EDGE; const hi = p.right - EDGE;
    return lo + (hi - lo) * Math.max(0, Math.min(1, f)) - sprite.pw / 2;
  }
  const feetX = () => sprite.x + sprite.pw / 2;
  const fracOn = (p) => (feetX() - p.left - EDGE) / Math.max(1, p.right - p.left - 2 * EDGE);

  function place() {
    platforms = measure();
    if (!platforms.length) { sprite.el.hidden = true; return; }
    sprite.el.hidden = false;
    const i = platforms.findIndex((p) => p.key === homeKey);
    on = i >= 0 ? i : 0;
    homeKey = platforms[on].key;
    sprite.moveTo(xOn(platforms[on], homeOffset), 0, platforms[on].top);
  }

  function remember() {
    const p = platforms[on];
    if (!p) return;
    homeKey = p.key;
    homeOffset = Math.max(0, Math.min(1, fracOn(p)));
  }

  async function rest() {
    interrupt();
    const t = token;
    if (!sprite) return;
    sprite.hideCard();
    sprite.play('idle');
    if (pet.quiet || reduceMotion() || !visible) return;
    if (!(await wait(brain.restFor(), t))) return;
    decide(t);
  }

  function visiblePlatforms() {
    const vh = innerHeight; const base = layer.getBoundingClientRect().top;
    return platforms
      .map((p, i) => ({ p, i }))
      .filter(({ p, i }) => i !== on && p.top + base > 40 && p.top + base < vh - 90)
      .map(({ i }) => i);
  }

  function decide(t) {
    if (t !== token || !sprite || !visible) return;
    platforms = measure();
    const p = platforms[on];
    if (!p) return rest();
    const a = brain.next({
      idleFor: Date.now() - lastTouch, x: feetX(), min: p.left + EDGE, max: p.right - EDGE, can,
      others: visiblePlatforms(),
    });
    perform(a);
  }

  async function walkTo(x, t) {
    const dist = Math.abs(x - sprite.x);
    if (dist < 3) return true;
    const ms = (dist / SPEED) * 1000;
    sprite.play('walk', { flip: x < sprite.x });
    sprite.moveTo(x, ms);
    const ok = await wait(ms, t);
    if (!ok && sprite) sprite.moveTo(sprite.currentX(layer.getBoundingClientRect().left), 0);
    return ok;
  }

  /** Walk to the edge facing the target, hop over, land somewhere on it. */
  async function travel(to, t) {
    const from = platforms[on]; const dest = platforms[to];
    if (!from || !dest) return false;
    const goingRight = (dest.left + dest.right) / 2 > feetX();
    const edgeF = goingRight ? 0.95 : 0.05;
    if (!(await walkTo(xOn(from, edgeF), t))) return false;
    const landF = goingRight ? 0.15 + Math.random() * 0.35 : 0.5 + Math.random() * 0.35;
    const lx = xOn(dest, landF);
    const dist = Math.hypot(lx - sprite.x, dest.top - sprite.y);
    sprite.play('walk', { flip: !goingRight });
    await sprite.hop(lx, dest.top, Math.max(380, Math.min(900, dist * 2.4)), 18 + Math.min(30, dist * 0.12));
    if (t !== token) return false;
    on = to;
    remember();
    return true;
  }

  async function perform(a) {
    if (!sprite) return;
    interrupt();
    const t = token;
    sprite.hideCard();
    const done = () => { if (t === token) { remember(); rest(); } };
    if (a.type === 'walk' && can('walk')) {
      if (Number.isInteger(a.platform) && platforms[a.platform]) { if (await travel(a.platform, t)) done(); return; }
      const p = platforms[on];
      const target = Math.max(p.left + EDGE, Math.min(p.right - EDGE, a.x ?? feetX())) - sprite.pw / 2;
      if (await walkTo(target, t)) done();
      return;
    }
    if (a.type === 'sleep') { sprite.play(['sleep', 'sit', 'idle'].find((n) => sprite.has(n))); return; }
    if (a.type === 'card' && can('card')) {
      sprite.play('card');
      sprite.showCard(pet.getWord() || '✓');
      if (await wait(3600, t)) done();
      return;
    }
    if (can(a.type) && !['idle', 'sit'].includes(a.type)) { sprite.play(a.type, { onDone: done }); return; }
    rest();
  }

  const touch = () => { lastTouch = Date.now(); };

  function onTap() {
    touch();
    if (!sprite || reduceMotion()) return;
    const t = brain.tap(can);
    if (t === 'walk') {
      platforms = measure();
      const others = visiblePlatforms();
      if (others.length) return perform({ type: 'walk', platform: others[Math.floor(Math.random() * others.length)] });
      const p = platforms[on];
      return perform({ type: 'walk', x: feetX() > (p.left + p.right) / 2 ? p.left + EDGE : p.right - EDGE });
    }
    perform({ type: t });
  }

  function setVisible(v) {
    if (v === visible) return;
    visible = v;
    if (!sprite) return;
    if (v) { sprite.unpause(); rest(); } else { sprite.pause(); interrupt(); }
  }
  document.addEventListener('visibilitychange', () => setVisible(!document.hidden));

  Object.assign(pet, {
    async init(store) { const r = await loadPack(store); pet.pack = r.pack; pet.builtin = r.builtin; return pet.pack; },
    async reset(store) { const p = await pet.init(store); pet.setPack(p); return p; },
    setPack(pack) {
      pet.pack = pack;
      if (host) { const h = host; const g = getPlatforms; pet.detach(); if (supported()) pet.attach(h, g); }
    },
    active: () => supported(),

    /**
     * host: the element the layer goes into (it scrolls with it).
     * platforms: () => [{ key, left, right, top }] in viewport coordinates.
     */
    attach(hostEl, platformsFn) {
      pet.detach();
      if (!supported() || !hostEl) return;
      host = hostEl; getPlatforms = platformsFn;
      layer = document.createElement('div');
      layer.className = 'pet-layer';
      host.append(layer);
      sprite = new Sprite(pet.pack).mount(layer);
      sprite.el.tabIndex = 0;
      sprite.el.setAttribute('role', 'button');
      sprite.el.setAttribute('aria-label', '寵物，點一下互動');
      sprite.el.addEventListener('pointerdown', (e) => { e.preventDefault(); onTap(); });
      sprite.el.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onTap(); } });
      place();
      ro = new ResizeObserver(() => { if (!sprite) return; interrupt(); remember(); place(); rest(); });
      ro.observe(host);
      touch();
      brain.reset();
      sprite.play('idle');
      if (reduceMotion()) { sprite.show(pet.pack.clips.idle.seq[0][0]); return; }
      if (pending) { const ev = pending; pending = null; const a = brain.react(ev, can); if (a) { perform({ type: a }); return; } }
      rest();
    },

    detach() {
      interrupt();
      ro?.disconnect(); ro = null;
      if (sprite) { remember(); sprite.unmount(); }
      layer?.remove();
      sprite = null; layer = null; host = null;
    },

    /** Learning events: 'done' (finished a session) / 'again' (forgot a lot) / 'imported'. */
    emit(event) {
      const ev = event === 'imported' ? 'done' : event;
      if (!sprite) { if (supported()) pending = ev; return; }
      const a = brain.react(ev, can);
      if (a) { touch(); perform({ type: a }); }
    },

    get sprite() { return sprite; },
  });

  return pet;
}
