// Exportar e importar apuestas en CSV. Las columnas son las del registro; `legs` va como JSON dentro de la celda
const COLS = ['id', 'date', 'sport', 'league', 'event', 'market', 'selection', 'bookmaker', 'odds', 'stake', 'status', 'cashout', 'notes', 'legs'] as const;

export function toCsv(rows: object[]): string {
  const cell = (v: unknown) => { const t = Array.isArray(v) ? JSON.stringify(v) : String(v ?? ''); return /[",;\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t; };
  return [COLS.join(','), ...rows.map(r => COLS.map(c => cell((r as Record<string, unknown>)[c])).join(','))].join('\n');
}

export function fromCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [], cur = '', q = false;
  const first = text.split('\n')[0];
  const sep = (first.match(/;/g) || []).length > (first.match(/,/g) || []).length ? ';' : ',';
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"' && text[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') q = false;
      else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === sep) { row.push(cur); cur = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cur); cur = '';
      if (row.some(c => c !== '')) rows.push(row);
      row = [];
    } else cur += ch;
  }
  row.push(cur);
  if (row.some(c => c !== '')) rows.push(row);
  const [head, ...body] = rows;
  const keys = (head || []).map(h => h.trim().toLowerCase());
  return body.map(r => Object.fromEntries(keys.map((k, i) => [k, r[i]])));
}
