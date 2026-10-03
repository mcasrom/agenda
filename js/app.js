import { open, getDay, putDay, allDays, allKeys, clearAll, emptyDay, putBackup, allBackups, deleteBackup, replaceDays } from './db.js';
import { iso, fromISO, addDays, todayISO, fmtLong } from './date.js';
import { renderMonth } from './calendar.js';
import { searchAll } from './search.js';
import { toJSON, toMarkdown, toOrg, toICS, download, parseAuto } from './export.js';
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
  const def = { dark: false, firstDay: 1 };
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

async function saveDay() {
  await withLock(() => putDay(touch(day)));
  notifyChange();
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
  if (bc) bc.onmessage = (e) => { if (e.data && e.data.t === 'data') remoteRefresh(); };
  document.addEventListener('visibilitychange', () => { if (!document.hidden) remoteRefresh(); });
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
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }
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
    $('#' + id).addEventListener('blur', () => { if (pendingRemote) remoteRefresh(); });
  }

  $('#q').addEventListener('input', runSearch);

  $('#exp-json').onclick = exportJSON;
  $('#exp-md').onclick = () => exportText('md');
  $('#exp-org').onclick = () => exportText('org');
  $('#exp-ics').onclick = exportICS;
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

  $('#btn-acerca').onclick = openAcerca;
  $('#btn-acerca-2').onclick = openAcerca;
  $('#btn-acerca-3').onclick = openAcerca;
  $('#btn-copia').onclick = exportJSON;
  $('#btn-share').onclick = share;
  wireInstall();
  initFooter();

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

function go(d) {
  cur = d;
  setView('day');
  showDay(cur);
}

async function showDay(d) {
  day = await getDay(iso(d));
  const f = fmtLong(d);
  $('#fecha').textContent = f.charAt(0).toUpperCase() + f.slice(1);
  renderDay();
}

function renderDay() {
  renderList('#tareas', day.tasks, (t) => t.text, true);
  renderList('#citas', day.citas, (c) => (c.h ? c.h + '  ' : '') + c.t, false);
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
  day.citas.push({ h, t });
  await saveDay(); renderDay(); markStep('firstEntry'); flash('Guardado localmente');
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

let saveTimer = null;
function scheduleSave() {
  clearTimeout(saveTimer);
  const st = $('#estado'); if (st) st.textContent = 'Guardando…';
  saveTimer = setTimeout(async () => {
    day.notas = $('#notas').value;
    day.ideas = $('#ideas').value;
    day.diario = $('#diario').value;
    await saveDay();
    if (day.notas || day.ideas || day.diario) markStep('firstEntry');
    flash('Guardado localmente');
  }, 400);
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
}

let pendingImport = null;

async function importFile(e) {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  try {
    const days = parseAuto(await file.text(), file.name);
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
  pendingImport = null;
}

async function deleteAll() {
  if (!confirm('¿Seguro que quieres borrar todos los datos de esta agenda?\n\nEsta acción no puede deshacerse.')) return;
  await makeBackup();          // guarda una copia antes de borrar (recuperable)
  await clearAll();
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

function openAcerca() {
  const d = $('#acerca');
  if (typeof d.showModal === 'function') d.showModal();
  else d.setAttribute('open', '');
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
