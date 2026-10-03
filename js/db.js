const DB_NAME = 'agenda-local';
const VER = 2;
const STORE = 'days';
const BACKUPS = 'backups';

let _db;

export function open() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, VER);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'date' });
      }
      if (!db.objectStoreNames.contains(BACKUPS)) {
        db.createObjectStore(BACKUPS, { keyPath: 'ts' });   // copias rotativas
      }
    };
    req.onsuccess = () => { _db = req.result; resolve(_db); };
    req.onerror = () => reject(req.error);
  });
}

export function emptyDay(date) {
  return { date, tasks: [], citas: [], notas: '', ideas: '', diario: '' };
}

function store(name) { return _db.transaction(name, 'readwrite').objectStore(name); }
function ro(name) { return _db.transaction(name, 'readonly').objectStore(name); }

export function getDay(date) {
  return new Promise((resolve) => {
    ro(STORE).get(date).onsuccess = (e) => resolve(e.target.result || emptyDay(date));
  });
}

export function putDay(day) {
  return new Promise((resolve, reject) => {
    const r = store(STORE).put(day);
    r.onsuccess = () => resolve();
    r.onerror = () => reject(r.error);
  });
}

export function allDays() {
  return new Promise((resolve) => {
    ro(STORE).getAll().onsuccess = (e) => resolve(e.target.result || []);
  });
}

export function allKeys() {
  return new Promise((resolve) => {
    ro(STORE).getAllKeys().onsuccess = (e) => resolve(e.target.result || []);
  });
}

// Reemplaza todos los días por los de `days` (usado al restaurar una copia).
export function replaceDays(days) {
  return new Promise((resolve, reject) => {
    const t = _db.transaction(STORE, 'readwrite');
    const s = t.objectStore(STORE);
    s.clear();
    for (const d of days) if (d && d.date) s.put(d);
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
  });
}

export function clearAll() {
  return new Promise((resolve, reject) => {
    const r = store(STORE).clear();
    r.onsuccess = () => resolve();
    r.onerror = () => reject(r.error);
  });
}

// --- Copias de seguridad (rotativas) ---
export function putBackup(ts, data) {
  return new Promise((resolve, reject) => {
    const r = store(BACKUPS).put({ ts, data });
    r.onsuccess = () => resolve();
    r.onerror = () => reject(r.error);
  });
}

export function allBackups() {
  return new Promise((resolve) => {
    ro(BACKUPS).getAll().onsuccess = (e) => {
      const arr = e.target.result || [];
      arr.sort((a, b) => b.ts - a.ts);
      resolve(arr);
    };
  });
}

export function deleteBackup(ts) {
  return new Promise((resolve, reject) => {
    const r = store(BACKUPS).delete(ts);
    r.onsuccess = () => resolve();
    r.onerror = () => reject(r.error);
  });
}
