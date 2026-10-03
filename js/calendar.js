import { monthMatrix, monthTitle, todayISO, weekdayNames } from './date.js';

export function renderMonth(root, { y, m, firstDay = 1, marks = new Set(), selected, today = todayISO() }, onPick) {
  const weeks = monthMatrix(y, m, firstDay);
  const names = weekdayNames(firstDay);
  let html = '<div class="cal-head"><button data-nav="prev" aria-label="mes anterior">‹</button>' +
    '<strong>' + monthTitle(y, m) + '</strong>' +
    '<button data-nav="next" aria-label="mes siguiente">›</button></div>';
  html += '<table class="cal"><thead><tr>';
  for (const n of names) html += '<th>' + n + '</th>';
  html += '</tr></thead><tbody>';
  for (const week of weeks) {
    html += '<tr>';
    for (const cell of week) {
      const cls = [
        cell.inMonth ? '' : 'out',
        cell.date === today ? 'today' : '',
        cell.date === selected ? 'sel' : '',
        marks.has(cell.date) ? 'has' : ''
      ].filter(Boolean).join(' ');
      html += '<td class="' + cls + '" data-date="' + cell.date + '">' + cell.day + '</td>';
    }
    html += '</tr>';
  }
  html += '</tbody></table>';
  root.innerHTML = html;
  root.querySelectorAll('td[data-date]').forEach(td => {
    td.onclick = () => onPick(td.dataset.date);
  });
  root.querySelectorAll('[data-nav]').forEach(b => {
    b.onclick = () => onPick(null, b.dataset.nav);
  });
}
