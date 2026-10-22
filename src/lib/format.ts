import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import type { Bet, BetStatus } from './types';

export const cn = (...v: ClassValue[]) => twMerge(clsx(v));

export function money(x: number, currency = '€', sign = false) {
  const v = Number(x) || 0;
  const s = v.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${sign && v > 0 ? '+' : ''}${s} ${currency}`;
}
export const pct = (x: number) => `${((Number(x) || 0) * 100).toLocaleString('es-ES', { maximumFractionDigits: 1 })}%`;
export const odd = (x: number | null | undefined) => (x ? Number(x).toFixed(2) : '–');
export const tone = (v: number) => (v > 0 ? 'text-emerald-400' : v < 0 ? 'text-rose-400' : '');

export const fmtTime = (d: string | number) => new Date(d).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
export const fmtDay = (d: string) => new Date(d).toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' });
export const fmtDate = (d: string) => new Date(d).toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: '2-digit' });
// Leaguepedia devuelve "2026-10-19 10:00:00" en UTC
export const utc = (d: string) => d.replace(' ', 'T') + 'Z';
export const k = (v: number) => `${(v / 1000).toFixed(1)}k`;

export const STATUS_LABEL: Record<BetStatus, string> = {
  pending: 'Pendiente', won: 'Ganada', lost: 'Perdida', void: 'Nula',
  cashout: 'Cash out', halfwon: 'Medio ganada', halflost: 'Medio perdida'
};

// Beneficio de una apuesta resuelta (las pendientes y nulas cuentan 0)
export function betProfit(b: Bet) {
  switch (b.status) {
    case 'won': return b.stake * (b.odds - 1);
    case 'lost': return -b.stake;
    case 'halfwon': return (b.stake / 2) * (b.odds - 1);
    case 'halflost': return -b.stake / 2;
    case 'cashout': return b.cashout - b.stake;
    default: return 0;
  }
}

export function summarize(list: Bet[]) {
  const settled = list.filter(b => b.status !== 'pending' && b.status !== 'void');
  const staked = settled.reduce((s, b) => s + b.stake, 0);
  const profit = settled.reduce((s, b) => s + betProfit(b), 0);
  const won = settled.filter(b => betProfit(b) > 0).length;
  const pending = list.filter(b => b.status === 'pending');
  return {
    count: list.length,
    settled: settled.length,
    staked, profit, won,
    roi: staked ? profit / staked : 0,
    hit: settled.length ? won / settled.length : 0,
    avgOdds: settled.length ? settled.reduce((s, b) => s + b.odds, 0) / settled.length : 0,
    pendingCount: pending.length,
    pendingStake: pending.reduce((s, b) => s + b.stake, 0),
    pendingReturn: pending.reduce((s, b) => s + b.stake * b.odds, 0)
  };
}

export function groupBy<T>(list: T[], key: (x: T) => string) {
  const m = new Map<string, T[]>();
  for (const x of list) {
    const k = key(x);
    if (!m.has(k)) m.set(k, []);
    m.get(k)!.push(x);
  }
  return m;
}
