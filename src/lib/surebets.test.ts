import { describe, expect, it } from 'vitest';
import { ageMinutes, bestStakes, filterSurebets, stakesFor } from '@/lib/surebets';
import type { SurebetMatch } from '@/lib/types';

const legs = [{ id: 'over', label: 'Más', book: 'Winamax', price: 2.1 }, { id: 'under', label: 'Menos', book: 'Betway', price: 2.05 }];

describe('stakesFor', () => {
  it('sin redondear, se cobra lo mismo salga lo que salga', () => {
    const r = stakesFor(legs, 100, 0)!;
    expect(r.stakes[0].returns).toBeCloseTo(r.stakes[1].returns);
    expect(r.spent).toBeCloseTo(100);
    expect(r.worst).toBeCloseTo(100 / (1 / 2.1 + 1 / 2.05) - 100);
  });
  it('redondeado a euros: lo peor y lo mejor siguen en positivo con una surebet clara', () => {
    const r = stakesFor(legs, 100)!;
    expect(r.stakes.map(s => s.stake)).toEqual([49, 51]);
    expect(r.worst).toBeGreaterThan(0);
    expect(r.best).toBeGreaterThanOrEqual(r.worst);
  });
  it('sin dinero, nada', () => {
    expect(stakesFor(legs, 0)).toBeNull();
  });
});

describe('bestStakes', () => {
  it('si redondear a euros se come un margen pequeño, redondea más fino', () => {
    const thin = [{ id: 'over', label: 'Más', book: 'Betway', price: 1.95 }, { id: 'under', label: 'Menos', book: 'Winamax', price: 2.08 }];
    expect(stakesFor(thin, 100)!.worst).toBeLessThan(0);
    const r = bestStakes(thin, 100)!;
    expect(r.worst).toBeGreaterThan(0);
    expect(r.step).toBeLessThan(1);
  });
});

describe('ageMinutes', () => {
  it('cuenta desde la casa leída hace más tiempo', () => {
    const now = 1e12;
    expect(ageMinutes({ Winamax: now - 5 * 60e3, Betway: now - 30 * 60e3 }, ['Winamax', 'Betway'], now)).toBe(30);
    expect(ageMinutes({}, ['Winamax'], now)).toBeNull();
  });
});

describe('filterSurebets', () => {
  const m = (sport: string, edges: number[]) => ({
    match: { a: { name: 'A' }, b: { name: 'B' }, start: '', sport, league: '' }, read: {},
    arbs: edges.map((edge, i) => ({ key: `k${i}`, market: '', legs, sum: 0, edge, check: false }))
  }) as unknown as SurebetMatch;
  const list = [m('basket', [0.01, 0.03]), m('tennis', [0.02]), m('football', [0.005])];
  it('todas juntas, de más a menos beneficio, y cuántas de cada deporte', () => {
    const r = filterSurebets(list, 'all');
    expect(r.items.map(x => x.a.edge)).toEqual([0.03, 0.02, 0.01, 0.005]);
    expect(r.counts).toEqual({ all: 4, basket: 2, tennis: 1, football: 1 });
  });
  it('sólo las del deporte elegido, con las cuentas de todos', () => {
    const r = filterSurebets(list, 'basket');
    expect(r.items.map(x => x.a.edge)).toEqual([0.03, 0.01]);
    expect(r.counts.tennis).toBe(1);
    expect(filterSurebets(list, 'mma').items).toEqual([]);
  });
});
