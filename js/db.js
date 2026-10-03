const DB_NAME = 'agenda-local';
const VER = 1;
const STORE = 'days';

let _db;

export function open() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, VER);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) {
        req.result.createObjectStore(STORE, { keyPath: 'date' });
      }
    };
    req.onsuccess = () => { _db = req.result; resolve(_db); };
    req.onerror = () => reject(req.error);
  });
}

export function emptyDay(date) {
  return { date, tasks: [], citas: [], notas: '', ideas: '', diario: '' };
}

function tx(mode) { return _db.transaction(STORE, mode).objectStore(STORE); }

export function getDay(date) {
  return new Promise((resolve) => {
    tx('readonly').get(date).onsuccess = (e) => resolve(e.target.result || emptyDay(date));
  });
}

export function putDay(day) {
  return new Promise((resolve, reject) => {
    const r = tx('readwrite').put(day);
    r.onsuccess = () => resolve();
    r.onerror = () => reject(r.error);
  });
}

export function allDays() {
  return new Promise((resolve) => {
    tx('readonly').getAll().onsuccess = (e) => resolve(e.target.result || []);
  });
}

export function allKeys() {
  return new Promise((resolve) => {
    tx('readonly').getAllKeys().onsuccess = (e) => resolve(e.target.result || []);
  });
}

export function clearAll() {
  return new Promise((resolve, reject) => {
    const r = tx('readwrite').clear();
    r.onsuccess = () => resolve();
    r.onerror = () => reject(r.error);
  });
}
