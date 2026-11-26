import { describe, expect, it } from 'vitest';
import { cupRotation } from './basket-cup';
import type { BasketLogGame, BasketTeamLogs } from './types';

const game = (i: number, min: number, cup = false): BasketLogGame => ({
  id: `g${i}`, date: `2026-11-${String(i + 1).padStart(2, '0')}`, season: 2027, type: 'reg', home: true, opp: 'X', team: 'MIL', teamId: '15',
  result: 'G', score: '', min, pts: 10, reb: 5, ast: 3, stl: 1, blk: 0, tov: 2, fg3m: 1, ...(cup ? { cup: 'group' as const } : {})
});
// 8 partidos: los 2 últimos de la Cup. La estrella juega 34 en la liga y 38 en la Cup; el suplente 14 y 6; el de fondo no sale en la Cup
const p = (id: string, name: string, mins: number[]) => ({ id, name, pos: 'G', jersey: '', headshot: '', injury: null, games: mins.map((m, i) => game(i, m, i >= 6)) });
const data: BasketTeamLogs = {
  currentSeason: 2027,
  players: [
    p('s', 'Estrella', [34, 34, 34, 34, 34, 34, 38, 38]),
    p('t', 'Titular', [30, 30, 30, 30, 30, 30, 31, 31]),
    p('b', 'Suplente', [14, 14, 14, 14, 14, 14, 6, 6]),
    p('f', 'Fondo', [6, 6, 6, 6, 6, 6, 0, 0])
  ]
};

describe('NBA Cup: minutos', () => {
  it('compara los minutos de los partidos que jugó en la Cup con los de la liga', () => {
    const r = cupRotation(data, '15', '2026-12-01')!;
    expect(r.cupGames).toBe(2);
    // El de fondo de banquillo (6 min) no llega a 8 y no sale; no jugó en la Cup
    expect(r.players.map(x => [x.name, x.league, x.cup, x.nCup])).toEqual([['Estrella', 34, 38, 2], ['Titular', 30, 31, 2], ['Suplente', 14, 6, 2]]);
    expect(r.top2).toBe(2.5); // (+4 + +1) / 2
    expect(r.bench).toBe(-8); // el suplente; el de fondo no jugó en la Cup
    expect([r.rotLeague, r.rotCup]).toEqual([3, 2]);
  });
  it('los partidos de un jugador con su equipo anterior no cuentan', () => {
    const fichaje = { ...p('n', 'Fichaje', [0, 0, 0, 0, 0, 0, 0, 0]), games: [game(20, 36, true), game(21, 35, true)].map(g => ({ ...g, teamId: '4', id: `x${g.id}` })) };
    expect(cupRotation({ ...data, players: [...data.players, fichaje] }, '15', '2026-12-31')!.cupGames).toBe(2);
  });
  it('antes de su primer partido de Cup no hay nada que comparar', () => {
    const r = cupRotation(data, '15', '2026-11-07')!;
    expect([r.cupGames, r.top2, r.rotCup]).toEqual([0, null, null]);
  });
});
