import { describe, expect, it } from 'vitest';
import { byMonth, clvOf, closeOdds, combinedSeries, edgeOf, luckOf, marketKind, normalCdf, oddsBand, runsOf } from '@/lib/bet-stats';
import type { Bet, BetStatus } from '@/lib/types';

let id = 0;
const bet = (status: BetStatus, odds = 2, stake = 10, date = '2026-11-01', extra: Partial<Bet> = {}): Bet => ({
  id: String(++id), date, league: '', event: 'A - B', market: '', selection: '', bookmaker: '', odds, stake, status, cashout: 0, notes: '', ...extra
});

describe('edgeOf', () => {
  it('compara el acierto con el que hace falta para no perder', () => {
    const e = edgeOf([bet('won', 2), bet('lost', 2), bet('won', 4), bet('pending'), bet('void')]);
    expect(e.n).toBe(3);
    expect(e.hit).toBeCloseTo(2 / 3);
    expect(e.breakEven).toBeCloseTo((0.5 + 0.5 + 0.25) / 3);
  });
  it('deja fuera los cash out', () => {
    expect(edgeOf([bet('cashout', 2, 10, '2026-11-01', { cashout: 15 })]).n).toBe(0);
  });
});

describe('luckOf', () => {
  it('no dice nada con pocas apuestas', () => {
    expect(luckOf([bet('won'), bet('lost')]).p).toBeNull();
  });
  it('a cero, la mitad de probabilidad de que sea suerte', () => {
    const list = Array.from({ length: 20 }, (_, i) => bet(i % 2 ? 'won' : 'lost'));
    expect(luckOf(list).p).toBeCloseTo(0.5);
  });
  it('ganar 30 de 40 a cuota 2,00 casi no puede ser suerte', () => {
    const list = Array.from({ length: 40 }, (_, i) => bet(i < 30 ? 'won' : 'lost'));
    expect(luckOf(list).p!).toBeLessThan(0.01);
  });
  it('la normal acumulada', () => {
    expect(normalCdf(0)).toBeCloseTo(0.5);
    expect(normalCdf(1.96)).toBeCloseTo(0.975, 3);
    expect(normalCdf(-1.96)).toBeCloseTo(0.025, 3);
  });
});

describe('runsOf', () => {
  it('peor caída, distancia al máximo y rachas', () => {
    const r = runsOf([
      bet('won', 2, 10, '2026-11-01'), bet('won', 2, 10, '2026-11-02'), // +20
      bet('lost', 2, 10, '2026-11-03'), bet('lost', 2, 10, '2026-11-04'), bet('lost', 2, 10, '2026-11-05'), // −10
      bet('won', 2, 10, '2026-11-06') // 0
    ]);
    expect(r.maxDrop).toBe(30);
    expect(r.fromPeak).toBe(20);
    expect(r.bestWin).toBe(2);
    expect(r.worstLoss).toBe(3);
    expect(r.streak).toEqual({ kind: 'won', n: 1 });
  });
});

describe('byMonth', () => {
  it('suma por mes, en orden', () => {
    const m = byMonth([bet('won', 2, 10, '2026-11-03'), bet('lost', 2, 10, '2026-10-30'), bet('won', 3, 10, '2026-11-20')]);
    expect(m.map(x => x.month)).toEqual(['2026-10', '2026-11']);
    expect(m[1].profit).toBe(30);
    expect(m[1].roi).toBeCloseTo(1.5);
  });
});

describe('tramos y mercados', () => {
  it('cada cuota en su tramo', () => {
    expect(oddsBand(1.5)).toBe('Hasta 1,50');
    expect(oddsBand(1.51)).toBe('1,51 a 2,00');
    expect(oddsBand(7)).toBe('Más de 5,00');
  });
  it('el tipo de mercado sale de la clave', () => {
    expect(marketKind(bet('won', 2, 10, '2026-11-01', { ref: { sport: 'basket', match: '', key: 'player|points|X|20.5', out: 'over' } }))).toBe('Jugador');
    expect(marketKind(bet('won', 2, 10, '2026-11-01', { legs: [] }))).toBe('Sin enlazar al partido');
    expect(marketKind(bet('won', 2, 10, '2026-11-01', { legs: [{ event: '', league: '', market: '', selection: '', odds: 2, status: 'won' }] }))).toBe('Combinada');
  });
});

describe('combinedSeries', () => {
  it('el total y la parte de un deporte', () => {
    const s = combinedSeries([bet('won', 2, 10, '2026-11-01', { sport: 'basket' }), bet('lost', 2, 5, '2026-11-02', { sport: 'tennis' })], 'basket');
    expect(s.map(p => p.total)).toEqual([0, 10, 5]);
    expect(s.map(p => p.part)).toEqual([0, 10, 10]);
  });
});

describe('clvOf', () => {
  const ref = { sport: 'football' as const, match: '1', key: 'moneyline|0||', out: 'a' };
  it('la cuota frente a la de cierre', () => {
    const c = clvOf([
      bet('won', 2.2, 10, '2026-11-01', { ref, close: { price: 2, book: 'winamax' } }), // +10 %
      bet('pending', 1.8, 30, '2026-11-02', { ref, close: { price: 2, book: 'winamax' } }), // −10 %
      bet('lost', 2, 10, '2026-11-03', { ref, close: { price: null, book: '' } }), // sin cierre
      bet('void', 2, 10, '2026-11-03', { ref, close: { price: 1.5, book: '' } }) // nula: fuera
    ]);
    expect(c.n).toBe(2);
    expect(c.avg).toBeCloseTo(0);
    expect(c.weighted).toBeCloseTo((10 * 0.1 + 30 * -0.1) / 40);
    expect(c.beat).toBe(0.5);
    expect(c.withRef).toBe(3);
  });
  it('combinada: con todas sus selecciones con cierre, sin contar las nulas', () => {
    const leg = (price: number | null, status: 'won' | 'void' = 'won') => ({ event: '', league: '', market: '', selection: '', odds: 2, status, ref, close: { price, book: 'betway' } });
    expect(closeOdds(bet('won', 4, 10, '2026-11-01', { legs: [leg(1.8), leg(2.5), leg(null, 'void')] }))).toBeCloseTo(4.5);
    expect(closeOdds(bet('won', 4, 10, '2026-11-01', { legs: [leg(1.8), leg(null)] }))).toBeNull();
  });
});
