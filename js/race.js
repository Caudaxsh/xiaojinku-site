// A small decorative F1 car on the home page, about Goku-sized, pulling a short banner behind it.
// Layers: road mark / smoke puffs / car + banner. The puffs are separate objects that stay on the road.
// Tap the chequered flag at the right end: the car drives in from the left and out to the right just
// above the tab bar, and the flag waves only while the car (and its banner) is on screen. Then it rests
// until the next tap. The banner font alternates every pass. Rests on the top edge of the tab bar, and
// only exists while the "今日" page is showing.

const pad2 = (n) => String(n).padStart(2, '0');
const CAR_FILES = Array.from({ length: 12 }, (_, i) => `race/f2/car_${pad2(i + 1)}.png`); // fixed body, only the tyre blur changes
const SMOKE_FILES = Array.from({ length: 12 }, (_, i) => `race/f2/smoke_${pad2(i + 1)}.png`);
const MARK_FILE = 'race/f2/mark.png';
const FLAG_FILES = [1, 2, 3, 4].map((n) => `race/f1s/flag_${n}.png`);
const CAR_FPS = 12;
const FLAG_FPS = 8;
const SPEED = 120; // px per second
// Where the rear tyre touches the road inside the car image (css px from its left), and the smoke puffs:
// they are born there, then stay behind on the road while the car drives on (never glued to the car).
const REAR_X = 12.8;
const SMOKE_MS = 600;
const SMOKE_SPOTS = [{ at: 0.24, size: 1, alpha: 0.9 }, { at: 0.36, size: 0.7, alpha: 0.55 }]; // small wheel-spin after the start
const MARK_W = 61;
const SMOKE_ANCHOR = [44.8, 20.4]; // the point of a puff image that sits on the rear tyre's ground contact
const TEXT = "You're on pole position.";
const FONTS = ['pixel', 'glitch']; // Press Start 2P, Rubik Glitch: taken in turns
const FONT_SPECS = ["8px 'Press Start 2P'", "12px 'Rubik Glitch'"];
const reduceMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

let strip = null; let alive = 0; let raf = 0;

function images(files, cls) {
  return files.map((src) => {
    const img = new Image();
    img.className = cls;
    img.alt = '';
    img.decoding = 'async';
    img.src = src;
    img.style.visibility = 'hidden';
    return img;
  });
}
const only = (imgs, n) => imgs.forEach((img, i) => { img.style.visibility = i === n ? 'visible' : 'hidden'; });

export function stop() {
  alive += 1;
  cancelAnimationFrame(raf);
  raf = 0;
  if (strip) strip.remove();
  strip = null;
}

function smokePuff(imgs) {
  const el = document.createElement('div');
  el.className = 'race-smoke';
  el.append(...imgs);
  return el;
}

async function run(id, parts) {
  const { cars, flags, smokes, mark, box, banner, button } = parts;
  const smokeImgs = smokes.flat();
  const loading = Promise.all([
    ...[...cars, ...flags, ...smokeImgs, mark].map((img) => img.decode()),
    ...FONT_SPECS.map((spec) => document.fonts.load(spec, TEXT)),
  ]).then(() => true).catch(() => false);
  const ready = await Promise.race([loading, new Promise((r) => setTimeout(() => r(false), 5000))]);
  if (!ready || id !== alive) return; // missing files: no decoration, nothing else affected
  strip.classList.add('on');
  only(flags, 0); // the flag rests still until it is tapped
  box.style.visibility = 'hidden';
  let pass = Math.floor(Math.random() * FONTS.length); // a different font each time, starting at random
  let running = false;

  const drive = () => {
    if (running || id !== alive) return;
    running = true;
    banner.className = `race-banner ${FONTS[pass % FONTS.length]}`;
    pass += 1;
    const start = performance.now();
    const puffs = smokes.map((imgs, i) => ({ el: imgs[0].parentNode, imgs, spot: SMOKE_SPOTS[i], t0: 0, done: false }));
    mark.style.opacity = '0';
    const tick = (now) => {
      if (id !== alive) return;
      const t = (now - start) / 1000;
      const width = strip.clientWidth;
      const x = -box.offsetWidth + t * SPEED;
      const rear = x + banner.offsetWidth + 14 + REAR_X; // screen x of the rear tyre's contact point
      // Birth of each puff: the moment the rear tyre passes its spot. From then on it stays put on the road.
      puffs.forEach((p) => {
        if (!p.t0 && !p.done && rear >= width * p.spot.at) {
          p.t0 = now;
          const sx = width * p.spot.at;
          p.el.style.left = `${(sx - SMOKE_ANCHOR[0]).toFixed(1)}px`;
          if (p === puffs[0]) { // the only skid mark: fixed to the road where the wheel spun
            mark.style.left = `${(sx - MARK_W * 0.72).toFixed(1)}px`;
            mark.style.transition = 'none'; mark.style.opacity = '0.75';
            requestAnimationFrame(() => { mark.style.transition = 'opacity 1.2s ease 1.2s'; mark.style.opacity = '0'; });
          }
        }
        if (p.t0 && !p.done) {
          const u = (now - p.t0) / SMOKE_MS;
          if (u >= 1) { p.done = true; p.el.style.visibility = 'hidden'; return; }
          only(p.imgs, Math.min(11, Math.floor(u * 12)));
          const fade = Math.min(1, u / 0.15) * (1 - u); // quick in, slow out
          p.el.style.visibility = 'visible';
          p.el.style.opacity = (fade * p.spot.alpha).toFixed(3);
          // drifts back (left) and up a little, grows by about 20%: left behind, not following the car
          p.el.style.transform = `translate(${(-10 * u).toFixed(1)}px, ${(-5 * u).toFixed(1)}px) scale(${((1 + 0.2 * u) * p.spot.size).toFixed(3)})`;
        }
      });
      if (x > width) { // car and banner are completely gone: the flag stops
        box.style.visibility = 'hidden';
        only(flags, 0);
        running = false;
        return;
      }
      box.style.visibility = 'visible';
      box.style.transform = `translateX(${x.toFixed(1)}px)`;
      only(cars, Math.floor(t * CAR_FPS) % cars.length);
      only(flags, Math.floor(t * FLAG_FPS) % flags.length); // the flag waves while the car is out
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
  };
  button.addEventListener('click', drive);
}

/** Add the strip to the tab bar and start the loop. */
export function attach() {
  stop();
  if (reduceMotion()) return;
  const tabs = document.querySelector('.tabs');
  if (!tabs) return;
  const id = alive;
  strip = document.createElement('div');
  strip.className = 'race';
  const box = document.createElement('div');
  box.className = 'race-car';
  const banner = document.createElement('span');
  banner.className = 'race-banner pixel';
  banner.textContent = TEXT;
  const tow = document.createElement('span');
  tow.className = 'race-tow';
  const carWrap = document.createElement('div');
  carWrap.className = 'race-wheels';
  const cars = images(CAR_FILES, 'car');
  carWrap.append(...cars);
  box.append(banner, tow, carWrap);
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'race-flag-btn';
  button.setAttribute('aria-label', 'Send the race car');
  const flags = images(FLAG_FILES, 'race-flag');
  button.append(...flags);
  const mark = images([MARK_FILE], 'race-mark')[0];
  mark.style.visibility = 'visible'; mark.style.opacity = '0';
  const smokes = SMOKE_SPOTS.map(() => images(SMOKE_FILES, 'smoke'));
  const puffEls = smokes.map(smokePuff);
  // Layers, bottom to top: road mark, smoke, car (+ banner), flag button.
  strip.append(mark, ...puffEls, box, button);
  // Inside the tab bar, resting on its top edge: the wheels then touch the bar exactly, on any device.
  tabs.append(strip);
  run(id, { cars, flags, smokes, mark, box, banner, button }).catch(() => {});
}
