import { open, getDay, putDay, allDays, allKeys, clearAll, emptyDay } from './db.js';
import { iso, fromISO, addDays, todayISO, fmtLong } from './date.js';
import { renderMonth } from './calendar.js';
import { searchAll } from './search.js';
import { toJSON, toMarkdown, toOrg, download, parseImport } from './export.js';
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
  const def = { onboarded: false, firstEntry: false, installed: false, exported: false, hidden: false };
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

async function init() {
  db = await open();
  applySettings();
  wire();
  await showDay(cur);
  renderPuesta();
  maybeOnboard();
  registerSW();
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
  }

  $('#q').addEventListener('input', runSearch);

  $('#exp-json').onclick = exportJSON;
  $('#exp-md').onclick = () => exportText('md');
  $('#exp-org').onclick = () => exportText('org');
  $('#imp-json').onchange = importFile;
  $('#del-all').onclick = deleteAll;
  const px = $('#puesta-x'); if (px) px.onclick = () => { funnel.hidden = true; saveFunnel(); renderPuesta(); };
  const pe = $('#puesta-export'); if (pe) pe.onclick = exportJSON;
  $('#set-dark').onchange = (e) => { settings.dark = e.target.checked; saveSettings(); applySettings(); };
  $('#set-firstday').onchange = (e) => { settings.firstDay = Number(e.target.value); saveSettings(); };

  $('#btn-acerca').onclick = openAcerca;
  $('#btn-acerca-2').onclick = openAcerca;
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
  if (v === 'cfg') syncCfg();
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
      cb.onchange = async () => { item.done = cb.checked; await putDay(day); };
      li.appendChild(cb);
    }
    const span = document.createElement('span');
    span.textContent = label(item);
    if (checkable && item.done) span.classList.add('done');
    li.appendChild(span);
    const del = document.createElement('button');
    del.textContent = '×';
    del.title = 'Eliminar';
    del.onclick = async () => { arr.splice(i, 1); await putDay(day); renderDay(); };
    li.appendChild(del);
    ul.appendChild(li);
  });
}

async function addTarea() {
  const v = (prompt('Nueva tarea') || '').trim();
  if (!v) return;
  day.tasks.push({ text: v, done: false });
  await putDay(day); renderDay(); markStep('firstEntry'); flash('Guardado localmente');
}
async function addCita() {
  const h = (prompt('Hora (HH:MM), opcional') || '').trim();
  const t = (prompt('Cita') || '').trim();
  if (!t) return;
  day.citas.push({ h, t });
  await putDay(day); renderDay(); markStep('firstEntry'); flash('Guardado localmente');
}

async function exportJSON() {
  download('agenda-' + todayISO() + '.json', toJSON(await allDays()), 'application/json;charset=utf-8');
  markStep('exported');
}
async function exportText(kind) {
  const days = await allDays();
  if (kind === 'md') download('agenda-' + todayISO() + '.md', toMarkdown(days), 'text/markdown;charset=utf-8');
  else download('agenda-' + todayISO() + '.org', toOrg(days), 'text/plain;charset=utf-8');
  markStep('exported');
}

let saveTimer = null;
function scheduleSave() {
  clearTimeout(saveTimer);
  const st = $('#estado'); if (st) st.textContent = 'Guardando…';
  saveTimer = setTimeout(async () => {
    day.notas = $('#notas').value;
    day.ideas = $('#ideas').value;
    day.diario = $('#diario').value;
    await putDay(day);
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

async function importFile(e) {
  const file = e.target.files[0];
  if (!file) return;
  try {
    const days = parseImport(await file.text());
    for (const d of days) {
      const clean = Object.assign(emptyDay(d.date), d);
      await putDay(clean);
    }
    alert('Importados ' + days.length + ' días.');
    await showDay(cur);
  } catch (err) {
    alert('No se pudo importar: ' + err.message);
  }
  e.target.value = '';
}

async function deleteAll() {
  if (!confirm('¿Seguro que quieres borrar todos los datos de esta agenda?\n\nEsta acción no puede deshacerse.')) return;
  await clearAll();
  alert('Datos borrados.');
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
