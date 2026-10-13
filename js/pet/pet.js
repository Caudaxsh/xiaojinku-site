// Glue: puts the pet on the page itself. The page tells it which elements are "platforms"
// (the title text, the stat tiles, panels...). The pet stands on their top edges, walks along
// them and hops between them. It lives in a click-through layer, so only the pet takes taps,
// and nothing on the page moves because of it.
import { Sprite } from './sprite.js';
import { createBrain } from './brain.js';
import { loadPack } from './pack.js';

const SPEED = { walk: 34, run: 96 }; // px per second
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
  let firstVisit = true; // the first time the page shows the pet: random spot, random first move

  const wait = (ms, t) => new Promise((resolve) => { timer = setTimeout(() => resolve(t === token), ms); });
  const supported = () => Boolean(pet.pack && pet.enabled);
  const can = (type) => Boolean(sprite && sprite.has(type));
  const interrupt = () => { token += 1; clearTimeout(timer); timer = 0; };

  /** Read the platforms from the page, in layer coordinates. */
  function measure() {
    if (!layer) return [];
    const base = layer.getBoundingClientRect();
    return getPlatforms()
      .map((p) => ({ key: p.key, left: p.left - base.left, right: p.right - base.left, top: p.top - base.top, bottom: p.bottom == null ? null : p.bottom - base.top, avoidLeft: p.avoidLeft == null ? null : p.avoidLeft - base.left }))
      .filter((p) => p.right - p.left >= sprite.pw * 0.6);
  }

  /** Sprite left edge for a feet position (fraction 0..1 along the platform). */
  /** Leftmost feet position on a platform. On the title it stays right of the date printed above it. */
  const lowFeet = (p) => (p.avoidLeft == null ? p.left + EDGE : Math.max(p.left + EDGE, p.avoidLeft + 24));
  function xOn(p, f) {
    const lo = Math.min(lowFeet(p), p.right - EDGE); const hi = p.right - EDGE;
    return lo + (hi - lo) * Math.max(0, Math.min(1, f)) - sprite.pw / 2;
  }
  const feetX = () => sprite.x + sprite.pw / 2;
  const fracOn = (p) => (feetX() - lowFeet(p)) / Math.max(1, p.right - EDGE - lowFeet(p));

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

  function decide(t, opening = false) {
    if (t !== token || !sprite || !visible) return;
    platforms = measure();
    const p = platforms[on];
    if (!p) return rest();
    const a = (opening ? brain.start : brain.next).call(brain, {
      x: feetX(), min: lowFeet(p), max: p.right - EDGE, can, others: visiblePlatforms(),
      canPeek: /^(tile|panel)/.test(p.key), canPeekTitle: titleIndex() >= 0, canClimb: climbPlans().length > 0,
    });
    perform(a);
  }

  async function walkTo(x, t, gait = 'walk') {
    const dist = Math.abs(x - sprite.x);
    if (dist < 3) return true;
    const clip = can(gait) ? gait : 'walk';
    const ms = (dist / SPEED[clip]) * 1000;
    sprite.play(clip, { flip: x < sprite.x });
    sprite.moveTo(x, ms);
    const ok = await wait(ms, t);
    if (!ok && sprite) sprite.moveTo(sprite.currentX(layer.getBoundingClientRect().left), 0);
    return ok;
  }

  /** Walk to the edge facing the target, hop over, land somewhere on it. */
  async function travel(to, t, gait) {
    const from = platforms[on]; const dest = platforms[to];
    if (!from || !dest) return false;
    const goingRight = (dest.left + dest.right) / 2 > feetX();
    const edgeF = goingRight ? 0.95 : 0.05;
    if (!(await walkTo(xOn(from, edgeF), t, gait))) return false;
    const landF = goingRight ? 0.15 + Math.random() * 0.35 : 0.5 + Math.random() * 0.35;
    const lx = xOn(dest, landF);
    const dist = Math.hypot(lx - sprite.x, dest.top - sprite.y);
    const ms = Math.max(520, Math.min(1000, dist * 2.6));
    // the jump frames (crouch, take-off, peak, fall, landing) are stretched over the flight
    if (can('jump')) sprite.play('jump', { flip: !goingRight, speed: sprite.duration('jump') / ms });
    else sprite.play('walk', { flip: !goingRight });
    await sprite.hop(lx, dest.top, ms, 18 + Math.min(30, dist * 0.12));
    if (t !== token) return false;
    on = to;
    remember();
    return true;
  }

  /** The title platform, if it is on screen and has room right of the date. */
  function titleIndex() {
    if (!sprite || !layer) return -1;
    const i = platforms.findIndex((q) => q.key === 'title');
    const q = platforms[i];
    return q && onScreen(q) && q.right - EDGE - lowFeet(q) > 30 ? i : -1;
  }

  /** Frames of a peek have their cut line at the bottom row: keep it this far behind the edge. */
  const PEEK_BEHIND = 1;

  /**
   * Rise from behind the top edge of a box (or behind the title letters), look around, sink back.
   * While this runs the pet layer sits BELOW the page content (z-index -1), so the box or the letters
   * cover the bottom of the frames: nothing about the wall has to be drawn.
   */
  async function peek(t, clip) {
    const p = platforms[on];
    const x = xOn(p, 0.15 + Math.random() * 0.7);
    const hidden = sprite.ph; // feet this far below the edge = fully hidden
    const stop = () => layer.classList.remove('behind');
    sprite.moveTo(feetX() - sprite.pw / 2, 0, p.top);
    layer.classList.add('behind');
    sprite.moveTo(x, 0, p.top + hidden);
    sprite.play(clip, { flip: Math.random() < 0.5 });
    void sprite.el.offsetWidth; // commit the hidden position before animating
    sprite.moveTo(x, 520, p.top + PEEK_BEHIND);
    if (!(await wait(520 + 1900, t))) return stop();   // the clip's frames play: look, glance, blink, duck
    sprite.moveTo(x, 420, p.top + hidden);
    if (!(await wait(440, t))) return stop();
    stop();
    sprite.moveTo(x, 0, p.top); // pops up on top of the same box, standing
    remember();
    rest();
  }

  /**
   * Places the pet could climb: a box standing right above the platform the pet is on (the panel
   * under the tiles), from the gap beside it. The frames face the wall on their right, so climbing a
   * box's LEFT edge uses them as drawn and its RIGHT edge uses the mirror image. The body must stay on
   * screen and must not cover the neighbouring box's text, so narrow phones and outer edges are skipped.
   */
  const WALL_AT = 107 / 112; // where the hands touch the wall, as a fraction of the frame width
  const onScreen = (p) => { const top = p.top + layer.getBoundingClientRect().top; return top > 40 && top < innerHeight - 90; };
  function climbPlans() {
    if (!sprite || !layer || !can('climb') || !can('climb_over')) return [];
    const view = layer.getBoundingClientRect();
    const out = [];
    platforms.forEach((T, ti) => {
      if (!/^tile/.test(T.key) || T.bottom == null || !onScreen(T) || T.right - T.left < 100) return;
      // the platform just below this box: the pet starts its climb from there (it hops there first if needed)
      platforms.forEach((P, pi) => {
        if (pi === ti || P.top < T.bottom - 2 || P.top - T.bottom > 40 || !onScreen(P) || P.right - P.left < sprite.pw) return;
        const left = T.left - sprite.pw * WALL_AT;
        const right = T.right - sprite.pw * (1 - WALL_AT);
        if (view.left + left >= 2) out.push({ from: pi, to: ti, side: 'left', x: left });
        if (view.left + right + sprite.pw <= innerWidth - 2) out.push({ from: pi, to: ti, side: 'right', x: right });
      });
    });
    return out;
  }

  /** Get to the platform below the box, walk to the gap, climb the side, pull over the top and stand up there. */
  async function climb(t, plan) {
    const T = platforms[plan.to];
    if (!platforms[plan.from] || !T) return;
    if (on !== plan.from && !(await travel(plan.from, t, 'walk'))) return;
    const from = platforms[on];
    const flip = plan.side === 'right';
    if (!(await walkTo(plan.x, t, 'walk'))) return;
    sprite.moveTo(plan.x, 0, from.top);
    sprite.play('climb', { flip });
    void sprite.el.offsetWidth;
    const reach = T.top + sprite.ph * 0.45; // feet this far below the edge when the hands reach it
    const ms = Math.max(600, ((from.top - reach) / 52) * 1000);
    sprite.moveTo(plan.x, ms, reach);
    if (!(await wait(ms, t))) return;
    sprite.play('climb_over', { flip });
    sprite.moveTo(plan.x, 320, T.top + 3);
    if (!(await wait(sprite.duration('climb_over') + 120, t))) return;
    on = plan.to;
    sprite.moveTo(xOn(T, plan.side === 'left' ? 0.1 : 0.9), 0, T.top);
    remember();
    rest();
  }

  async function perform(a) {
    if (!sprite) return;
    interrupt();
    const t = token;
    sprite.hideCard();
    const done = () => { if (t === token) { remember(); rest(); } };
    if ((a.type === 'walk' || a.type === 'run') && can('walk')) {
      if (Number.isInteger(a.platform) && platforms[a.platform]) { if (await travel(a.platform, t, a.type)) done(); return; }
      const p = platforms[on];
      const target = Math.max(p.left + EDGE, Math.min(p.right - EDGE, a.x ?? feetX())) - sprite.pw / 2;
      if (await walkTo(target, t, a.type)) done();
      return;
    }
    if (a.type === 'sleep' && can('sleep')) {
      sprite.play('sleep');
      if (await wait(brain.holdFor('sleep'), t)) done(); // a long nap, then wakes up by itself
      return;
    }
    if (a.type === 'jump' && can('jump')) {
      sprite.arc(Math.round(sprite.ph * 0.13), sprite.duration('jump'), [[0, 0], [0.19, 0], [0.36, 1], [0.6, 1], [0.77, 0], [1, 0]]);
      sprite.play('jump', { onDone: done });
      return;
    }
    if (a.type === 'peek' && can('peek') && /^(tile|panel)/.test(platforms[on]?.key || '')) { await peek(t, 'peek'); return; }
    if (a.type === 'peek_title' && can('peek_title')) {
      const ti = titleIndex();
      if (ti < 0) return done();
      if (on !== ti && !(await travel(ti, t, 'walk'))) return; // hop up onto the title first
      await peek(t, 'peek_title');
      return;
    }
    if (a.type === 'climb') {
      const plans = a.plan ? [a.plan] : climbPlans();
      if (plans.length) { await climb(t, plans[Math.floor(Math.random() * plans.length)]); return; }
      return done();
    }
    if (a.type === 'card' && can('card')) {
      sprite.play('card');
      sprite.showCard(pet.getWord() || '✓');
      if (await wait(3600, t)) done();
      return;
    }
    if (a.type === 'think' && can('think')) { // keeps thinking: replay the clip until the hold time is up
      const end = Date.now() + brain.holdFor('think');
      const again = () => { if (t !== token) return; if (Date.now() >= end) return done(); sprite.play('think', { onDone: again }); };
      again();
      return;
    }
    if (can(a.type) && !['idle', 'sit'].includes(a.type)) { sprite.play(a.type, { onDone: done }); return; }
    if (a.type === 'sit' && can('sit')) { sprite.play('sit'); if (await wait(brain.holdFor('sit'), t)) done(); return; }
    rest();
  }

  const touch = () => { lastTouch = Date.now(); };

  function onTap() {
    touch();
    if (!sprite || reduceMotion()) return;
    const t = brain.tap(can);
    if (t === 'walk' || t === 'run') {
      platforms = measure();
      const others = visiblePlatforms();
      if (others.length) return perform({ type: t, platform: others[Math.floor(Math.random() * others.length)] });
      const p = platforms[on];
      return perform({ type: t, x: feetX() > (p.left + p.right) / 2 ? p.left + EDGE : p.right - EDGE });
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
      let opening = false;
      if (firstVisit) {
        firstVisit = false; opening = true;
        const ps = measure();
        if (ps.length) { homeKey = ps[Math.floor(Math.random() * ps.length)].key; homeOffset = Math.random(); }
      }
      place();
      let roFirst = true; // observe() reports once on start; that is not a real resize
      ro = new ResizeObserver(() => { if (roFirst) { roFirst = false; return; } if (!sprite) return; interrupt(); remember(); place(); rest(); });
      ro.observe(host);
      touch();
      brain.reset();
      sprite.play('idle');
      if (reduceMotion()) { sprite.show(pet.pack.clips.idle.seq[0][0]); return; }
      if (pending) { const ev = pending; pending = null; const a = brain.react(ev, can); if (a) { perform({ type: a }); return; } }
      if (opening && !pet.quiet && visible) {
        const t = token;
        wait(500 + Math.random() * 2000, t).then((ok) => { if (ok) decide(t, true); });
        return;
      }
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
    /** For tests and the preview page only. */
    debug: { run: (a) => perform(a), titleIndex: () => titleIndex(), platforms: () => platforms, plans: () => climbPlans(), go: (key) => { const i = platforms.findIndex((p) => p.key === key); if (i >= 0) { on = i; sprite.moveTo(xOn(platforms[i], 0.5), 0, platforms[i].top); homeKey = key; } } },
  });

  return pet;
}
