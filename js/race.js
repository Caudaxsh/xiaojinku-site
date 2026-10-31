// A small decorative F1 car on the home page, about Goku-sized, pulling a short banner behind it.
// Tap the chequered flag at the right end: the car drives in from the left and out to the right just
// above the tab bar, and the flag waves only while the car (and its banner) is on screen. Then it rests
// until the next tap. The banner font alternates every pass. Rests on the top edge of the tab bar, and
// only exists while the "今日" page is showing.

const CAR_FILES = [1, 2, 3].map((n) => `race/f1s/car_${n}.png`);
const FLAG_FILES = [1, 2, 3, 4].map((n) => `race/f1s/flag_${n}.png`);
const CAR_SEQ = [0, 1, 2, 1]; // back and forth through the aligned frames: smoke and sparks keep moving
const CAR_FPS = 10;
const FLAG_FPS = 8;
const SPEED = 120; // px per second
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

async function run(id, cars, flags, box, banner, button) {
  const loading = Promise.all([
    ...[...cars, ...flags].map((img) => img.decode()),
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
    const tick = (now) => {
      if (id !== alive) return;
      const t = (now - start) / 1000;
      const x = -box.offsetWidth + t * SPEED;
      if (x > strip.clientWidth) { // car and banner are completely gone: the flag stops
        box.style.visibility = 'hidden';
        only(flags, 0);
        running = false;
        return;
      }
      box.style.visibility = 'visible';
      box.style.transform = `translateX(${x.toFixed(1)}px)`;
      only(cars, CAR_SEQ[Math.floor(t * CAR_FPS) % CAR_SEQ.length]);
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
  strip.append(box, button);
  // Inside the tab bar, resting on its top edge: the wheels then touch the bar exactly, on any device.
  tabs.append(strip);
  run(id, cars, flags, box, banner, button).catch(() => {});
}
