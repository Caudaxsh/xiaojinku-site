// Glue: owns the pet's place on the page. It mounts a sprite into a reserved stage element
// (so nothing on the page moves), asks the brain what to do, and runs one action at a time.
import { Sprite } from './sprite.js';
import { createBrain } from './brain.js';
import { loadPack } from './pack.js';

const SPEED = 46; // px per second while walking
const reduceMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

export function createPet() {
  const brain = createBrain();
  const pet = {
    pack: null,
    enabled: true,
    quiet: false,
    getWord: () => null,
  };
  let sprite = null; let stage = null; let ro = null; let io = null;
  let x = null; let token = 0; let timer = 0; let visible = true; let lastTouch = Date.now();
  let pending = null; // an event that arrived while the pet was not on screen

  const stageW = () => (stage ? stage.clientWidth : 0);
  const bounds = () => ({ min: -4, max: Math.max(-4, stageW() - sprite.pw + 4) });
  const clamp = (v) => { const b = bounds(); return Math.max(b.min, Math.min(b.max, v)); };
  const wait = (ms, t) => new Promise((resolve) => { timer = setTimeout(() => resolve(t === token), ms); });
  const supported = () => Boolean(pet.pack && pet.enabled);

  function interrupt() { token += 1; clearTimeout(timer); timer = 0; }

  async function rest(kind = 'idle') {
    interrupt();
    const t = token;
    if (!sprite) return;
    sprite.hideCard();
    sprite.play(sprite.has(kind) ? kind : 'idle');
    if (pet.quiet || reduceMotion() || !visible) return;
    if (!(await wait(brain.restFor(), t))) return;
    decide(t);
  }

  function decide(t) {
    if (t !== token || !sprite || !visible) return;
    const b = bounds();
    const a = brain.next({ idleFor: Date.now() - lastTouch, x, min: b.min, max: b.max });
    perform(a);
  }

  /** Run exactly one action. Everything ends by returning to a resting pose. */
  async function perform(a) {
    if (!sprite) return;
    interrupt();
    const t = token;
    sprite.hideCard();
    const done = () => { if (t === token) rest(Math.random() < 0.5 ? 'idle' : 'sit'); };
    switch (a.type) {
      case 'walk': {
        const target = clamp(a.x);
        const dist = Math.abs(target - x);
        if (dist < 12 || !sprite.has('walk')) return done();
        const ms = (dist / SPEED) * 1000;
        sprite.play('walk', { flip: target < x });
        sprite.moveTo(target, ms);
        const ok = await wait(ms, t);
        if (!ok) { x = clamp(sprite.currentX(stage.getBoundingClientRect().left)); sprite.moveTo(x, 0); return; }
        x = target;
        return done();
      }
      case 'jump':
        if (!sprite.has('jump')) return done();
        sprite.arc(Math.round(sprite.ph * 0.1), sprite.duration('jump'));
        sprite.play('jump', { onDone: done });
        return undefined;
      case 'sleep':
        sprite.play(sprite.has('sleep') ? 'sleep' : 'sit'); // stays until the next interaction
        return undefined;
      case 'card': {
        if (!sprite.has('card')) return done();
        const word = pet.getWord();
        sprite.play('card');
        sprite.showCard(word || '✓');
        if (await wait(3600, t)) done();
        return undefined;
      }
      case 'sit': case 'idle':
        return rest(a.type);
      default: // wave, cheer, encourage, think
        if (!sprite.has(a.type)) return done();
        if (a.type === 'think') { sprite.play('think'); if (await wait(3400, t)) done(); return undefined; }
        sprite.play(a.type, { onDone: done });
        return undefined;
    }
  }

  function touch() { lastTouch = Date.now(); }

  function onTap() {
    touch();
    if (reduceMotion()) { perform({ type: 'card' }); return; }
    perform({ type: brain.tap() });
  }

  function setVisible(v) {
    if (v === visible) return;
    visible = v;
    if (!sprite) return;
    if (v) { sprite.unpause(); if (!sprite.clip) rest('idle'); } else { sprite.pause(); interrupt(); }
  }

  const onVisibility = () => setVisible(!document.hidden && stageSeen);
  let stageSeen = true;
  document.addEventListener('visibilitychange', onVisibility);

  function greetToday() {
    const key = 'cv-pet-greet';
    try {
      const today = new Date().toDateString();
      if (localStorage.getItem(key) === today) return false;
      localStorage.setItem(key, today);
      return true;
    } catch { return false; }
  }

  Object.assign(pet, {
    async init(store) { pet.pack = await loadPack(store); return pet.pack; },
    setPack(pack) { pet.pack = pack; if (stage) { const s = stage; pet.detach(); if (supported()) pet.attach(s); } },
    active: () => supported(),

    attach(el) {
      pet.detach();
      if (!supported() || !el) return;
      stage = el;
      sprite = new Sprite(pet.pack).mount(el);
      el.style.height = `${sprite.ph}px`; // the stage is exactly as tall as the character
      sprite.el.tabIndex = 0;
      sprite.el.setAttribute('role', 'button');
      sprite.el.setAttribute('aria-label', '寵物，點一下互動');
      sprite.el.addEventListener('pointerdown', (e) => { e.preventDefault(); onTap(); });
      sprite.el.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onTap(); } });
      const b = bounds();
      x = clamp(x ?? b.max);
      sprite.moveTo(x, 0);
      ro = new ResizeObserver(() => { if (!sprite) return; x = clamp(x); sprite.moveTo(x, 0); });
      ro.observe(el);
      io = new IntersectionObserver((entries) => { stageSeen = entries[0].isIntersecting; setVisible(stageSeen && !document.hidden); }, { threshold: 0.1 });
      io.observe(el);
      touch();
      brain.reset();
      if (reduceMotion()) { sprite.show(pet.pack.clips.sit ? pet.pack.clips.sit.seq[0][0] : pet.pack.clips.idle.seq[0][0]); return; }
      if (pending) { const ev = pending; pending = null; const a = brain.react(ev); if (a) { perform({ type: a }); return; } }
      if (greetToday()) { perform({ type: brain.greet() }); return; }
      rest('idle');
    },

    detach() {
      interrupt();
      ro?.disconnect(); io?.disconnect(); ro = null; io = null;
      if (sprite) sprite.unmount();
      sprite = null; stage = null;
    },

    /** Learning events: 'done' (finished a session) / 'again' (forgot a card) / 'imported'. */
    emit(event) {
      const ev = event === 'imported' ? 'done' : event;
      if (!sprite) { if (supported()) pending = ev; return; }
      const a = brain.react(ev);
      if (a) { touch(); perform({ type: a }); }
    },

    /** Used by the preview page and settings. */
    play(name) { if (sprite) { touch(); perform({ type: name }); } },
    get sprite() { return sprite; },
  });

  return pet;
}
