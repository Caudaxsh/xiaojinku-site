// Offline cache. Bump CACHE whenever any app file changes so phones pick up the update.
const CACHE = 'cash-volcab-v27';
const ASSETS = [
  './',
  'index.html',
  'styles.css',
  'manifest.webmanifest',
  'js/app.js',
  'js/parser.js',
  'js/srs.js',
  'js/store.js',
  'js/audio.js',
  'js/pdf.js',
  'js/icons.js',
  'js/pet/pet.js',
  'js/pet/sprite.js',
  'js/pet/brain.js',
  'js/pet/pack.js',
  'pet.html',
  'pet/goku.petpack.json',
  'icons/favicon-32.png',
  'icons/favicon-64.png',
  'icons/icon-maskable-512.png',
  'icons/icon-180.png',
  'icons/icon-192.png',
  'icons/icon-512.png',
  ...[1, 2, 3].map((n) => `race/f1s/car_${n}.png`),
  ...[1, 2, 3, 4].map((n) => `race/f1s/flag_${n}.png`),
  'js/race.js',
  'samples/sample-words.txt',
  'samples/flagship.txt',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// Network first so a fresh deploy shows up right away; cache is the offline fallback.
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  event.respondWith(
    fetch(req, { cache: 'no-cache' })
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      })
      .catch(() => caches.match(req).then((hit) => hit || caches.match('index.html'))),
  );
});
