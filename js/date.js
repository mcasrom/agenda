export function pad(n) { return String(n).padStart(2, '0'); }

export function iso(d) {
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
}

export function fromISO(s) {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function todayISO() { return iso(new Date()); }

export function addDays(d, n) {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

const DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

export function fmtLong(d) {
  return DIAS[d.getDay()] + ' · ' + d.getDate() + ' ' + MESES[d.getMonth()] + ' ' + d.getFullYear();
}

export function fmtShort(d) {
  return pad(d.getDate()) + '/' + pad(d.getMonth() + 1) + '/' + d.getFullYear();
}

export function monthTitle(y, m) {
  return MESES[m].charAt(0).toUpperCase() + MESES[m].slice(1) + ' ' + y;
}

// Rejilla mensual: 6 semanas de fechas ISO. firstDay: 1=lunes, 0=domingo.
export function monthMatrix(y, m, firstDay = 1) {
  const first = new Date(y, m, 1);
  let start = first.getDay() - firstDay;
  if (start < 0) start += 7;
  const cells = [];
  for (let i = 0; i < 42; i++) {
    const d = new Date(y, m, 1 - start + i);
    cells.push({ date: iso(d), inMonth: d.getMonth() === m, day: d.getDate() });
  }
  const weeks = [];
  for (let i = 0; i < 42; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}

export function weekdayNames(firstDay = 1) {
  const base = ['L', 'M', 'X', 'J', 'V', 'S', 'D'];
  return base;
}
