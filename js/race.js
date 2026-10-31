// A small F1 car that drives across the bottom of the home page now and then.
// race/ferrari.png is a 4 x 10 sheet of 40 frames; the car already moves left to right inside them.

const COLS = 4;
const ROWS = 10;
const FRAMES = 40;
const FPS = 24;
const reduceMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

let el = null; let timer = 0; let frame = 0;

function show(i) {
  const col = i % COLS; const row = Math.floor(i / COLS);
  el.style.backgroundPosition = `${(col / (COLS - 1)) * 100}% ${(row / (ROWS - 1)) * 100}%`;
}

function drive() {
  if (!el || !el.isConnected) return stop();
  frame = 0;
  el.classList.add('go');
  const step = () => {
    if (!el || !el.isConnected) return stop();
    if (frame >= FRAMES) {
      el.classList.remove('go');
      timer = setTimeout(drive, 4000 + Math.random() * 6000); // wait, then another pass
      return;
    }
    show(frame++);
    timer = setTimeout(step, 1000 / FPS);
  };
  step();
}

export function stop() {
  clearTimeout(timer); timer = 0;
  el = null;
}

/** Put the car strip at the end of `host` and start the passes. */
export function attach(host) {
  stop();
  if (!host || reduceMotion()) return;
  el = document.createElement('div');
  el.className = 'race';
  el.setAttribute('aria-hidden', 'true');
  host.append(el);
  timer = setTimeout(drive, 900 + Math.random() * 1500); // first pass soon after the page opens
}
