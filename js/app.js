import { open, getDay, putDay, allDays, allKeys, clearAll, emptyDay, putBackup, allBackups, deleteBackup, replaceDays, allTombstones, replaceTombstones, putTombstone, getMeta, putMeta, deleteMeta } from './db.js';
import { iso, fromISO, addDays, todayISO, fmtLong } from './date.js';
import { renderMonth } from './calendar.js';
import { searchAll } from './search.js';
import { toJSON, toMarkdown, toOrg, toICS, download, parseAuto } from './export.js';
import { encryptText, decryptText, isEncrypted } from './crypto.js';
import { supported as syncSupported, pickSyncFile, ensurePermission, readSyncFile, writeSyncFile, mergeData, makeRemote } from './sync.js';
import { VERSION, APP_URL, KOFI_URL, REPO_URL, LICENSE } from './version.js';

const $ = (s) => document.querySelector(s);

let db;
let cur = new Date();
let view = 'day';
let calY, calM;
let day = null;
let deferredPrompt = null;
const settings = loadSettings();
const funnel = loadFunnel();

function loadFunnel() {
  const def = { onboarded: false, firstEntry: false, installed: false, exported: false, hidden: false, lastExport: null };
  try { return Object.assign(def, JSON.parse(localStorage.getItem('agenda-funnel') || '{}')); }
  catch { return def; }
}
function saveFunnel() { localStorage.setItem('agenda-funnel', JSON.stringify(funnel)); }
function markStep(k) { if (!funnel[k]) { funnel[k] = true; saveFunnel(); renderPuesta(); } }

function loadSettings() {
  const def = { dark: false, firstDay: 1, notify: false };
  try { return Object.assign(def, JSON.parse(localStorage.getItem('agenda-settings') || '{}')); }
  catch { return def; }
}
function saveSettings() { localStorage.setItem('agenda-settings', JSON.stringify(settings)); }

// Varias pestañas: se avisan por BroadcastChannel y las escrituras se serializan
// con Web Locks para que una no pise a otra.
const bc = ('BroadcastChannel' in window) ? new BroadcastChannel('agenda') : null;
let pendingRemote = false;

function notifyChange() { if (bc) bc.postMessage({ t: 'data', date: iso(cur) }); }

function inputFocused() {
  const ae = document.activeElement;
  return ae && (ae.id === 'notas' || ae.id === 'ideas' || ae.id === 'diario');
}

async function remoteRefresh() {
  if (inputFocused()) { pendingRemote = true; return; }
  pendingRemote = false;
  await showDay(cur);
  if (view === 'month') renderCal();
  flash('Actualizado desde otra pestaña');
}

function withLock(fn) {
  if (navigator.locks && navigator.locks.request) return navigator.locks.request('agenda-write', fn);
  return fn();
}

async function saveDay(target) {
  const d = target || day;
  if (!d) return;
  await withLock(() => putDay(touch(d)));
  notifyChange();
  scheduleSync();
}

async function init() {
  db = await open();
  applySettings();
  wire();
  await showDay(cur);
  renderPuesta();
  renderCopia();
  requestPersist();
  maybeOnboard();
  registerSW();
  maybeAutoBackup();
  checkReminders();
  setInterval(checkReminders, 30000);
  initSync();
  setInterval(() => { if (!document.hidden) syncNow({ silent: true }); }, 5 * 60000);
  if (bc) bc.onmessage = (e) => { if (e.data && e.data.t === 'data') remoteRefresh(); };
  document.addEventListener('visibilitychange', () => { if (document.hidden) flushSave(); else { remoteRefresh(); checkReminders(); syncNow({ silent: true }); } });
  window.addEventListener('beforeunload', flushSave);
  renderNet();
  window.addEventListener('online', renderNet);
  window.addEventListener('offline', renderNet);
}

function renderNet() {
  const el = $('#net');
  if (!el) return;
  if (navigator.onLine) { el.hidden = true; el.textContent = ''; }
  else { el.hidden = false; el.textContent = '☁︎ sin conexión · sigues funcionando'; }
}

// --- Recordatorios de citas (mientras la agenda está abierta) ---
function triggerTime(dateStr, hhmm, remindMin) {
  const d = new Date(dateStr + 'T' + hhmm + ':00');
  if (Number.isNaN(d.getTime())) return null;
  d.setMinutes(d.getMinutes() - (remindMin || 0));
  return d;
}

function fireReminder(c) {
  const title = 'Cita ' + (c.h || '');
  try {
    if ('Notification' in window && Notification.permission === 'granted') {
      new Notification(title, { body: c.t, tag: 'agenda-' + c.h + '|' + (c.t || '').slice(0, 20) });
    }
  } catch { /* sin notificación del sistema: queda el aviso en pantalla */ }
  showToast('🔔 ' + (c.h ? c.h + ' · ' : '') + c.t);
}

async function checkReminders() {
  if (!settings.notify) return;
  const date = todayISO();
  await flushSave();
  const d = await getDay(date);
  let changed = false;
  for (const c of (d.citas || [])) {
    if (!c.t || c.remind == null || c.notified) continue;
    if (!/^\d{2}:\d{2}$/.test(c.h || '')) continue;
    const trig = triggerTime(date, c.h, c.remind);
    if (!trig) continue;
    const diff = Date.now() - trig.getTime();
    if (diff >= 0 && diff <= 90 * 60000) {
      fireReminder(c);
      c.notified = new Date().toISOString();
      changed = true;
    }
  }
  if (changed) {
    await putDay(touch(d));
    if (day && day.date === date) showDay(cur);
    notifyChange();
  }
}

async function onNotifyToggle(e) {
  if (!e.target.checked) { settings.notify = false; saveSettings(); return; }
  if (!('Notification' in window)) { e.target.checked = false; alert('Este navegador no admite notificaciones.'); return; }
  let perm = Notification.permission;
  if (perm === 'default') perm = await Notification.requestPermission();
  if (perm === 'granted') { settings.notify = true; saveSettings(); flash('Avisos de citas activados'); checkReminders(); }
  else { settings.notify = false; saveSettings(); e.target.checked = false; alert('Permiso de notificaciones denegado. Puedes activarlo en el navegador.'); }
}

// --- Sincronización (sin servidor propio): fichero en una carpeta que ya sincronizas ---
let syncHandle = null;
let syncFileName = '';
let syncLast = null;
let syncTimer = null;
let syncBusy = false;

function syncEl(id) { return document.getElementById(id); }

function fmtSyncWhen(ts) {
  if (!ts) return 'esta sesión aún no';
  const min = Math.floor((Date.now() - Date.parse(ts)) / 60000);
  if (Number.isNaN(min)) return '—';
  if (min < 1) return 'ahora mismo';
  if (min < 60) return 'hace ' + min + ' min';
  const h = Math.floor(min / 60);
  if (h < 24) return 'hace ' + h + ' h';
  return new Date(ts).toLocaleDateString('es-ES');
}

function renderSync() {
  const st = syncEl('sync-status');
  if (!st) return;
  if (syncHandle) st.textContent = 'Archivo: ' + syncFileName + ' · última sincronización: ' + fmtSyncWhen(syncLast) + '.';
  else st.textContent = 'Sin configurar. Elige un archivo dentro de una carpeta que ya sincronizas.';
  const now = syncEl('sync-now'); if (now) now.hidden = !syncHandle;
  const off = syncEl('sync-off'); if (off) off.hidden = !syncHandle;
}

function syncFlash(msg) { const st = syncEl('sync-status'); if (st) st.textContent = msg; setTimeout(renderSync, 2500); }

async function initSync() {
  if (!syncSupported()) {
    const un = syncEl('sync-unsupported'); if (un) un.hidden = false;
    const c = syncEl('sync-controls'); if (c) c.hidden = true;
    return;
  }
  try {
    const h = await getMeta('syncHandle');
    const last = await getMeta('syncLast');
    if (h) { syncHandle = h; syncFileName = h.name || 'agenda-sync.json'; syncLast = last || null; }
    renderSync();
    if (syncHandle && await ensurePermission(syncHandle, false)) syncNow({ silent: true });
  } catch (e) { console.warn('sync init:', e); }
}

function scheduleSync(delay) {
  if (!syncHandle || syncBusy) return;
  clearTimeout(syncTimer);
  syncTimer = setTimeout(() => syncNow({ silent: true }), delay == null ? 2000 : delay);
}

async function syncNow(opts) {
  opts = opts || {};
  if (!syncHandle || syncBusy) return;
  if (inputFocused()) { scheduleSync(3000); return; }
  syncBusy = true;
  clearTimeout(syncTimer);
  try {
    const ok = await ensurePermission(syncHandle, !opts.silent);
    if (!ok) { syncFlash('Permiso pendiente: pulsa «Sincronizar ahora» y autoriza.'); return; }
    const run = async () => {
      await flushSave();
      const local = { days: await allDays(), tombstones: await allTombstones() };
      let remote = null;
      let readError = null;
      try { remote = await readSyncFile(syncHandle); }
      catch (e) { readError = e; }
      if (readError) {
        if (opts.silent) { syncFlash('No se pudo leer el archivo de sincronización; no se escribió nada.'); return; }
        if (!confirm('No se pudo leer el archivo de sincronización (' + readError.message + ').\n\n¿Sobrescribirlo con los datos de este dispositivo?')) return;
        remote = null;
      }
      const merged = mergeData(local, remote || { days: [], tombstones: {} });
      if (merged.changedLocal) {
        await replaceDays(merged.days);
        await replaceTombstones(merged.tombstones);
        if (day) await showDay(cur);
        if (view === 'month') renderCal();
        notifyChange();
      }
      if (merged.changedRemote || !remote) {
        await writeSyncFile(syncHandle, makeRemote(merged.days, merged.tombstones));
      }
      syncLast = new Date().toISOString();
      await putMeta('syncLast', syncLast);
      renderSync();
      syncFlash(merged.changedLocal ? 'Sincronizado · cambios traídos' : 'Sincronizado · sin cambios');
    };
    if (navigator.locks && navigator.locks.request) await navigator.locks.request('agenda-sync', run);
    else await run();
  } catch (e) {
    syncFlash('Error de sincronización: ' + ((e && e.message) || e));
  } finally {
    syncBusy = false;
  }
}

async function chooseSync() {
  try {
    const handle = await pickSyncFile();
    if (!handle) return;
    if (!(await ensurePermission(handle, true))) { syncFlash('Permiso denegado por el navegador.'); return; }
    syncHandle = handle;
    syncFileName = handle.name || 'agenda-sync.json';
    await putMeta('syncHandle', handle);
    renderSync();
    await syncNow({ silent: false });
  } catch (e) {
    if (e && e.name === 'AbortError') return;
    syncFlash('No se pudo configurar: ' + ((e && e.message) || e));
  }
}

async function forgetSync() {
  if (!confirm('¿Desconectar la sincronización?\n\nLos datos se quedan en este dispositivo y en el archivo. Podrás volver a conectarlo cuando quieras.')) return;
  syncHandle = null; syncFileName = ''; syncLast = null;
  await deleteMeta('syncHandle'); await deleteMeta('syncLast');
  renderSync();
}

const MAX_BACKUPS = 10;

async function makeBackup() {
  const days = await allDays();
  if (!days.length) return null;
  const ts = Date.now();
  await putBackup(ts, days);
  const list = await allBackups();
  for (const b of list.slice(MAX_BACKUPS)) await deleteBackup(b.ts);
  return ts;
}

async function maybeAutoBackup() {
  const days = await allDays();
  if (!days.length) return;
  const list = await allBackups();
  const last = list[0];
  if (last && new Date(last.ts).toISOString().slice(0, 10) === todayISO()) return;
  await makeBackup();
}

function fmtTs(ts) {
  return new Date(ts).toLocaleString('es-ES', {
    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit'
  });
}

async function renderBackups() {
  const box = $('#bk-list');
  if (!box) return;
  const list = await allBackups();
  if (!list.length) { box.innerHTML = '<p class="muted">Aún no hay copias.</p>'; return; }
  box.innerHTML = '';
  for (const b of list) {
    const nd = (b.data || []).length;
    const row = document.createElement('div');
    row.className = 'bk-row';
    const span = document.createElement('span');
    span.textContent = fmtTs(b.ts) + ' · ' + nd + (nd === 1 ? ' día' : ' días');
    const rb = document.createElement('button');
    rb.textContent = 'Restaurar'; rb.className = 'linkish';
    rb.onclick = () => restoreBackup(b.ts);
    const db2 = document.createElement('button');
    db2.textContent = 'Eliminar'; db2.className = 'linkish';
    db2.onclick = async () => { if (confirm('¿Eliminar esta copia?')) { await deleteBackup(b.ts); renderBackups(); } };
    row.append(span, rb, db2);
    box.appendChild(row);
  }
}

async function restoreBackup(ts) {
  const list = await allBackups();
  const b = list.find((x) => x.ts === ts);
  if (!b) return;
  if (!confirm('¿Restaurar esta copia? Se reemplazará el contenido actual. (Antes se guarda una copia del estado actual.)')) return;
  await makeBackup();
  await replaceDays(b.data || []);
  notifyChange();
  scheduleSync();
  alert('Copia restaurada.');
  await showDay(cur);
  await renderBackups();
}

function showToast(msg, onUndo) {
  const t = $('#toast');
  if (!t) return;
  $('#toast-txt').textContent = msg;
  const b = $('#toast-undo');
  b.hidden = !onUndo;
  b.onclick = () => { if (onUndo) onUndo(); hideToast(); };
  t.hidden = false;
  clearTimeout(showToast._t);
  showToast._t = setTimeout(hideToast, 6000);
}
function hideToast() { const t = $('#toast'); if (t) t.hidden = true; }

async function requestPersist() {
  try { if (navigator.storage && navigator.storage.persist) await navigator.storage.persist(); }
  catch { /* opcional: si el navegador no lo concede, seguimos con almacenamiento normal */ }
}

function daysSince(isoStr) {
  if (!isoStr) return null;
  const d = Date.parse(isoStr);
  if (Number.isNaN(d)) return null;
  return Math.floor((Date.now() - d) / 86400000);
}

function renderCopia() {
  const el = $('#copia-dias');
  if (!el) return;
  const n = daysSince(funnel.lastExport);
  el.textContent = n === null ? 'nunca' : (n === 0 ? 'hoy' : 'hace ' + n + ' d');
  const b = $('#btn-copia');
  if (b) b.classList.toggle('warn', n === null || n > 14);
}

function touch(d) {
  if (!d.id) d.id = (crypto.randomUUID ? crypto.randomUUID() : 'id-' + Date.now() + '-' + Math.random().toString(16).slice(2));
  d.updatedAt = new Date().toISOString();
  return d;
}

function maybeOnboard() {
  if (funnel.onboarded) return;
  const d = $('#onboarding');
  if (!d) return;
  if (typeof d.showModal === 'function') d.showModal(); else d.setAttribute('open', '');
  const go = $('#onboard-go');
  if (go) go.onclick = () => { funnel.onboarded = true; saveFunnel(); setTimeout(() => { const n = $('#notas'); if (n) n.focus(); }, 50); };
}

function renderPuesta() {
  const el = $('#puesta');
  if (!el) return;
  const steps = ['firstEntry', 'installed', 'exported'];
  const done = steps.filter(s => funnel[s]).length;
  const p = $('#puesta-prog'); if (p) p.textContent = done + '/3';
  el.querySelectorAll('.checklist li').forEach(li => {
    const s = li.dataset.step;
    li.classList.toggle('done', !!funnel[s]);
    const t = li.querySelector('.tick'); if (t) t.textContent = funnel[s] ? '●' : '○';
  });
  const pi = $('#puesta-install'); if (pi) pi.hidden = !!funnel.installed || !deferredPrompt;
  el.hidden = !!funnel.hidden;
}

function registerSW() {
  if (!('serviceWorker' in navigator)) return;
  const hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.register('./sw.js').then((reg) => {
    if (hadController && reg.waiting) showUpdate();
    reg.addEventListener('updatefound', () => {
      const nw = reg.installing;
      if (!nw) return;
      nw.addEventListener('statechange', () => {
        if (nw.state === 'installed' && hadController) showUpdate();
      });
    });
  }).catch(() => { /* sin SW: la app sigue funcionando */ });
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (hadController) showUpdate(); });
}

function showUpdate() {
  const b = $('#update-banner');
  if (b) b.hidden = false;
}

function applySettings() {
  document.documentElement.dataset.tema = settings.dark ? 'oscuro' : 'claro';
}

function wire() {
  $('#prev').onclick = () => go(addDays(cur, -1));
  $('#next').onclick = () => go(addDays(cur, 1));
  $('#btn-mes').onclick = () => setView('month');
  $('#btn-buscar').onclick = () => setView('search');
  $('#btn-cfg').onclick = () => setView('cfg');
  $('#btn-hoy-arriba').onclick = () => go(new Date());

  $('#add-tarea').onclick = addTarea;
  $('#add-cita').onclick = addCita;
  for (const id of ['notas', 'ideas', 'diario']) {
    $('#' + id).addEventListener('input', scheduleSave);
    $('#' + id).addEventListener('blur', () => { flushSave(); if (pendingRemote) remoteRefresh(); });
  }

  $('#q').addEventListener('input', runSearch);

  $('#exp-json').onclick = exportJSON;
  $('#exp-md').onclick = () => exportText('md');
  $('#exp-org').onclick = () => exportText('org');
  $('#exp-ics').onclick = exportICS;
  $('#exp-enc').onclick = exportEncrypted;
  $('#imp-json').onchange = importFile;
  const im = $('#imp-merge'); if (im) im.onclick = () => { const d = $('#imp-dlg'); if (d && d.close) d.close(); doImport('merge'); };
  const ir = $('#imp-replace'); if (ir) ir.onclick = () => { const d = $('#imp-dlg'); if (d && d.close) d.close(); doImport('replace'); };
  const ic = $('#imp-cancel'); if (ic) ic.onclick = () => { const d = $('#imp-dlg'); if (d && d.close) d.close(); pendingImport = null; };
  const idg = $('#imp-dlg'); if (idg) idg.addEventListener('cancel', () => { pendingImport = null; });
  $('#del-all').onclick = deleteAll;
  const px = $('#puesta-x'); if (px) px.onclick = () => { funnel.hidden = true; saveFunnel(); renderPuesta(); };
  const pe = $('#puesta-export'); if (pe) pe.onclick = exportJSON;
  const bkn = $('#bk-now'); if (bkn) bkn.onclick = async () => { await makeBackup(); await renderBackups(); flash('Copia creada'); };
  $('#set-dark').onchange = (e) => { settings.dark = e.target.checked; saveSettings(); applySettings(); };
  $('#set-firstday').onchange = (e) => { settings.firstDay = Number(e.target.value); saveSettings(); };
  const sn = $('#set-notify'); if (sn) sn.onchange = onNotifyToggle;
  const sCh = $('#sync-choose'); if (sCh) sCh.onclick = chooseSync;
  const sNow = $('#sync-now'); if (sNow) sNow.onclick = () => syncNow({ silent: false });
  const sOff = $('#sync-off'); if (sOff) sOff.onclick = forgetSync;

  $('#btn-acerca').onclick = openAcerca;
  $('#btn-acerca-2').onclick = openAcerca;
  $('#btn-acerca-3').onclick = () => openAcerca('h-registros');
  $('#btn-copia').onclick = exportJSON;
  $('#btn-share').onclick = share;
  wireInstall();
  initFooter();
  const ur = $('#update-reload'); if (ur) ur.onclick = () => location.reload();

  document.addEventListener('keydown', (e) => {
    if (/^(INPUT|TEXTAREA)$/.test(e.target.tagName)) return;
    if (e.key === 'ArrowLeft') go(addDays(cur, -1));
    else if (e.key === 'ArrowRight') go(addDays(cur, 1));
    else if (e.key === 't') go(new Date());
    else if (e.key === '/') { e.preventDefault(); setView('search'); $('#q').focus(); }
  });
}

function setView(v) {
  view = v;
  $('#vista-dia').hidden = v !== 'day';
  $('#vista-mes').hidden = v !== 'month';
  $('#vista-busq').hidden = v !== 'search';
  $('#vista-cfg').hidden = v !== 'cfg';
  if (v === 'month') renderCal();
  if (v === 'search') $('#q').focus();
  if (v === 'cfg') { syncCfg(); renderBackups(); }
}

async function go(d) {
  await flushSave();
  cur = d;
  setView('day');
  showDay(cur);
}

async function showDay(d) {
  day = await getDay(iso(d));
  dirty = false;
  const f = fmtLong(d);
  $('#fecha').textContent = f.charAt(0).toUpperCase() + f.slice(1);
  renderDay();
}

function renderDay() {
  renderList('#tareas', day.tasks, (t) => t.text, true);
  renderList('#citas', day.citas, (c) => (c.h ? c.h + '  ' : '') + c.t + (c.remind != null ? '  · ⏰ ' + c.remind + '′' : ''), false);
  $('#notas').value = day.notas || '';
  $('#ideas').value = day.ideas || '';
  $('#diario').value = day.diario || '';
}

function renderList(sel, arr, label, checkable) {
  const ul = $(sel);
  ul.innerHTML = '';
  (arr || []).forEach((item, i) => {
    const li = document.createElement('li');
    if (checkable) {
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = !!item.done;
      cb.onchange = async () => { item.done = cb.checked; await saveDay(); };
      li.appendChild(cb);
    }
    const span = document.createElement('span');
    span.textContent = label(item);
    if (checkable && item.done) span.classList.add('done');
    li.appendChild(span);
    const del = document.createElement('button');
    del.textContent = '×';
    del.title = 'Eliminar';
    del.onclick = async () => {
      const [item] = arr.splice(i, 1);
      await saveDay();
      renderDay();
      showToast('Eliminado', async () => { arr.splice(i, 0, item); await saveDay(); renderDay(); });
    };
    li.appendChild(del);
    ul.appendChild(li);
  });
}

async function addTarea() {
  const v = (prompt('Nueva tarea') || '').trim();
  if (!v) return;
  day.tasks.push({ text: v, done: false });
  await saveDay(); renderDay(); markStep('firstEntry'); flash('Guardado localmente');
}
async function addCita() {
  const h = (prompt('Hora (HH:MM), opcional') || '').trim();
  const t = (prompt('Cita') || '').trim();
  if (!t) return;
  let remind = null;
  if (settings.notify && /^\d{2}:\d{2}$/.test(h)) {
    const r = prompt('¿Avisar antes? Minutos (0 = a la hora, vacío = sin aviso)', '10');
    if (r !== null && r.trim() !== '') { const n = parseInt(r, 10); if (!Number.isNaN(n) && n >= 0) remind = n; }
  }
  day.citas.push({ h, t, remind });
  await saveDay(); renderDay(); markStep('firstEntry'); flash('Guardado localmente');
  checkReminders();
}

async function exportJSON() {
  download('agenda-' + todayISO() + '.json', toJSON(await allDays()), 'application/json;charset=utf-8');
  markStep('exported');
  funnel.lastExport = new Date().toISOString(); saveFunnel(); renderCopia();
}
async function exportText(kind) {
  const days = await allDays();
  if (kind === 'md') download('agenda-' + todayISO() + '.md', toMarkdown(days), 'text/markdown;charset=utf-8');
  else download('agenda-' + todayISO() + '.org', toOrg(days), 'text/plain;charset=utf-8');
  markStep('exported');
  funnel.lastExport = new Date().toISOString(); saveFunnel(); renderCopia();
}
async function exportICS() {
  download('agenda-' + todayISO() + '.ics', toICS(await allDays()), 'text/calendar;charset=utf-8');
  markStep('exported');
  funnel.lastExport = new Date().toISOString(); saveFunnel(); renderCopia();
}
async function exportEncrypted() {
  const p1 = prompt('Contraseña para cifrar la copia (no se guarda en ningún sitio):');
  if (!p1) return;
  const p2 = prompt('Repite la contraseña:');
  if (p1 !== p2) { alert('Las contraseñas no coinciden.'); return; }
  try {
    const env = await encryptText(toJSON(await allDays()), p1);
    download('agenda-' + todayISO() + '.agenda.enc', env, 'application/json;charset=utf-8');
    markStep('exported');
    funnel.lastExport = new Date().toISOString(); saveFunnel(); renderCopia();
  } catch (e) {
    alert('No se pudo cifrar: ' + e.message);
  }
}

let saveTimer = null;
let dirty = false;
function scheduleSave() {
  dirty = true;
  clearTimeout(saveTimer);
  const st = $('#estado'); if (st) st.textContent = 'Guardando…';
  saveTimer = setTimeout(flushSave, 400);
}
async function flushSave() {
  clearTimeout(saveTimer); saveTimer = null;
  if (!dirty || !day) return;
  dirty = false;
  const target = day;
  target.notas = $('#notas').value;
  target.ideas = $('#ideas').value;
  target.diario = $('#diario').value;
  await saveDay(target);
  if (target.notas || target.ideas || target.diario) markStep('firstEntry');
  flash('Guardado localmente');
}

function flash(msg) { const el = $('#estado'); if (el) el.textContent = msg; }

async function renderCal() {
  if (calY === undefined) { calY = cur.getFullYear(); calM = cur.getMonth(); }
  const keys = new Set(await allKeys());
  renderMonth($('#vista-mes'), {
    y: calY, m: calM, firstDay: settings.firstDay,
    marks: keys, selected: iso(cur), today: todayISO()
  }, (date, nav) => {
    if (nav === 'prev') { calM--; if (calM < 0) { calM = 11; calY--; } renderCal(); }
    else if (nav === 'next') { calM++; if (calM > 11) { calM = 0; calY++; } renderCal(); }
    else if (date) { calY = fromISO(date).getFullYear(); calM = fromISO(date).getMonth(); go(fromISO(date)); }
  });
}

async function runSearch() {
  const q = $('#q').value;
  if (!q.trim()) { $('#res').innerHTML = ''; return; }
  const hits = searchAll(await allDays(), q);
  if (!hits.length) { $('#res').innerHTML = '<p class="muted">Sin resultados.</p>'; return; }
  $('#res').innerHTML = hits.map(h =>
    '<div class="hit"><a href="#" data-go="' + h.date + '">' + h.date + '</a>' +
    h.found.map(f => '<div class="muted">' + f.tipo + ': ' + escapeHtml(f.texto) + '</div>').join('') +
    '</div>'
  ).join('');
  $('#res').querySelectorAll('[data-go]').forEach(a => {
    a.onclick = (e) => { e.preventDefault(); go(fromISO(a.dataset.go)); };
  });
}

function syncCfg() {
  $('#set-dark').checked = settings.dark;
  $('#set-firstday').value = String(settings.firstDay);
  const n = $('#set-notify'); if (n) n.checked = !!settings.notify;
}

let pendingImport = null;

async function importFile(e) {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  try {
    let text = await file.text();
    if (isEncrypted(text)) {
      const pass = prompt('Este fichero está cifrado. Escribe la contraseña:');
      if (pass === null) return;
      text = await decryptText(text, pass);
    }
    const days = parseAuto(text, file.name);
    if (!days.length) throw new Error('no contiene días válidos');
    pendingImport = days;
    const info = $('#imp-info');
    if (info) info.textContent = 'El archivo tiene ' + days.length + (days.length === 1 ? ' día' : ' días') + '. ¿Cómo quieres aplicarlo?';
    const dlg = $('#imp-dlg');
    if (dlg && typeof dlg.showModal === 'function') dlg.showModal();
    else await doImport('merge');
  } catch (err) {
    alert('No se pudo importar: ' + err.message);
  }
}

async function doImport(mode) {
  const days = pendingImport || [];
  if (!days.length) return;
  await makeBackup();
  if (mode === 'replace') {
    for (const imp of days) await putDay(touch(Object.assign(emptyDay(imp.date), imp)));
  } else {
    for (const imp of days) {
      const ex = await getDay(imp.date);
      const tasks = (ex.tasks || []).slice();
      const seenT = new Set(tasks.map((t) => (t.text || '') + '|' + !!t.done));
      for (const t of (imp.tasks || [])) if (!seenT.has((t.text || '') + '|' + !!t.done)) tasks.push(t);
      const citas = (ex.citas || []).slice();
      const seenC = new Set(citas.map((c) => (c.h || '') + '|' + c.t));
      for (const c of (imp.citas || [])) if (!seenC.has((c.h || '') + '|' + c.t)) citas.push(c);
      const merged = Object.assign({}, ex, {
        tasks, citas,
        notas: ex.notas || imp.notas, ideas: ex.ideas || imp.ideas, diario: ex.diario || imp.diario
      });
      await putDay(touch(merged));
    }
  }
  notifyChange();
  await showDay(cur);
  flash('Importados ' + days.length + ' días (' + (mode === 'replace' ? 'reemplazando' : 'fusionando') + ')');
  scheduleSync();
  pendingImport = null;
}

async function deleteAll() {
  if (!confirm('¿Seguro que quieres borrar todos los datos de esta agenda?\n\nEsta acción no puede deshacerse.')) return;
  await makeBackup();          // guarda una copia antes de borrar (recuperable)
  const keys = await allKeys();
  for (const k of keys) await putTombstone(k);   // que el borrado se propague en la sincronización
  await clearAll();
  dirty = false;
  notifyChange();
  alert('Datos borrados. (Hay una copia en Configuración → Copias de seguridad.)');
  go(new Date());
}

function wireInstall() {
  const btn = $('#btn-install');
  const pbtn = $('#puesta-install');
  const trigger = async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    try { const c = await deferredPrompt.userChoice; if (c && c.outcome === 'accepted') markStep('installed'); } catch { /* sin acción */ }
    deferredPrompt = null;
    if (btn) btn.hidden = true;
    renderPuesta();
  };
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    if (btn) btn.hidden = false;
    renderPuesta();
  });
  window.addEventListener('appinstalled', () => { markStep('installed'); if (btn) btn.hidden = true; });
  if (btn) btn.onclick = trigger;
  if (pbtn) pbtn.onclick = trigger;
  if (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) markStep('installed');
}

function openAcerca(anchor) {
  const d = $('#acerca');
  if (typeof d.showModal === 'function') d.showModal();
  else d.setAttribute('open', '');
  if (typeof anchor === 'string') {
    const el = document.getElementById(anchor);
    if (el) setTimeout(() => el.scrollIntoView({ block: 'start' }), 30);
  }
}

function initFooter() {
  $('#ver-num').textContent = VERSION;
  $('#ver-lic').textContent = 'AGPL-3.0';
  const av = $('#acerca-ver'); if (av) av.textContent = 'Versión ' + VERSION;
  const l2 = $('#lic-2'); if (l2) l2.textContent = LICENSE;
  const rl = $('#repo-link'); if (rl) rl.href = REPO_URL;
  document.querySelectorAll('a.kofi, #acerca a[href*="ko-fi"]').forEach(a => { a.href = KOFI_URL; });
}

async function share() {
  const data = {
    title: 'Agenda',
    text: 'Una agenda personal que no envía tus datos a ningún servidor: todo se queda en tu navegador.',
    url: APP_URL
  };
  if (navigator.share) {
    try { await navigator.share(data); return; }
    catch (e) { if (e && e.name === 'AbortError') return; }
  }
  try {
    await navigator.clipboard.writeText(APP_URL);
    flash('Enlace copiado al portapapeles');
  } catch {
    prompt('Copia este enlace para compartir:', APP_URL);
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

init();
