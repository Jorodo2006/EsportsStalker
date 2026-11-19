// Periodos del historial de Mis apuestas: todo, los últimos 7 o 30 días, un año, un mes o entre dos fechas. Se guardan como
// una clave de texto (la del selector: '', 'd7', 'd30', 'y:2026', 'm:2026-11', 'range'). Las fechas de las apuestas son días
// (AAAA-MM-DD), así que basta con compararlas como texto

// 03/11/26, como fmtDate, pero sin pasar por Date: un día suelto se leería como medianoche UTC y en América saldría el anterior
const fmtDay = (s: string) => `${s.slice(8, 10)}/${s.slice(5, 7)}/${s.slice(2, 4)}`;

const shift = (day: string, n: number) => {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

// [desde, hasta], los dos incluidos; null es sin límite. El mes acaba en el 31 aunque tenga menos días: como texto, el 31 de
// febrero queda después de cualquier día de febrero y antes del 1 de marzo
export function periodBounds(key: string, today: string, from = '', to = ''): [string, string] | null {
  if (key === 'd7') return [shift(today, -6), today];
  if (key === 'd30') return [shift(today, -29), today];
  if (/^y:\d{4}$/.test(key)) return [`${key.slice(2)}-01-01`, `${key.slice(2)}-12-31`];
  if (/^m:\d{4}-\d{2}$/.test(key)) return [`${key.slice(2)}-01`, `${key.slice(2)}-31`];
  if (key === 'range' && (from || to)) {
    const a = from || '0000-01-01', b = to || '9999-12-31';
    return a <= b ? [a, b] : [b, a];
  }
  return null;
}

export const inPeriod = (date: string, b: [string, string] | null) => !b || (date >= b[0] && date <= b[1]);

const monthName = (ym: string) => {
  const s = new Date(`${ym}-01T12:00:00Z`).toLocaleDateString('es-ES', { month: 'long', timeZone: 'UTC' });
  return s.charAt(0).toUpperCase() + s.slice(1);
};

// Los años y meses en los que hay apuestas, de lo más nuevo a lo más viejo: es lo que ofrece el selector, para no enseñar
// meses vacíos
export function periodGroups(dates: string[]) {
  const months = [...new Set(dates.map(d => String(d).slice(0, 7)).filter(m => /^\d{4}-\d{2}$/.test(m)))].sort().reverse();
  const years = [...new Set(months.map(m => m.slice(0, 4)))];
  return years.map(year => ({
    year,
    months: months.filter(m => m.startsWith(year)).map(m => ({ key: `m:${m}`, label: `${monthName(m)} ${year}` }))
  }));
}

// Cómo se llama el periodo en el resumen del historial («Noviembre 2026», «Del 03/11/26 al 10/11/26»)
export function periodLabel(key: string, from = '', to = '') {
  if (key === 'd7') return 'Últimos 7 días';
  if (key === 'd30') return 'Últimos 30 días';
  if (/^y:\d{4}$/.test(key)) return `Todo ${key.slice(2)}`;
  if (/^m:\d{4}-\d{2}$/.test(key)) return `${monthName(key.slice(2))} ${key.slice(2, 6)}`;
  if (key === 'range') {
    const [a, b] = from && to && from > to ? [to, from] : [from, to];
    if (a && b) return `Del ${fmtDay(a)} al ${fmtDay(b)}`;
    if (a) return `Desde el ${fmtDay(a)}`;
    if (b) return `Hasta el ${fmtDay(b)}`;
  }
  return '';
}
