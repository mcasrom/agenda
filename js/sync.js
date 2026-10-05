// Sincronización sin servidor propio.
// El usuario elige un fichero (p.ej. agenda-sync.json) dentro de una carpeta que
// ya sincroniza (Syncthing, Nextcloud, Google Drive, Dropbox, iCloud…). La app lee
// y escribe ahí con la File System Access API. Nada pasa por un servidor nuestro.

export const SYNC_FORMAT = 'agenda-sync';
export const SYNC_VERSION = 1;

// ¿Admite el navegador la File System Access API? (Chromium sí; Firefox/Safari no.)
export function supported() {
  return typeof window !== 'undefined'
    && typeof window.showSaveFilePicker === 'function'
    && typeof window.showOpenFilePicker === 'function';
}

// Fusión pura (testeable sin navegador): unión de días con "gana el más reciente"
// por día (updatedAt) y tombstones para propagar borrados.
export function mergeData(local, remote) {
  const localDays = (local && local.days) || [];
  const remoteDays = (remote && remote.days) || [];
  const localT = (local && local.tombstones) || {};
  const remoteT = (remote && remote.tombstones) || {};

  // tombstones = el más reciente de cada lado
  const tombstones = Object.assign({}, remoteT);
  for (const [date, ts] of Object.entries(localT)) {
    if (!tombstones[date] || ts > tombstones[date]) tombstones[date] = ts;
  }

  // por día: gana el updatedAt mayor (empate → el local, para no oscilar)
  const byDate = new Map();
  for (const d of remoteDays) if (d && d.date) byDate.set(d.date, d);
  for (const d of localDays) {
    if (!d || !d.date) continue;
    const cur = byDate.get(d.date);
    if (!cur || String(d.updatedAt || '') >= String(cur.updatedAt || '')) byDate.set(d.date, d);
  }

  // aplica borrados: si el tombstone es más nuevo que el día, se excluye
  const days = [];
  for (const day of byDate.values()) {
    const tomb = tombstones[day.date];
    if (tomb && tomb > String(day.updatedAt || '')) continue;
    days.push(day);
  }
  days.sort((a, b) => String(a.date).localeCompare(String(b.date)));

  const norm = (arr) => JSON.stringify([...arr].sort((a, b) => String(a.date).localeCompare(String(b.date))));
  const changedLocal = norm(days) !== norm(localDays);
  const changedRemote = norm(days) !== norm(remoteDays);

  return { days, tombstones, changedLocal, changedRemote };
}

// --- Fichero ---

// Pide al usuario un fichero (crear o elegir uno existente en la carpeta sincronizada).
export async function pickSyncFile() {
  if (typeof window.showSaveFilePicker === 'function') {
    return window.showSaveFilePicker({
      suggestedName: 'agenda-sync.json',
      types: [{ description: 'Agenda (sincronización)', accept: { 'application/json': ['.json'] } }],
    });
  }
  const [handle] = await window.showOpenFilePicker({
    types: [{ description: 'Agenda (sincronización)', accept: { 'application/json': ['.json'] } }],
    multiple: false,
  });
  return handle;
}

export async function ensurePermission(handle, request) {
  const opts = { mode: 'readwrite' };
  if ((await handle.queryPermission(opts)) === 'granted') return true;
  if (!request) return false;
  return (await handle.requestPermission(opts)) === 'granted';
}

export async function readSyncFile(handle) {
  const file = await handle.getFile();
  const text = await file.text();
  if (!text.trim()) return null;
  let data;
  try { data = JSON.parse(text); }
  catch { throw new Error('el archivo no es JSON válido'); }
  if (!data || data.app !== SYNC_FORMAT) throw new Error('el archivo no es de esta agenda');
  return data;
}

export async function writeSyncFile(handle, data) {
  const w = await handle.createWritable();
  await w.write(JSON.stringify(data, null, 2));
  await w.close();
}

export function makeRemote(days, tombstones) {
  return {
    app: SYNC_FORMAT,
    schemaVersion: SYNC_VERSION,
    updatedAt: new Date().toISOString(),
    days: days || [],
    tombstones: tombstones || {},
  };
}
