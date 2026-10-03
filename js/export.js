import { fromISO } from './date.js';

const DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];

function title(day) {
  const d = fromISO(day.date);
  return day.date + ' ' + DIAS[d.getDay()].charAt(0).toUpperCase() + DIAS[d.getDay()].slice(1);
}

export function toJSON(days) {
  return JSON.stringify({ version: 1, schemaVersion: 2, app: 'agenda-local', exported: new Date().toISOString(), days }, null, 2);
}

export function toMarkdown(days) {
  const out = [];
  for (const day of days) {
    out.push('# ' + title(day));
    if (day.tasks && day.tasks.length) {
      out.push('', '## Tareas');
      for (const t of day.tasks) out.push('- [' + (t.done ? 'x' : ' ') + '] ' + t.text);
    }
    if (day.citas && day.citas.length) {
      out.push('', '## Agenda');
      for (const c of day.citas) out.push('- ' + (c.h ? c.h + ' ' : '') + c.t);
    }
    if (day.notas) out.push('', '## Notas', '', day.notas);
    if (day.ideas) out.push('', '## Ideas', '', day.ideas);
    if (day.diario) out.push('', '## Diario', '', day.diario);
    out.push('');
  }
  return out.join('\n');
}

export function toOrg(days) {
  const out = [];
  for (const day of days) {
    out.push('* ' + title(day));
    out.push('');
    out.push('** Tareas');
    for (const t of (day.tasks || [])) out.push('*** ' + (t.done ? 'DONE' : 'TODO') + ' ' + t.text);
    out.push('');
    out.push('** Agenda');
    for (const c of (day.citas || [])) out.push((c.h ? c.h + ' ' : '') + c.t);
    out.push('');
    out.push('** Notas');
    out.push(day.notas || '');
    out.push('');
    out.push('** Ideas');
    out.push(day.ideas || '');
    out.push('');
    out.push('** Diario');
    out.push(day.diario || '');
    out.push('');
  }
  return out.join('\n');
}

function pad2(n) { return String(n).padStart(2, '0'); }
function icsDate(dateStr) { return dateStr.replace(/-/g, ''); }
function icsStamp() {
  const d = new Date();
  return d.getUTCFullYear() + pad2(d.getUTCMonth() + 1) + pad2(d.getUTCDate()) +
    'T' + pad2(d.getUTCHours()) + pad2(d.getUTCMinutes()) + pad2(d.getUTCSeconds()) + 'Z';
}
function icsEsc(s) {
  return String(s).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
}

// Exporta a iCalendar (.ics): citas → VEVENT, tareas → VTODO (con DUE y estado).
// Sin zona horaria (hora "flotante") para que cada dispositivo use la suya.
export function toICS(days) {
  const L = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//agenda-local//ES//',
    'CALSCALE:GREGORIAN', 'METHOD:PUBLISH'];
  const stamp = icsStamp();
  const host = 'agenda.pruebapublica.com';
  for (const day of days) {
    if (!day || !day.date) continue;
    const d8 = icsDate(day.date);
    const base = day.id || day.date;
    (day.citas || []).forEach((c, i) => {
      if (!c || typeof c.t !== 'string' || !c.t) return;
      L.push('BEGIN:VEVENT', 'UID:' + base + '-c' + i + '@' + host, 'DTSTAMP:' + stamp);
      if (c.h && /^\d{2}:\d{2}$/.test(c.h)) L.push('DTSTART:' + d8 + 'T' + c.h.replace(':', '') + '00');
      else L.push('DTSTART;VALUE=DATE:' + d8);
      L.push('SUMMARY:' + icsEsc(c.t), 'END:VEVENT');
    });
    (day.tasks || []).forEach((t, i) => {
      if (!t || typeof t.text !== 'string' || !t.text) return;
      L.push('BEGIN:VTODO', 'UID:' + base + '-t' + i + '@' + host, 'DTSTAMP:' + stamp,
        'DUE;VALUE=DATE:' + d8, 'SUMMARY:' + icsEsc(t.text),
        'STATUS:' + (t.done ? 'COMPLETED' : 'NEEDS-ACTION'));
      if (t.done) L.push('COMPLETED:' + stamp);
      L.push('END:VTODO');
    });
  }
  L.push('END:VCALENDAR');
  return L.join('\r\n') + '\r\n';
}

export function download(name, text, type) {
  const blob = new Blob([text], { type: type || 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

// Saneado estricto: solo se aceptan tipos esperados (evita inyección de HTML y basura).
function cleanDay(d) {
  const out = { date: d.date, tasks: [], citas: [], notas: '', ideas: '', diario: '' };
  if (Array.isArray(d.tasks)) {
    for (const t of d.tasks) {
      if (t && typeof t.text === 'string') out.tasks.push({ text: t.text, done: !!t.done });
    }
  }
  if (Array.isArray(d.citas)) {
    for (const c of d.citas) {
      if (c && typeof c.t === 'string') out.citas.push({ h: typeof c.h === 'string' ? c.h : '', t: c.t });
    }
  }
  for (const k of ['notas', 'ideas', 'diario']) if (typeof d[k] === 'string') out[k] = d[k];
  // campos de cara a sincronización futura (se conservan si vienen)
  for (const k of ['id', 'updatedAt', 'deletedAt']) if (typeof d[k] === 'string') out[k] = d[k];
  return out;
}

export function parseImport(text) {
  let data;
  try { data = JSON.parse(text); }
  catch { throw new Error('no es JSON válido'); }
  let days;
  if (Array.isArray(data)) days = data;
  else if (data && Array.isArray(data.days)) days = data.days;
  else throw new Error('formato no reconocido: se espera {days:[...]} o [...]');
  const sv = (data && data.schemaVersion) || 1;
  if (sv > 2) throw new Error('versión de esquema no soportada: ' + sv);
  const out = [];
  for (const d of days) {
    if (!d || typeof d.date !== 'string' || !ISO_DATE.test(d.date)) continue;
    out.push(cleanDay(d));
  }
  if (!out.length) throw new Error('no contiene días válidos');
  return out;
}

const SEC = { Tareas: 'tasks', Agenda: 'citas', Notas: 'notas', Ideas: 'ideas', Diario: 'diario' };

function newDay(date) { return { date, tasks: [], citas: [], notas: '', ideas: '', diario: '' }; }

// --- Org (round-trip con nuestro export) ---
export function parseOrg(text) {
  const days = [];
  let day = null, section = null, buf = [];
  const flush = () => { if (day && section && section !== 'tasks' && section !== 'citas') day[section] = buf.join('\n').trim(); buf = []; };
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/\s+$/, '');
    let m;
    if ((m = /^\*\s+(\d{4}-\d{2}-\d{2})/.exec(line))) { if (day) { flush(); days.push(day); } day = newDay(m[1]); section = null; continue; }
    if (!day) continue;
    if ((m = /^\*\*\s+(Tareas|Agenda|Notas|Ideas|Diario)\s*$/.exec(line))) { flush(); section = SEC[m[1]]; continue; }
    if ((m = /^\*\*\*\s+(TODO|DONE)\s+(.*)$/.exec(line))) { day.tasks.push({ text: m[2], done: m[1] === 'DONE' }); continue; }
    if (section === 'tasks') continue;
    if (section === 'citas') { const t = line.trim(); if (t) { const hh = /^(\d{2}:\d{2})\s+(.*)$/.exec(t); day.citas.push(hh ? { h: hh[1], t: hh[2] } : { h: '', t }); } continue; }
    buf.push(line);
  }
  if (day) { flush(); days.push(day); }
  return days.map(cleanDay).filter((d) => d.date);
}

// --- Markdown (round-trip con nuestro export) ---
export function parseMarkdown(text) {
  const days = [];
  let day = null, section = null, buf = [];
  const flush = () => { if (day && section && section !== 'tasks' && section !== 'citas') day[section] = buf.join('\n').trim(); buf = []; };
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/\s+$/, '');
    let m;
    if ((m = /^#\s+(\d{4}-\d{2}-\d{2})/.exec(line))) { if (day) { flush(); days.push(day); } day = newDay(m[1]); section = null; continue; }
    if (!day) continue;
    if ((m = /^##\s+(Tareas|Agenda|Notas|Ideas|Diario)\s*$/.exec(line))) { flush(); section = SEC[m[1]]; continue; }
    if (section === 'tasks') { const t = /^-\s+\[( |x|X)\]\s+(.*)$/.exec(line); if (t) day.tasks.push({ text: t[2], done: t[1].toLowerCase() === 'x' }); continue; }
    if (section === 'citas') { const c = /^-\s+(.+)$/.exec(line); if (c) { const t = c[1].trim(); const hh = /^(\d{2}:\d{2})\s+(.*)$/.exec(t); day.citas.push(hh ? { h: hh[1], t: hh[2] } : { h: '', t }); } continue; }
    buf.push(line);
  }
  if (day) { flush(); days.push(day); }
  return days.map(cleanDay).filter((d) => d.date);
}

// --- iCalendar (.ics): VEVENT -> cita, VTODO -> tarea ---
function icsUnesc(s) {
  return s.replace(/\\n/gi, '\n').replace(/\\,/g, ',').replace(/\\;/g, ';').replace(/\\\\/g, '\\');
}
function icsCommit(cur, byDate) {
  const dt = cur.props.DTSTART || cur.props.DUE;
  if (!dt) return;
  const m = /(\d{4})(\d{2})(\d{2})/.exec(dt.value);
  if (!m) return;
  const date = m[1] + '-' + m[2] + '-' + m[3];
  const d = byDate[date] || (byDate[date] = newDay(date));
  const sum = cur.props.SUMMARY ? icsUnesc(cur.props.SUMMARY.value) : '';
  if (!sum) return;
  if (cur.type === 'VTODO') {
    d.tasks.push({ text: sum, done: (cur.props.STATUS || {}).value === 'COMPLETED' });
  } else {
    let h = '';
    const hm = /T(\d{2})(\d{2})/.exec(dt.value);
    if (hm && !dt.allDay) h = hm[1] + ':' + hm[2];
    d.citas.push({ h, t: sum });
  }
}
export function parseICS(text) {
  const folded = text.replace(/\r\n/g, '\n').replace(/\n[ \t]/g, '');
  const byDate = {};
  let cur = null;
  for (const line of folded.split('\n')) {
    if (line === 'BEGIN:VEVENT' || line === 'BEGIN:VTODO') { cur = { type: line.slice(6), props: {} }; continue; }
    if (line === 'END:VEVENT' || line === 'END:VTODO') { if (cur) icsCommit(cur, byDate); cur = null; continue; }
    if (!cur) continue;
    const i = line.indexOf(':');
    if (i < 0) continue;
    const keyPart = line.slice(0, i);
    const value = line.slice(i + 1);
    const key = keyPart.split(';')[0].toUpperCase();
    const allDay = /VALUE=DATE(?!-TIME)/i.test(keyPart) || !/T\d{4}/.test(value);
    if (!(key in cur.props)) cur.props[key] = { value, allDay };
  }
  return Object.values(byDate).map(cleanDay);
}

// Detecta el formato por extensión o por el contenido.
export function parseAuto(text, name) {
  const ext = ((name || '').split('.').pop() || '').toLowerCase();
  if (ext === 'ics' || /^\s*BEGIN:VCALENDAR/i.test(text)) return parseICS(text);
  if (ext === 'org' || /^\*\s+\d{4}-\d{2}-\d{2}/m.test(text)) return parseOrg(text);
  if (ext === 'md' || ext === 'markdown' || /^#\s+\d{4}-\d{2}-\d{2}/m.test(text)) return parseMarkdown(text);
  return parseImport(text);
}
