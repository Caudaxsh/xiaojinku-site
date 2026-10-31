// A decorative F1 pass on the home page: the car drives in from the left and out to the right
// (the 12 frames already contain the motion), then a chequered flag waves once at the right end.
// The strip sits just above the tab bar, never takes taps, and plays once per visit to "今日".

const CAR = Array.from({ length: 12 }, (_, i) => `race/f1/car_${String(i + 1).padStart(2, '0')}.png`);
const FLAG = Array.from({ length: 4 }, (_, i) => `race/f1/finish_flag_${String(i + 1).padStart(2, '0')}.png`);
const CAR_FPS = 14;
const FLAG_FPS = 10;
const FLAG_HOLD_MS = 350;
const FADE_MS = 250;
const reduceMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

let strip = null; let timer = 0; let alive = 0;

const wait = (ms, id) => new Promise((resolve) => { timer = setTimeout(() => resolve(id === alive), ms); });

function layer(srcs, cls) {
  return srcs.map((src) => {
    const img = new Image();
    img.className = cls;
    img.alt = '';
    img.decoding = 'async';
    img.src = src;
    return img;
  });
}

/** Show exactly one image of the set (the others stay in place, just invisible, so nothing flickers). */
const only = (imgs, n) => imgs.forEach((img, i) => { img.style.visibility = i === n ? 'visible' : 'hidden'; });

async function play(id, cars, flags) {
  // Wait until every frame is decoded; if any fails, skip the decoration quietly.
  const ready = await Promise.race([
    Promise.all([...cars, ...flags].map((img) => img.decode().then(() => true))).catch(() => false),
    new Promise((r) => setTimeout(() => r(false), 5000)),
  ]);
  if (!ready || id !== alive) return;
  strip.classList.add('on');
  for (let i = 0; i < cars.length; i++) {
    only(cars, i);
    if (!(await wait(1000 / CAR_FPS, id))) return;
  }
  only(cars, -1);
  strip.classList.add('flag');
  for (let i = 0; i < flags.length; i++) {
    only(flags, i);
    if (!(await wait(1000 / FLAG_FPS, id))) return;
  }
  if (!(await wait(FLAG_HOLD_MS, id))) return;
  strip.classList.add('fade');
  if (!(await wait(FADE_MS, id))) return;
  strip.remove();
  strip = null;
}

export function stop() {
  alive += 1;
  clearTimeout(timer); timer = 0;
  if (strip) strip.remove();
  strip = null;
}

/** Add the strip to `host` and play one pass. */
export function attach(host) {
  stop();
  if (!host || reduceMotion()) return; // reduced motion: no decoration at all
  const id = alive;
  strip = document.createElement('div');
  strip.className = 'race';
  strip.setAttribute('aria-hidden', 'true');
  const cars = layer(CAR, 'race-car');
  const flags = layer(FLAG, 'race-flag');
  only(cars, -1); only(flags, -1);
  strip.append(...cars, ...flags);
  document.body.append(strip); // not inside #view: its animation would turn "fixed" into "relative to the view"
  play(id, cars, flags).catch(() => {});
}
