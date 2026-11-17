import { describe, expect, it } from 'vitest';
import { ageOf, applyOdds, isStale } from './slip-live';
import type { MatchOdds, SlipLeg } from './types';

const leg: SlipLeg = {
  event: 'A - B', league: 'L', market: 'Total de goles', selection: 'Más de 2.5', odds: 1.9, status: 'pending', bookmaker: 'Winamax',
  live: { match: { a: { name: 'A', code: '' }, b: { name: 'B', code: '' }, sport: 'football' }, key: 'total|0||2.5', out: 'over', at: 0 }
};
const odds = (prices: Record<string, number>, key = 'total|0||2.5'): MatchOdds => ({
  books: Object.keys(prices),
  markets: [{ key, group: 'Total de goles', period: 0, line: 2.5, main: true, outcomes: [{ id: 'over', label: 'Más de 2.5', prices }] }],
  sources: { Winamax: { ok: true, msg: '', ts: 5000 }, Betway: { ok: true, msg: '', ts: 6000 } }
});

describe('applyOdds', () => {
  it('cambia la cuota y recuerda la de antes', () => {
    const r = applyOdds(leg, odds({ Winamax: 1.75, Betway: 1.8 }), 9000);
    expect(r.odds).toBe(1.75);
    expect(r.bookmaker).toBe('Winamax');
    expect(r.live?.was).toBe(1.9);
    expect(r.live?.at).toBe(5000);
    expect(r.live?.gone).toBe(false);
  });
  it('si no cambia, no pone cuota de antes', () => {
    const r = applyOdds(leg, odds({ Winamax: 1.9 }), 9000);
    expect(r.live?.was).toBeUndefined();
  });
  it('si su casa ya no la tiene, la mejor de las demás', () => {
    const r = applyOdds(leg, odds({ Betway: 1.85 }), 9000);
    expect(r.bookmaker).toBe('Betway');
    expect(r.odds).toBe(1.85);
    expect(r.live?.at).toBe(6000);
  });
  it('si la línea ya no está, la marca y no toca la cuota', () => {
    const r = applyOdds(leg, odds({ Winamax: 2 }, 'total|0||3.5'), 9000);
    expect(r.live?.gone).toBe(true);
    expect(r.odds).toBe(1.9);
  });
  it('sin datos de la selección, se queda como estaba', () => {
    const plain = { ...leg, live: undefined };
    expect(applyOdds(plain, odds({ Winamax: 1.5 }))).toBe(plain);
  });
});

describe('ageOf e isStale', () => {
  it('dice cuánto hace', () => {
    expect(ageOf(0, 30e3)).toBe('ahora');
    expect(ageOf(0, 5 * 60e3)).toBe('hace 5 min');
    expect(ageOf(0, 3 * 3600e3)).toBe('hace 3 h');
    expect(ageOf(0, 72 * 3600e3)).toBe('hace 3 días');
  });
  it('vieja a partir de una hora', () => {
    expect(isStale(0, 59 * 60e3)).toBe(false);
    expect(isStale(0, 61 * 60e3)).toBe(true);
  });
});
