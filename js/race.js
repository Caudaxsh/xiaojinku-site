// A small decorative F1 car on the home page, about Goku-sized, pulling a short banner behind it.
// It drives in from the left and out to the right just above the tab bar, while a chequered flag at
// the right end keeps waving. The banner font alternates every pass. Click-through, rests on the top
// edge of the tab bar, and only exists while the "今日" page is showing.

const CAR_FILES = [1, 2, 3].map((n) => `race/f1s/car_${n}.png`);
const FLAG_FILES = [1, 2, 3, 4].map((n) => `race/f1s/flag_${n}.png`);
const CAR_SEQ = [0, 1, 2, 1]; // back and forth through the aligned frames: smoke and sparks keep moving
const CAR_FPS = 10;
const FLAG_FPS = 8;
const SPEED = 120; // px per second
const GAP_MS = 2500; // pause between the car leaving and the next one entering
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

async function run(id, cars, flags, box, banner) {
  const loading = Promise.all([
    ...[...cars, ...flags].map((img) => img.decode()),
    ...FONT_SPECS.map((spec) => document.fonts.load(spec, TEXT)),
  ]).then(() => true).catch(() => false);
  const ready = await Promise.race([loading, new Promise((r) => setTimeout(() => r(false), 5000))]);
  if (!ready || id !== alive) return; // missing files: no decoration, nothing else affected
  strip.classList.add('on');
  const t0 = performance.now();
  let passStart = t0 + 700;
  let pass = Math.floor(Math.random() * FONTS.length); // a different font each time, starting at random
  banner.className = `race-banner ${FONTS[pass % FONTS.length]}`;
  const tick = (now) => {
    if (id !== alive) return;
    only(flags, Math.floor(((now - t0) / 1000) * FLAG_FPS) % flags.length);
    const t = (now - passStart) / 1000;
    if (t >= 0) {
      const width = strip.clientWidth; const boxW = box.offsetWidth;
      const x = -boxW + t * SPEED;
      if (x > width) {
        box.style.visibility = 'hidden';
        passStart = now + GAP_MS;
        pass += 1;
        banner.className = `race-banner ${FONTS[pass % FONTS.length]}`;
      } else {
        box.style.visibility = 'visible';
        only(cars, CAR_SEQ[Math.floor(t * CAR_FPS) % CAR_SEQ.length]);
        box.style.transform = `translateX(${x.toFixed(1)}px)`;
      }
    }
    raf = requestAnimationFrame(tick);
  };
  box.style.visibility = 'hidden';
  raf = requestAnimationFrame(tick);
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
  strip.setAttribute('aria-hidden', 'true');
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
  const flags = images(FLAG_FILES, 'race-flag');
  strip.append(...flags, box);
  // Inside the tab bar, resting on its top edge: the wheels then touch the bar exactly, on any device.
  tabs.append(strip);
  run(id, cars, flags, box, banner).catch(() => {});
}
