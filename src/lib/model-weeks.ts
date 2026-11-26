// Resumen semanal del modelo (Acierto del modelo): por cada semana (de lunes a domingo, hora de España), cuántas recomendaciones se
// resolvieron, si acertó lo que decía, qué habría dado a 1 unidad cada una, si acertó más que la casa (Brier), qué mercado fue el
// más rentable y el más preciso, y qué aprendió el reajuste diario de baloncesto (server/services/bets/tuning.js) esa semana
import type { ModelTuningRow, PredictionRow } from './types';

export interface WeekGroup { key: string; n: number; pl: number; roi: number; gain: number | null }
export interface WeekTuning { tries: number; applied: number; from: Partial<Record<'player' | 'team', number>>; to: Partial<Record<'player' | 'team', number>> }
export interface WeekSummary {
  week: string; n: number; decided: number; hit: number; said: number; pl: number; roi: number; clv: number | null;
  // Brier de lo que enseña la app y de la casa sin margen, con las mismas líneas (las que tienen las dos); más bajo, mejor
  brier: { app: number; market: number; n: number } | null;
  best: WeekGroup | null; worst: WeekGroup | null; precise: WeekGroup | null; tuning: WeekTuning | null;
}

// Mínimos para nombrar un mercado: con menos casos el «mejor» de la semana es suerte
export const MIN_GROUP = 10, MIN_PRECISE = 20;

const madridDay = (iso: string) => new Date(iso).toLocaleDateString('en-CA', { timeZone: 'Europe/Madrid' });
// El lunes de la semana de un día (aaaa-mm-dd)
export function mondayOf(day: string) {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}
const profit = (r: PredictionRow) => (r.status === 'won' ? r.price - 1 : r.status === 'lost' ? -1 : 0);
const sq = (p: number, r: PredictionRow) => (p - (r.status === 'won' ? 1 : 0)) ** 2;
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

function brierOf(rows: PredictionRow[]) {
  const xs = rows.filter(r => r.status !== 'void' && r.pMarket != null);
  if (!xs.length) return null;
  return { app: mean(xs.map(r => sq(r.p, r)))!, market: mean(xs.map(r => sq(r.pMarket!, r)))!, n: xs.length };
}

// group: cómo se llama el mercado de una fila (con el deporte delante si se ven todos)
export function weekly(rows: PredictionRow[], tuning: ModelTuningRow[], group: (r: PredictionRow) => string, weeks = 8): WeekSummary[] {
  const byWeek = new Map<string, PredictionRow[]>();
  for (const r of rows) { const w = mondayOf(madridDay(r.start)); byWeek.set(w, [...(byWeek.get(w) ?? []), r]); }
  const tByWeek = new Map<string, ModelTuningRow[]>();
  for (const t of tuning) { const w = mondayOf(t.day); tByWeek.set(w, [...(tByWeek.get(w) ?? []), t]); }
  const keys = [...new Set([...byWeek.keys(), ...tByWeek.keys()])].sort().reverse().slice(0, weeks);
  return keys.map(week => {
    const rs = byWeek.get(week) ?? [];
    const d = rs.filter(r => r.status !== 'void');
    const pl = rs.reduce((s, r) => s + profit(r), 0);
    // Por mercado: beneficio y cuánto mejor que la casa acierta (Brier de la casa menos el de la app; positivo, mejor la app)
    const m = new Map<string, PredictionRow[]>();
    for (const r of rs) { const k = group(r); m.set(k, [...(m.get(k) ?? []), r]); }
    const groups: WeekGroup[] = [...m].map(([key, xs]) => {
      const gpl = xs.reduce((s, r) => s + profit(r), 0);
      const b = brierOf(xs);
      return { key, n: xs.length, pl: gpl, roi: gpl / xs.length, gain: b && b.n >= MIN_PRECISE ? b.market - b.app : null };
    });
    const big = groups.filter(g => g.n >= MIN_GROUP).sort((a, b) => b.pl - a.pl);
    const precise = groups.filter(g => g.gain != null).sort((a, b) => b.gain! - a.gain!)[0] ?? null;
    const ts = [...(tByWeek.get(week) ?? [])].sort((a, b) => a.day.localeCompare(b.day));
    const tuningOf = (): WeekTuning | null => {
      if (!ts.length) return null;
      const from: WeekTuning['from'] = {}, to: WeekTuning['to'] = {};
      for (const t of ts) { if (from[t.kind] == null) from[t.kind] = t.prev; to[t.kind] = t.w; }
      return { tries: ts.length, applied: ts.filter(t => t.applied).length, from, to };
    };
    return {
      week, n: rs.length, decided: d.length,
      hit: d.length ? d.filter(r => r.status === 'won').length / d.length : 0,
      said: d.length ? d.reduce((s, r) => s + r.p, 0) / d.length : 0,
      pl, roi: rs.length ? pl / rs.length : 0,
      clv: mean(rs.filter(r => r.firstPrice > 1 && r.closePrice && r.closePrice > 1).map(r => r.firstPrice / r.closePrice! - 1)),
      brier: brierOf(rs),
      best: big[0] && big[0].pl > 0 ? big[0] : null,
      worst: big.length > 1 && big[big.length - 1].pl < 0 ? big[big.length - 1] : null,
      precise: precise && precise.gain! > 0 ? precise : null,
      tuning: tuningOf()
    };
  });
}

// Salud del reajuste diario: ¿se ha ejecutado hoy o ayer?, ¿hay líneas guardadas de los últimos días? (si nadie abre las
// recomendaciones de baloncesto no se guardan y el reajuste no tiene de qué aprender) y ¿llega a la muestra mínima?
export interface TuningHealth { ok: boolean; lastRun: string | null; stale: boolean; emptyDays: string[]; lowSample: boolean }
export function tuningHealth(history: ModelTuningRow[], feed: { day: string; n: number }[], today: string, days = 7): TuningHealth {
  const lastRun = history.map(h => h.day).sort().pop() ?? null;
  const ago = (d: string) => Math.round((Date.parse(`${today}T12:00:00Z`) - Date.parse(`${d}T12:00:00Z`)) / 864e5);
  const stale = !lastRun || ago(lastRun) > 1;
  const have = new Set(feed.filter(f => f.n > 0).map(f => f.day));
  // Los últimos días ya jugados (hoy no: aún se están guardando)
  const emptyDays = Array.from({ length: days }, (_, i) => new Date(Date.parse(`${today}T12:00:00Z`) - (i + 1) * 864e5).toISOString().slice(0, 10)).filter(d => !have.has(d)).reverse();
  const last = history.filter(h => h.day === lastRun);
  const lowSample = last.some(h => h.reason.startsWith('poca muestra'));
  return { ok: !stale && emptyDays.length <= 2 && !lowSample, lastRun, stale, emptyDays, lowSample };
}
