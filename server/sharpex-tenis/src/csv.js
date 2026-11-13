// Lector/escritor CSV mínimo (soporta comillas y comas dentro de campos).

// Cada campo se corta de una vez con slice. Antes se armaba letra a letra (field += c), y con los 60 MB del histórico
// entrenar llegaba a 730 MB de memoria: V8 guarda esas sumas como una cadena de trozos hasta que las aplana.
const COMMA = 44, LF = 10, CR = 13;

export function parseCsv(text) {
  const rows = [];
  const n = text.length;
  let row = [];
  let i = 0;
  for (;;) {
    let field;
    if (text.charCodeAt(i) === 34) {
      // Entre comillas: hasta la que cierra ("" es una comilla dentro del campo)
      field = '';
      let j = i + 1;
      for (;;) {
        const q = text.indexOf('"', j);
        if (q === -1) { field += text.slice(j); i = n; break; }
        if (text.charCodeAt(q + 1) === 34) { field += text.slice(j, q + 1); j = q + 2; continue; }
        field += text.slice(j, q);
        i = q + 1;
        break;
      }
      while (i < n && ![COMMA, LF, CR].includes(text.charCodeAt(i))) i++; // lo que sobre tras la comilla
    } else {
      let j = i;
      for (let c = text.charCodeAt(j); j < n && c !== COMMA && c !== LF && c !== CR; c = text.charCodeAt(++j));
      field = text.slice(i, j);
      i = j;
    }
    row.push(field);
    if (text.charCodeAt(i) === COMMA) { i++; continue; }
    // Fin de línea (\n, \r\n o \r) o del texto
    if (text.charCodeAt(i) === CR && text.charCodeAt(i + 1) === LF) i++;
    i++;
    if (row.length > 1 || row[0] !== '') rows.push(row);
    row = [];
    if (i >= n) break;
  }
  if (!rows.length) return [];
  const header = rows[0].map((h) => h.trim());
  return rows.slice(1).map((r) => Object.fromEntries(header.map((h, i) => [h, (r[i] ?? '').trim()])));
}

export function toCsv(objects, columns) {
  const cols = columns ?? Object.keys(objects[0] ?? {});
  const esc = (v) => {
    const s = v === undefined || v === null ? '' : String(v);
    return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  return [cols.join(','), ...objects.map((o) => cols.map((c) => esc(o[c])).join(','))].join('\n') + '\n';
}
