export function searchAll(days, q) {
  const term = q.trim().toLowerCase();
  if (!term) return [];
  const hits = [];
  for (const day of days) {
    const found = [];
    for (const t of (day.tasks || [])) {
      if (t.text.toLowerCase().includes(term)) found.push({ tipo: 'Tarea', texto: t.text });
    }
    for (const c of (day.citas || [])) {
      if ((c.t || '').toLowerCase().includes(term)) found.push({ tipo: 'Cita', texto: c.t });
    }
    for (const [k, label] of [['notas', 'Nota'], ['ideas', 'Idea'], ['diario', 'Diario']]) {
      const txt = day[k] || '';
      if (txt.toLowerCase().includes(term)) {
        const i = txt.toLowerCase().indexOf(term);
        const frag = txt.slice(Math.max(0, i - 40), i + 60).trim();
        found.push({ tipo: label, texto: frag });
      }
    }
    if (found.length) hits.push({ date: day.date, found });
  }
  hits.sort((a, b) => b.date.localeCompare(a.date));
  return hits;
}
