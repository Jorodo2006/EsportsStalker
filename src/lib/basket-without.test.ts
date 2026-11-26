import { describe, expect, it } from 'vitest';
import { keyAbsentee, withoutSplits } from './basket-without';
import type { BasketLogGame, BasketTeamLogs } from './types';

const game = (i: number, s: Partial<BasketLogGame> = {}): BasketLogGame => ({
  id: `g${i}`, date: `2026-11-${String(i + 1).padStart(2, '0')}`, season: 2027, type: 'reg', home: true, opp: 'X', team: 'DET', teamId: '8',
  result: 'G', score: '', min: 30, pts: 10, reb: 5, ast: 3, stl: 1, blk: 0, tov: 2, fg3m: 1, ...s
});
const player = (id: string, name: string, games: BasketLogGame[]) => ({ id, name, pos: 'G', jersey: '', headshot: '', injury: null, games });

// 10 partidos: la estrella juega los 6 primeros; el base suplente reparte 3 con ella y 8 sin ella
const star = player('star', 'Estrella', Array.from({ length: 10 }, (_, i) => game(i, i < 6 ? { min: 35, pts: 28, ast: 9 } : { min: 0, pts: 0, ast: 0 })));
const backup = player('b', 'Suplente', Array.from({ length: 10 }, (_, i) => game(i, i < 6 ? { min: 22, ast: 3, pts: 9 } : { min: 32, ast: 8, pts: 11 })));
const steady = player('s', 'Fijo', Array.from({ length: 10 }, (_, i) => game(i, { reb: i < 6 ? 7 : 7.4 })));
const data: BasketTeamLogs = { currentSeason: 2027, players: [star, backup, steady] };

describe('sin X', () => {
  it('la estrella es importante: juega la mitad de los partidos con más de 20 minutos', () => {
    expect(keyAbsentee(data, 'star', '2026-12-01')).toMatchObject({ name: 'Estrella', games: 6, teamGames: 10 });
    expect(keyAbsentee(data, 'b', '2026-12-01')).not.toBeNull();
    expect(keyAbsentee(data, 'nadie', '2026-12-01')).toBeNull();
  });
  it('el suplente reparte más sin ella; lo que apenas cambia no sale', () => {
    const rows = withoutSplits(data, 'star', '2026-12-01');
    // Asistencias de 3 a 8 (+167 %) primero; puntos de 9 a 11 (+22 %) después; los rebotes del fijo (7 → 7,4) no salen
    expect(rows.map(r => [r.name, r.market, r.withAvg, r.withoutAvg, r.nWith, r.nWithout])).toEqual([['Suplente', 'ast', 3, 8, 6, 4], ['Suplente', 'pts', 9, 11, 6, 4]]);
  });
  it('sólo cuenta lo de antes del partido, y hacen falta 3 partidos sin él', () => {
    // Antes del 10 de noviembre hay 3 partidos sin ella (el 7, el 8 y el 9); antes del 9, sólo 2
    expect(withoutSplits(data, 'star', '2026-11-10')[0]?.nWithout).toBe(3);
    expect(withoutSplits(data, 'star', '2026-11-09')).toEqual([]);
  });
  it('ni los de fondo de banquillo ni los que tampoco juegan hoy', () => {
    const bench = player('x', 'Banquillo', Array.from({ length: 10 }, (_, i) => game(i, i < 6 ? { min: 4, pts: 0 } : { min: 9, pts: 4 })));
    const d2: BasketTeamLogs = { ...data, players: [...data.players, bench] };
    expect(withoutSplits(d2, 'star', '2026-12-01').map(r => r.name)).toEqual(['Suplente', 'Suplente']);
    expect(withoutSplits(d2, 'star', '2026-12-01', id => id === 'b')).toEqual([]);
  });
});
