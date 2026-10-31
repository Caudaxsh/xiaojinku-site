// A small F1 car that drives across the bottom of the home page now and then.
// race/ferrari.png holds an 18-frame wheel-spin loop of one car (6 x 3 cells); the page slides it left to right.

const COLS = 6;
const ROWS = 3;
const FRAMES = 18;
const FPS = 24;
const SPEED = 230; // px per second
const reduceMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

let strip = null; let car = null; let timer = 0; let raf = 0;

function show(i) {
  const col = i % COLS; const row = Math.floor(i / COLS);
  car.style.backgroundPosition = `${(col / (COLS - 1)) * 100}% ${(row / (ROWS - 1)) * 100}%`;
}

function drive() {
  if (!strip || !strip.isConnected) return stop();
  const width = strip.clientWidth; const carW = car.offsetWidth;
  const start = performance.now();
  car.hidden = false;
  const tick = (now) => {
    if (!strip || !strip.isConnected) return stop();
    const t = (now - start) / 1000;
    const x = -carW + t * SPEED;
    if (x > width) {
      car.hidden = true;
      timer = setTimeout(drive, 4000 + Math.random() * 7000); // wait, then another pass
      return;
    }
    show(Math.floor(t * FPS) % FRAMES);
    car.style.transform = `translateX(${x.toFixed(1)}px)`;
    raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);
}

export function stop() {
  clearTimeout(timer); cancelAnimationFrame(raf);
  timer = 0; raf = 0; strip = null; car = null;
}

/** Put the car strip at the end of `host` and start the passes. */
export function attach(host) {
  stop();
  if (!host || reduceMotion()) return;
  strip = document.createElement('div');
  strip.className = 'race';
  strip.setAttribute('aria-hidden', 'true');
  car = document.createElement('div');
  car.className = 'race-car';
  car.hidden = true;
  strip.append(car);
  host.append(strip);
  timer = setTimeout(drive, 900 + Math.random() * 1500); // first pass soon after the page opens
}
