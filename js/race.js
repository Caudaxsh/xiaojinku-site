// A small decorative F1 car on the home page, about Goku-sized. Every 5 seconds it drives in from the
// left and out to the right just above the tab bar, while a chequered flag at the right end keeps waving.
// Click-through, rests on the top edge of the tab bar, and only exists while the "今日" page is showing.

const CAR_FILES = [1, 2, 3].map((n) => `race/f1s/car_${n}.png`);
const FLAG_FILES = [1, 2, 3, 4].map((n) => `race/f1s/flag_${n}.png`);
const CAR_SEQ = [0, 1, 2, 1]; // back and forth through the aligned frames: smoke and sparks keep moving
const CAR_FPS = 10;
const FLAG_FPS = 8;
const SPEED = 120; // px per second (was 250: about half as fast, a pass takes ~4 s)
const EVERY_MS = 5000; // a new pass every 5 seconds
const reduceMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

let strip = null; let alive = 0; let raf = 0; let passTimer = 0;

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
  cancelAnimationFrame(raf); clearTimeout(passTimer);
  raf = 0; passTimer = 0;
  if (strip) strip.remove();
  strip = null;
}

async function run(id, cars, flags, carBox) {
  const ready = await Promise.race([
    Promise.all([...cars, ...flags].map((img) => img.decode().then(() => true))).catch(() => false),
    new Promise((r) => setTimeout(() => r(false), 5000)),
  ]);
  if (!ready || id !== alive) return; // missing images: no decoration, nothing else affected
  strip.classList.add('on');
  const t0 = performance.now();
  let passStart = t0 + 700;
  const tick = (now) => {
    if (id !== alive) return;
    only(flags, Math.floor(((now - t0) / 1000) * FLAG_FPS) % flags.length);
    const t = (now - passStart) / 1000;
    if (t >= 0) {
      const width = strip.clientWidth; const carW = carBox.offsetWidth;
      const x = -carW + t * SPEED;
      if (x > width) {
        only(cars, -1);
        passStart += EVERY_MS; // next pass 5 s after this one entered
      } else {
        only(cars, CAR_SEQ[Math.floor(t * CAR_FPS) % CAR_SEQ.length]);
        carBox.style.transform = `translateX(${x.toFixed(1)}px)`;
      }
    }
    raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);
}

/** Add the strip to the page and start the loop. */
export function attach() {
  stop();
  if (reduceMotion()) return;
  const id = alive;
  strip = document.createElement('div');
  strip.className = 'race';
  strip.setAttribute('aria-hidden', 'true');
  const carBox = document.createElement('div');
  carBox.className = 'race-car';
  const cars = images(CAR_FILES, 'car');
  carBox.append(...cars);
  const flags = images(FLAG_FILES, 'race-flag');
  strip.append(...flags, carBox);
  // Inside the tab bar, resting on its top edge: the wheels then touch the bar exactly, on any device.
  const tabs = document.querySelector('.tabs');
  if (!tabs) return;
  tabs.append(strip);
  run(id, cars, flags, carBox).catch(() => {});
}
