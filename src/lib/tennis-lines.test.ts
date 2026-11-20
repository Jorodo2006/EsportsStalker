// Las líneas del perfil del tenista (src/lib/tennis-lines.ts): acierto frente a una línea, tramos, línea sugerida y las líneas de las
// casas de su próximo partido con el panel de valor
import { describe, expect, it } from 'vitest';
import { bookLines, covers, hitRate, mainLine, sideText, splits, suggestedLine, valueOf } from './tennis-lines';
import type { TennisLogMatch, TennisPick } from './types';

const g = (o: Partial<TennisLogMatch>): TennisLogMatch => ({
  id: Math.random().toString(36), date: '2026-11-02', tournament: 'Torneo', surface: 'Hard', level: 'A', round: 'R32', bestOf: 3, opp: 'Rival', oppRank: 30,
  win: true, score: '6-4 6-4', retired: false, minutes: 90, gamesWon: 12, gamesLost: 8, setsWon: 2, setsLost: 0, tbWon: 0, tbLost: 0,
  aces: 6, df: 2, svpt: 60, firstIn: 40, firstWon: 30, secondWon: 10, svGms: 10, bpFaced: 2, bpSaved: 2, breaks: 2, oppAces: 3, ...o
});

const rel = (score: number) => ({ score, label: score >= 70 ? 'Alta' as const : score >= 50 ? 'Media' as const : 'Baja' as const, factors: [], warnings: [] });
const pick = (id: string, o: Partial<TennisPick>): TennisPick => ({
  id, title: '', market: '', selection: '', family: '', side: null, book: 'Winamax', price: 1.9, prices: { Winamax: 1.9 }, p: 0.5, pModel: 0.5, pMarket: 0.5,
  fair: 2, ev: -0.05, rel: rel(60), why: '', ...o
});

describe('acierto frente a una línea', () => {
  it('más y menos, sin contar las retiradas ni los partidos sin el dato', () => {
    const list = [g({ gamesWon: 13 }), g({ gamesWon: 9 }), g({ gamesWon: 14 }), g({ gamesWon: 20, retired: true }), g({ aces: null })];
    expect(hitRate(list, 'games', 12.5, 'over')).toMatchObject({ n: 4, hits: 2 });
    expect(hitRate(list, 'games', 12.5, 'under')).toMatchObject({ n: 4, hits: 2 });
    expect(hitRate(list, 'aces', 5.5, 'over').n).toBe(3);
  });
  it('el hándicap se cubre con sus juegos menos los del rival más la línea', () => {
    expect(covers('spread', -2, 2.5)).toBe(true); // pierde por 2 con +2,5
    expect(covers('spread', 3, -2.5)).toBe(true); // gana por 3 con −2,5
    expect(covers('spread', 2, -2.5)).toBe(false);
    expect(sideText('spread', 2.5, 'over')).toBe('+2,5 juegos');
    expect(sideText('sets', 0.5, 'over')).toBe('gana un set');
  });
});

describe('tramos', () => {
  it('últimos 10 y el resto sobre 52 semanas, con su superficie y el rival', () => {
    const list = [g({ surface: 'Clay', oppRank: 5, gamesWon: 14 }), g({ surface: 'Hard', oppRank: 80, win: false, gamesWon: 8 }), g({ date: '2025-06-02', gamesWon: 15 })];
    const rows = splits(list, 'games', 12.5, 'over', { today: '2026-11-20', surface: 'Clay', surfaceLabel: 'tierra' });
    const by = Object.fromEntries(rows.map(r => [r.label, r]));
    expect(by['Últimos 10'].n).toBe(3);
    expect(by['52 semanas'].n).toBe(2);
    expect(by['En tierra']).toMatchObject({ n: 1, hits: 1 });
    expect(by['Contra el top 20']).toMatchObject({ n: 1, hits: 1 });
    expect(by['Cuando pierde']).toMatchObject({ n: 1, hits: 0 });
    expect(rows.some(r => /cinco sets/.test(r.label))).toBe(false);
  });
});

describe('línea sugerida', () => {
  it('la de medio punto más cercana a lo esperado; en el hándicap, la que iguala', () => {
    expect(suggestedLine('games', 12.3, [])).toBe(12.5);
    expect(suggestedLine('spread', 3.2, [])).toBe(-3.5);
    expect(suggestedLine('sets', 1.7, [])).toBe(1.5);
    expect(suggestedLine('df', null, [g({ df: 3 }), g({ df: 4 })])).toBe(3.5);
  });
});

describe('líneas de las casas', () => {
  const picks = [
    pick('team_total|0|a|12.5#over', { p: 0.55, price: 1.95, ev: 0.0725, rel: rel(66) }),
    pick('team_total|0|a|12.5#under', { p: 0.45, price: 1.85 }),
    pick('team_total|0|b|10.5#over', { p: 0.5 }),
    pick('spread|0||-2.5#a', { side: 'a' }), pick('spread|0||-2.5#b', { side: 'b' }),
    pick('wmx|aces#over', { family: 'Aces de Carlos Alpha', selection: 'Más de 6.5' }),
    pick('wmx|aces10#x', { family: 'Aces de Carlos Alpha', selection: '10 o más' }),
    pick('moneyline|0||#a', { side: 'a', family: 'Ganador' }),
    pick('betway|set#x1', { side: 'a', family: 'Gana un set' })
  ];
  it('cada mercado desde el jugador: sus juegos, el hándicap (al revés si es el b), los aces y los sets', () => {
    expect([...bookLines(picks, 'games', 'a', 'Carlos Alpha').keys()]).toEqual([12.5]);
    expect([...bookLines(picks, 'games', 'b', 'Jannik Beta').keys()]).toEqual([10.5]);
    const spreadA = bookLines(picks, 'spread', 'a', 'Carlos Alpha').get(-2.5)!;
    expect(spreadA.over?.id).toBe('spread|0||-2.5#a');
    const spreadB = bookLines(picks, 'spread', 'b', 'Jannik Beta').get(2.5)!;
    expect(spreadB.over?.id).toBe('spread|0||-2.5#b');
    const aces = bookLines(picks, 'aces', 'a', 'Carlos Alpha');
    expect([...aces.keys()].sort()).toEqual([6.5, 9.5]);
    const sets = bookLines(picks, 'sets', 'a', 'Carlos Alpha');
    expect(sets.get(0.5)?.over?.family).toBe('Gana un set');
    expect(sets.get(1.5)?.over?.family).toBe('Ganador');
  });
  it('la línea principal es la más igualada, aunque sólo llegue un lado (el hándicap)', () => {
    const hcp = [pick('spread|0||-5.5#a', { p: 0.2 }), pick('spread|0||-2.5#a', { p: 0.55 }), pick('spread|0||-0.5#a', { p: 0.7 })];
    expect(mainLine(bookLines(hcp, 'spread', 'a', 'Carlos Alpha'))).toBe(-2.5);
    expect(mainLine(new Map())).toBeNull();
  });
  it('panel de valor con las cifras del servicio y el veredicto común', () => {
    const v = valueOf('games', 12.5, bookLines(picks, 'games', 'a', 'Carlos Alpha').get(12.5))!;
    expect(v.pOver).toBe(0.55);
    expect(v.exact).toBe(true);
    expect(v.verdict.code).toBe('BET'); // valor 7,25 % y fiabilidad 66
    expect(v.verdict.best?.side).toBe('over');
    expect(valueOf('games', 13.5, undefined)).toBeNull();
  });
});
