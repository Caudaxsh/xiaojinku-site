// Playback only: shows frames of a named clip and moves the element. It makes no decisions.
// One clip plays at a time; starting a new one cancels the old one, so animations never overlap.

const SVG_NS = 'http://www.w3.org/2000/svg';

export class Sprite {
  constructor(pack, { scale = pack.scale || 2 } = {}) {
    this.pack = pack;
    this.scale = scale;
    this.pw = pack.w * scale;
    this.ph = pack.h * scale;
    // empty rows under the feet, so y can mean "where the feet touch"
    this.footPad = (pack.h - (pack.base || pack.h)) * scale;
    this.x = 0;
    this.y = 0;
    this.rows = Math.ceil(pack.count / pack.cols);
    this.token = 0;
    this.timer = 0;
    this.paused = false;
    this.clip = null;
    this.cardEl = null;

    const el = document.createElement('div');
    el.className = 'pet';
    el.style.width = `${this.pw}px`;
    el.style.height = `${this.ph}px`;
    el.innerHTML = '<div class="pet-shadow"></div><div class="pet-y"><div class="pet-img"></div></div>';
    this.el = el;
    this.yEl = el.querySelector('.pet-y');
    this.img = el.querySelector('.pet-img');
    const shadow = el.querySelector('.pet-shadow');
    shadow.style.width = `${Math.round(this.pw * 0.42)}px`;
    shadow.style.marginLeft = `${-Math.round(this.pw * 0.21)}px`;
    Object.assign(this.img.style, {
      width: `${this.pw}px`, height: `${this.ph}px`,
      backgroundImage: `url("${pack.sheet}")`,
      backgroundSize: `${pack.cols * this.pw}px ${this.rows * this.ph}px`,
    });
  }

  mount(parent) { parent.append(this.el); return this; }
  unmount() { this.stop(); this.el.remove(); }

  has(name) { return Boolean(this.pack.clips[name]); }

  /** Show one frame without any timing (reduced motion, previews). */
  show(frame, flip = false) {
    const col = frame % this.pack.cols; const row = Math.floor(frame / this.pack.cols);
    this.img.style.backgroundPosition = `${-col * this.pw}px ${-row * this.ph}px`;
    this.img.style.transform = flip ? 'scaleX(-1)' : '';
  }

  stop() {
    this.token += 1;
    clearTimeout(this.timer);
    this.timer = 0;
    this.yEl.getAnimations?.().forEach((a) => a.cancel());
    this.clip = null;
  }

  /**
   * Play a clip. loop clips repeat until something else plays; once clips call onDone at the end;
   * hold clips repeat like loops (the caller decides when to leave them).
   */
  play(name, { flip = false, onDone = null, from = 0, speed = 1 } = {}) {
    const clip = this.pack.clips[name];
    if (!clip) return false;
    this.stop();
    const token = this.token;
    this.clip = name;
    this.el.dataset.clip = name;
    this.flip = flip && clip.side !== false;
    this.seq = clip.seq;
    this.i = from % clip.seq.length;
    const tick = () => {
      if (token !== this.token) return;
      const [frame, ms] = this.seq[this.i];
      this.show(frame, this.flip);
      this.timer = setTimeout(() => {
        if (token !== this.token) return;
        this.i += 1;
        if (this.i >= this.seq.length) {
          if (clip.mode === 'once') { this.clip = null; if (onDone) onDone(); return; }
          this.i = 0;
        }
        if (this.paused) { this.resume = tick; return; }
        tick();
      }, ms / speed);
    };
    tick();
    return true;
  }

  duration(name) { return (this.pack.clips[name]?.seq || []).reduce((n, [, ms]) => n + ms, 0); }

  pause() { this.paused = true; }
  unpause() {
    if (!this.paused) return;
    this.paused = false;
    if (this.resume) { const r = this.resume; this.resume = null; r(); }
  }

  /** Where the element's top-left goes so that the feet stand at (x, y). x is the left edge of the sprite. */
  t(x, y) { return `translate3d(${x}px,${y - this.ph + this.footPad}px,0)`; }

  /** Slide to x (feet staying on line y) over ms, linearly. */
  moveTo(x, ms = 0, y = this.y) {
    this.el.getAnimations?.().forEach((a) => a.cancel());
    this.el.style.transition = ms ? `transform ${ms}ms linear` : 'none';
    this.el.style.transform = this.t(x, y);
    this.x = x; this.y = y;
  }

  /** Read back where the sprite really is (after an interrupted move). */
  currentX(layerLeft) { return this.el.getBoundingClientRect().left - layerLeft; }

  /** A parabolic hop from the current spot to (x, y). Resolves when it lands. */
  hop(x, y, ms, height = 26) {
    const x0 = this.x; const y0 = this.y;
    const peak = Math.min(y0, y) - height;
    const frames = [];
    for (let i = 0; i <= 10; i++) {
      const t = i / 10;
      // quadratic through (0,y0) (0.5,peak) (1,y)
      const yy = (1 - t) * (1 - t) * y0 + 2 * (1 - t) * t * (2 * peak - (y0 + y) / 2) + t * t * y;
      frames.push({ transform: this.t(x0 + (x - x0) * t, yy) });
    }
    this.el.style.transition = 'none';
    const anim = this.el.animate ? this.el.animate(frames, { duration: ms, easing: 'linear' }) : null;
    this.el.style.transform = this.t(x, y);
    this.x = x; this.y = y;
    return anim ? anim.finished.catch(() => {}) : Promise.resolve();
  }

  /** Arc the body upward by `rise` px over ms (the frames show the pose; this moves it). */
  arc(rise, ms, shape = [[0, 0], [0.19, 0], [0.32, 1], [0.6, 1], [0.79, 0], [1, 0]]) {
    if (!this.yEl.animate) return;
    this.yEl.animate(shape.map(([offset, k]) => ({ offset, transform: `translate3d(0,${-rise * k}px,0)` })), { duration: ms, easing: 'ease-in-out' });
  }

  showCard(text) {
    const c = this.pack.clips.card; if (!c || !c.cardRect) return;
    const [x0, y0, x1, y1] = c.cardRect;
    if (!this.cardEl) {
      this.cardEl = document.createElement('div');
      this.cardEl.className = 'pet-card';
      this.yEl.append(this.cardEl);
    }
    const s = this.scale;
    Object.assign(this.cardEl.style, { left: `${(x0 + 1) * s}px`, top: `${(y0 + 1) * s}px`, width: `${(x1 - x0 - 2) * s}px`, height: `${(y1 - y0 - 2) * s}px` });
    const w = (x1 - x0 - 3) * s;
    this.cardEl.style.fontSize = `${Math.max(8, Math.min(15, Math.floor(w / Math.max(3, text.length * 0.62))))}px`;
    this.cardEl.textContent = text;
    this.cardEl.hidden = false;
  }
  hideCard() { if (this.cardEl) this.cardEl.hidden = true; }
}
