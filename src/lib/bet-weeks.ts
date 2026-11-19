import { betProfit } from '@/lib/format';
import type { Bet } from '@/lib/types';

// Semanas y días del historial de apuestas. Las fechas de las apuestas son cadenas YYYY-MM-DD (la que puso el usuario, sin hora),
// así que toda la aritmética se hace sobre esa cadena, pasando por UTC: sin zonas horarias ni cambios de hora de por medio.

const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const SHORT = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const WEEKDAYS = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];

const toUtc = (d: string) => { const [y, m, day] = d.split('-').map(Number); return Date.UTC(y, m - 1, day); };
const fromUtc = (t: number) => new Date(t).toISOString().slice(0, 10);

// Fecha local del navegador (el usuario apunta sus apuestas con su día, no con el de UTC)
export function todayStr(now: number = Date.now()): string {
  const d = new Date(now);
  const p = (v: number) => String(v).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// YYYY-MM-DD que existe de verdad (no el 30 de febrero)
export function isDate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  return fromUtc(toUtc(s)) === s;
}

export const addDays = (date: string, n: number) => fromUtc(toUtc(date) + n * 864e5);
export const addWeeks = (start: string, n: number) => addDays(start, 7 * n);

// Lunes de la semana de una fecha; '' si no es una fecha
export function weekStart(date: string): string {
  if (!isDate(date)) return '';
  const dow = (new Date(toUtc(date)).getUTCDay() + 6) % 7; // 0 = lunes
  return addDays(date, -dow);
}

export const weekDays = (start: string) => Array.from({ length: 7 }, (_, i) => addDays(start, i));

const part = (d: string) => { const [y, m, day] = d.split('-').map(Number); return { y, m: m - 1, day }; };

// «16 – 22 nov»; si cruza de mes «26 oct – 1 nov»; si cruza de año se pone el año en los dos extremos
export function weekLabel(start: string): string {
  const a = part(start), b = part(addDays(start, 6));
  if (a.y !== b.y) return `${a.day} ${SHORT[a.m]} ${a.y} – ${b.day} ${SHORT[b.m]} ${b.y}`;
  if (a.m !== b.m) return `${a.day} ${SHORT[a.m]} – ${b.day} ${SHORT[b.m]}`;
  return `${a.day} – ${b.day} ${SHORT[b.m]}`;
}

export function dayLabel(date: string): string {
  const p = part(date);
  return `${WEEKDAYS[new Date(toUtc(date)).getUTCDay()]} ${p.day} de ${MONTHS[p.m]}`;
}

export interface DayGroup { date: string; bets: Bet[]; profit: number; pending: number; pendingStake: number }
export interface WeekGroup { start: string; days: DayGroup[]; profit: number; count: number }

// Del día más reciente al más antiguo; dentro de un día, la última apuesta apuntada primero. Los pendientes y los nulos no suman beneficio
export function groupByDay(bets: Bet[]): DayGroup[] {
  const by = new Map<string, Bet[]>();
  for (const b of bets) by.set(b.date, [...(by.get(b.date) ?? []), b]);
  return [...by.entries()]
    .sort((a, b) => (a[0] < b[0] ? 1 : a[0] > b[0] ? -1 : 0))
    .map(([date, list]) => {
      const sorted = [...list].sort((a, b) => (a.id < b.id ? 1 : a.id > b.id ? -1 : 0));
      const pend = sorted.filter(b => b.status === 'pending');
      return {
        date, bets: sorted, profit: sorted.reduce((s, b) => s + betProfit(b), 0),
        pending: pend.length, pendingStake: pend.reduce((s, b) => s + b.stake, 0)
      };
    });
}

// Semanas de la más reciente a la más antigua; las apuestas sin fecha válida van juntas, al final, con start ''
export function groupByWeek(bets: Bet[]): WeekGroup[] {
  const by = new Map<string, Bet[]>();
  for (const b of bets) { const w = weekStart(b.date); by.set(w, [...(by.get(w) ?? []), b]); }
  return [...by.entries()]
    .sort((a, b) => (a[0] === '' ? 1 : b[0] === '' ? -1 : a[0] < b[0] ? 1 : -1))
    .map(([start, list]) => {
      const days = groupByDay(list);
      return { start, days, profit: days.reduce((s, d) => s + d.profit, 0), count: list.length };
    });
}

// Las semanas (de 7 días, lunes primero) que tocan el mes; month de 0 a 11
export function monthGrid(year: number, month: number): string[][] {
  const first = fromUtc(Date.UTC(year, month, 1));
  const last = fromUtc(Date.UTC(year, month + 1, 0));
  const rows: string[][] = [];
  for (let s = weekStart(first); s <= last; s = addWeeks(s, 1)) rows.push(weekDays(s));
  return rows;
}

export const betDates = (bets: Bet[]) => new Set(bets.map(b => b.date).filter(isDate));

// Lunes de la última semana que tiene apuestas, anterior al lunes `before` si se da; null si no hay ninguna
export function latestWeekWithBets(bets: Bet[], before?: string): string | null {
  let best: string | null = null;
  for (const b of bets) {
    const w = weekStart(b.date);
    if (!w || (before && w >= before)) continue;
    if (!best || w > best) best = w;
  }
  return best;
}
