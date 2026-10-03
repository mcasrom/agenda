import { fromISO } from './date.js';

const DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];

function title(day) {
  const d = fromISO(day.date);
  return day.date + ' ' + DIAS[d.getDay()].charAt(0).toUpperCase() + DIAS[d.getDay()].slice(1);
}

export function toJSON(days) {
  return JSON.stringify({ version: 1, app: 'agenda-local', exported: new Date().toISOString(), days }, null, 2);
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

export function parseImport(text) {
  const data = JSON.parse(text);
  let days = [];
  if (Array.isArray(data)) days = data;
  else if (data && Array.isArray(data.days)) days = data.days;
  else throw new Error('Formato no reconocido: se espera {days:[...]} o [...]');
  return days.filter(d => d && typeof d.date === 'string');
}
