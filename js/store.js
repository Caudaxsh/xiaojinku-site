// Local-only storage. IndexedDB first, localStorage as a fallback for private
// windows where IndexedDB is unavailable. Nothing ever leaves the device.

const DB_NAME = 'xiaojinku-vocab';
const LS_KEY = 'xiaojinku-vocab-v1';

function openDb() {
  return new Promise((resolve, reject) => {
    if (!('indexedDB' in window)) return reject(new Error('no indexedDB'));
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      db.createObjectStore('cards', { keyPath: 'id' });
      db.createObjectStore('meta');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

const wrap = (req) =>
  new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });

async function idbBackend() {
  const db = await openDb();
  const store = (name, mode = 'readonly') => db.transaction(name, mode).objectStore(name);
  const done = (tx) =>
    new Promise((resolve, reject) => {
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  return {
    kind: 'indexeddb',
    getAll: () => wrap(store('cards').getAll()),
    async putMany(cards) {
      const tx = db.transaction('cards', 'readwrite');
      cards.forEach((c) => tx.objectStore('cards').put(c));
      await done(tx);
    },
    async remove(id) {
      const tx = db.transaction('cards', 'readwrite');
      tx.objectStore('cards').delete(id);
      await done(tx);
    },
    async clear() {
      const tx = db.transaction(['cards', 'meta'], 'readwrite');
      tx.objectStore('cards').clear();
      tx.objectStore('meta').clear();
      await done(tx);
    },
    getMeta: (key) => wrap(store('meta').get(key)),
    async setMeta(key, value) {
      const tx = db.transaction('meta', 'readwrite');
      tx.objectStore('meta').put(value, key);
      await done(tx);
    },
  };
}

function lsBackend() {
  const read = () => {
    try {
      return JSON.parse(localStorage.getItem(LS_KEY)) || { cards: {}, meta: {} };
    } catch {
      return { cards: {}, meta: {} };
    }
  };
  const write = (data) => localStorage.setItem(LS_KEY, JSON.stringify(data));
  return {
    kind: 'localstorage',
    async getAll() { return Object.values(read().cards); },
    async putMany(cards) {
      const d = read();
      cards.forEach((c) => { d.cards[c.id] = c; });
      write(d);
    },
    async remove(id) { const d = read(); delete d.cards[id]; write(d); },
    async clear() { write({ cards: {}, meta: {} }); },
    async getMeta(key) { return read().meta[key]; },
    async setMeta(key, value) { const d = read(); d.meta[key] = value; write(d); },
  };
}

function memoryBackend() {
  const cards = new Map();
  const meta = new Map();
  return {
    kind: 'memory',
    async getAll() { return [...cards.values()]; },
    async putMany(list) { list.forEach((c) => cards.set(c.id, c)); },
    async remove(id) { cards.delete(id); },
    async clear() { cards.clear(); meta.clear(); },
    async getMeta(key) { return meta.get(key); },
    async setMeta(key, value) { meta.set(key, value); },
  };
}

export async function createStore() {
  try {
    return await idbBackend();
  } catch {
    try {
      localStorage.setItem(`${LS_KEY}:probe`, '1');
      localStorage.removeItem(`${LS_KEY}:probe`);
      return lsBackend();
    } catch {
      return memoryBackend();
    }
  }
}
