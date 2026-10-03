import { open, getDay, putDay, allDays, allKeys, clearAll, emptyDay } from './db.js';
import { iso, fromISO, addDays, todayISO, fmtLong } from './date.js';
import { renderMonth } from './calendar.js';
import { searchAll } from './search.js';
import { toJSON, toMarkdown, toOrg, download, parseImport } from './export.js';

const $ = (s) => document.querySelector(s);

let db;
let cur = new Date();
let view = 'day';
let calY, calM;
let day = null;
const settings = loadSettings();

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
  registerSW();
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

  $('#exp-json').onclick = async () => download('agenda-' + todayISO() + '.json', toJSON(await allDays()), 'application/json;charset=utf-8');
  $('#exp-md').onclick = async () => download('agenda-' + todayISO() + '.md', toMarkdown(await allDays()), 'text/markdown;charset=utf-8');
  $('#exp-org').onclick = async () => download('agenda-' + todayISO() + '.org', toOrg(await allDays()), 'text/plain;charset=utf-8');
  $('#imp-json').onchange = importFile;
  $('#del-all').onclick = deleteAll;
  $('#set-dark').onchange = (e) => { settings.dark = e.target.checked; saveSettings(); applySettings(); };
  $('#set-firstday').onchange = (e) => { settings.firstDay = Number(e.target.value); saveSettings(); };

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
  await putDay(day); renderDay(); flash('Guardado localmente');
}
async function addCita() {
  const h = (prompt('Hora (HH:MM), opcional') || '').trim();
  const t = (prompt('Cita') || '').trim();
  if (!t) return;
  day.citas.push({ h, t });
  await putDay(day); renderDay(); flash('Guardado localmente');
}

let saveTimer = null;
function scheduleSave() {
  clearTimeout(saveTimer);
  $('#estado').textContent = 'Guardando…';
  saveTimer = setTimeout(async () => {
    day.notas = $('#notas').value;
    day.ideas = $('#ideas').value;
    day.diario = $('#diario').value;
    await putDay(day);
    flash('Guardado localmente');
  }, 400);
}

function flash(msg) { $('#estado').textContent = msg; }

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

function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

init();
