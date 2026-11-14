// Modelo de props de baloncesto: que las pantallas den lo mismo y que los ajustes medidos (PROJ) hagan lo que dicen
import { describe, expect, it } from 'vitest';
import { PROJ, analyze, playerLines, project, scanLine, type BasketCtx } from './basket-model';
import { freshKeyOuts, matesOut, withAndWithout } from './basket-mates';
import type { BasketLogGame, BasketTeamLogs, MarketLine, MatchOdds } from './types';

// Partidos inventados de un jugador: `n` de esta temporada (2027) y `m` de la pasada, del más reciente al más antiguo
function games(n: number, m: number, cur: { pts: number; min: number }, old: { pts: number; min: number }, team = 'T1'): BasketLogGame[] {
  const out: BasketLogGame[] = [];
  for (let i = 0; i < n + m; i++) {
    const thisSeason = i < n, x = thisSeason ? cur : old;
    const d = new Date(Date.UTC(thisSeason ? 2026 : 2026, thisSeason ? 10 : 3, 28 - (i % 25)) - (thisSeason ? i : i - n) * 864e5);
    out.push({
      id: `${team}-${i}`, date: d.toISOString(), season: thisSeason ? 2027 : 2026, type: 'reg', home: i % 2 === 0, opp: 'OPP',
      team: 'Equipo', teamId: team, result: '', score: '', min: x.min, pts: x.pts + ((i * 7) % 5) - 2, reb: 5, ast: 3, stl: 1, blk: 0, tov: 2, fg3m: 2
    });
  }
  return out.sort((a, b) => +new Date(b.date) - +new Date(a.date));
}
const ctx: BasketCtx = { currentSeason: 2027, home: true, opp: 'OPP', injury: null };

describe('proyección', () => {
  it('la temporada pasada pesa menos que esta (PROJ.carry)', () => {
    const g = games(3, 40, { pts: 18, min: 30 }, { pts: 18, min: 30 });
    const saved = { ...PROJ };
    try {
      Object.assign(PROJ, { carry: 1, carryMin: 1 });
      const full = project(g, 'pts', ctx)!.mu;
      Object.assign(PROJ, { carry: 0.88, carryMin: 0.92 });
      const less = project(g, 'pts', ctx)!.mu;
      expect(less).toBeLessThan(full);
    } finally { Object.assign(PROJ, saved); }
  });
  it('los ajustes por campo y rival no cambian el sentido del carry (se comparan valores escalados con escalados)', () => {
    const g = games(5, 40, { pts: 15, min: 28 }, { pts: 15, min: 28 });
    const saved = { ...PROJ };
    try {
      const mus = [1, 0.8, 0.5].map(c => { Object.assign(PROJ, { carry: c }); return project(g, 'pts', ctx)!.mu; });
      expect(mus[1]).toBeLessThan(mus[0]);
      expect(mus[2]).toBeLessThan(mus[1]);
    } finally { Object.assign(PROJ, saved); }
  });
});

describe('analizador y escáner', () => {
  const g = games(20, 30, { pts: 20, min: 32 }, { pts: 19, min: 31 });
  const books = [{ over: 1.86, under: 1.76 }, { over: 2.3 }];

  it('dan la misma probabilidad y la misma fiabilidad para cada lado', () => {
    for (const side of ['over', 'under'] as const) {
      const A = analyze(g, 'pts', 19.5, { over: 2.3, under: 1.76, books }, ctx)!;
      const S = scanLine(g, 'pts', 19.5, side, ctx, { over: 2.3, under: 1.76, books })!;
      expect(S.p).toBeCloseTo(side === 'over' ? A.pOver : A.pUnder, 12);
      expect(S.rel.score).toBe(A.relBySide[side].score);
    }
  });
  it('con las cuotas de cada casa, la probabilidad de la casa no depende de la cuota que se pulse', () => {
    const fromPick = analyze(g, 'pts', 19.5, { over: 2.3, under: 1.76, books }, ctx)!;
    const fromCell = analyze(g, 'pts', 19.5, { over: 1.86, under: 1.76, books }, ctx)!;
    const u = (A: typeof fromPick) => A.sides.find(s => s.side === 'under')!;
    expect(u(fromPick).p).toBeCloseTo(u(fromCell).p, 12);
    expect(u(fromPick).ev).toBeCloseTo(u(fromCell).ev, 12); // mismo menos (1,76): mismo valor
  });
  it('una baja nueva de un compañero importante baja la fiabilidad del menos, no la del más', () => {
    const base = analyze(g, 'pts', 19.5, { over: 1.9, under: 1.9 }, ctx)!;
    const out = analyze(g, 'pts', 19.5, { over: 1.9, under: 1.9 }, { ...ctx, matesOut: ['Compañero'] })!;
    expect(out.relBySide.over.score).toBe(base.relBySide.over.score);
    expect(out.relBySide.under.score).toBeLessThan(base.relBySide.under.score);
    expect(out.pUnder).toBeCloseTo(base.pUnder, 12); // la probabilidad no cambia
  });
});

describe('bajas de compañeros', () => {
  // Plantilla: el jugador "yo" y dos compañeros. "nuevo" jugó hasta el penúltimo partido; "largo" no juega desde hace 10
  const me = games(20, 0, { pts: 15, min: 28 }, { pts: 0, min: 0 });
  const teamGames = me.map(g => g.id);
  const nuevo = me.slice(2).map(g => ({ ...g, min: 34, pts: 22 }));
  const largo = me.slice(10).map(g => ({ ...g, min: 30, pts: 18 }));
  const roster = (id: string, name: string, gs: BasketLogGame[], injury: string | null) => ({ id, name, pos: '', jersey: '', headshot: '', injury, games: gs });
  const data: BasketTeamLogs = { currentSeason: 2027, players: [roster('yo', 'Yo', me, null), roster('n', 'Nuevo Baja', nuevo, 'Out'), roster('l', 'Largo Baja', largo, 'Out')] };
  const date = new Date(+new Date(me[0].date) + 864e5).toISOString();

  it('separa las bajas nuevas de las que vienen de antes', () => {
    const list = matesOut(data, 'T1', 'yo', date, (_, r) => r);
    const n = list.find(x => x.id === 'n')!, l = list.find(x => x.id === 'l')!;
    expect(n.streak).toBe(2);
    expect(n.fresh).toBe(true);
    expect(l.streak).toBe(10);
    expect(l.fresh).toBe(false);
    expect(freshKeyOuts(list).map(x => x.id)).toEqual(['n']);
    expect(teamGames.length).toBe(20);
  });
  it('cuenta sus partidos con y sin el compañero', () => {
    const s = withAndWithout(me, data, 'l', 'T1', 'pts', 14.5)!;
    expect(s.n).toBe(10);
    expect(s.nWith).toBe(10);
  });
});

describe('líneas de un jugador en las casas (playerLines)', () => {
  // Cada mercado: [jugador como lo escribe la casa, estadística, línea, más, menos, casa]
  const oddsOf = (rows: [string, string, number, number | null, number | null, string][]): MatchOdds => ({
    books: ['Winamax', 'Betway'], sources: {},
    markets: rows.map(([who, stat, line, over, under, book]) => ({
      key: `player|${stat}|${who.toLowerCase()}|${line}`, group: stat, period: 0, line,
      outcomes: [
        ...(over ? [{ id: 'over', label: 'Más', prices: { [book]: over } }] : []),
        ...(under ? [{ id: 'under', label: 'Menos', prices: { [book]: under } }] : [])
      ]
    }) as unknown as MarketLine)
  });

  it('no mezcla a dos jugadores con el mismo apellido e inicial (Donovan y Davion Mitchell)', () => {
    const odds = oddsOf([
      ['Donovan Mitchell', 'Pts + Reb', 29.5, 1.76, 1.86, 'Winamax'],
      ['Davion Mitchell', 'Pts + Reb', 29.5, 10.5, null, 'Winamax'],
      ['Davion Mitchell', 'Pts + Reb', 16.5, 1.83, 1.87, 'Betway']
    ]);
    const don = playerLines(odds, 'Donovan Mitchell')['Pts + Reb'];
    expect(don.map(l => l.line)).toEqual([29.5]);
    expect(don[0].over).toBe(1.76);
    expect(playerLines(odds, 'Davion Mitchell')['Pts + Reb'].find(l => l.line === 29.5)!.over).toBe(10.5);
  });
  it('acepta la abreviatura y el apellido compuesto si no hay duda', () => {
    const odds = oddsOf([['S. Gilgeous-Alexander', 'Puntos', 31.5, 1.85, 1.95, 'Betway'], ['Trey Murphy', 'Puntos', 20.5, 1.9, 1.9, 'Winamax']]);
    expect(playerLines(odds, 'Shai Gilgeous-Alexander').Puntos?.[0].over).toBe(1.85);
    expect(playerLines(odds, 'Trey Murphy III').Puntos?.[0].over).toBe(1.9);
    expect(playerLines(oddsOf([['Kenneth Faried (BAS)', 'Rebotes', 6.5, 1.8, 2, 'Betway']]), 'Kenneth Faried').Rebotes?.[0].over).toBe(1.8);
    expect(playerLines(oddsOf([['Nicolas Claxton', 'Puntos', 11.5, 1.9, 1.9, 'Betway']]), 'Nic Claxton').Puntos?.[0].over).toBe(1.9);
  });
  it('una abreviatura que puede ser otro jugador del partido no se usa', () => {
    const odds = oddsOf([['D. Mitchell', 'Puntos', 24.5, 1.9, 1.9, 'Betway'], ['Davion Mitchell', 'Puntos', 9.5, 1.85, 1.95, 'Winamax']]);
    expect(playerLines(odds, 'Donovan Mitchell').Puntos).toBeUndefined();
  });
});
