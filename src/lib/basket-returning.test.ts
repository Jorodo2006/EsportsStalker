import { describe, expect, it } from 'vitest';
import { gameCtx } from './basket-context';
import { returningPicks, type BasketPick } from './basket-picks';
import type { BasketLogGame } from './types';

const lg = (date: string, season: number, teamId = '26', type: 'reg' | 'pre' = 'reg'): BasketLogGame => ({
  id: `${date}-${teamId}`, date, season, type, home: true, opp: 'X', team: 'UTAH', teamId, result: 'G', score: '', min: 26, pts: 8, reb: 7, ast: 5, stl: 1, blk: 1, tov: 2, fg3m: 0
});
// El calendario de Utah esta temporada: 19 partidos en noviembre antes del día 28
const team = Array.from({ length: 19 }, (_, i) => ({ id: `t${i}`, date: `2026-11-${String(i + 1).padStart(2, '0')}T02:00Z` }));

describe('Vuelta de una baja que viene de la temporada pasada', () => {
  it('su último partido es de la temporada pasada y su equipo ya ha jugado 19: vuelve (1.º partido, debut)', () => {
    const prior = [lg('2026-04-10T02:00Z', 2026), lg('2026-10-04T02:00Z', 2027, '26', 'pre')];
    expect(gameCtx(prior, team, '2026-11-28T02:30Z', '26')).toMatchObject({ back: 1, missed: 19, debut: true });
  });
  it('con otro equipo la temporada pasada (fichaje) no cuenta como vuelta', () => {
    expect(gameCtx([lg('2026-04-10T02:00Z', 2026, '4')], team, '2026-11-28T02:30Z', '26').back).toBeUndefined();
  });
  it('si su equipo sólo ha jugado 2, no es una baja', () => {
    expect(gameCtx([lg('2026-04-10T02:00Z', 2026)], team.slice(0, 2), '2026-11-28T02:30Z', '26').back).toBeUndefined();
  });
  it('dentro de la temporada sigue como antes', () => {
    const prior = [lg('2026-11-01T02:00Z', 2027)];
    expect(gameCtx(prior, team, '2026-11-28T02:30Z', '26')).toMatchObject({ back: 1, missed: 18 });
    expect(gameCtx(prior, team, '2026-11-28T02:30Z', '26').debut).toBeUndefined();
  });
});

const pk = (who: string, ev: number, k = 1, price = 4): BasketPick => ({
  id: `${who}:${ev}`, kind: 'player', game: { id: 'g1' } as BasketPick['game'], group: 'ast' as BasketPick['group'], side: 'over', line: 2.5, title: '', market: '', selection: '',
  who: { id: who, name: who, teamId: '26' }, marketKey: 'ast', period: null, pointKind: null, price, p: 0.35, pModel: 0.75, pMarket: 0.24, fair: 2.8, ev,
  rel: { score: 22 } as BasketPick['rel'], why: '', injury: null, back: { k, missed: 19, debut: true }
});

describe('Vuelven hoy', () => {
  it('una por jugador, la de más valor, aunque se aleje mucho de la casa', () => {
    const r = returningPicks([pk('nurkic', 0.37), pk('nurkic', 0.1), pk('otro', 0.05)]);
    expect(r.map(x => [x.pick.who!.id, x.pick.ev, x.more])).toEqual([['nurkic', 0.37, 1], ['otro', 0.05, 0]]);
  });
  it('sólo el primer partido tras la baja, con valor y con cuota entre 1,20 y 15', () => {
    expect(returningPicks([pk('a', 0.2, 2), pk('b', -0.1), pk('c', 0.3, 1, 1.1), pk('d', 0.3, 1, 21)])).toEqual([]);
  });
});
