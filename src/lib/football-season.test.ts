import { describe, expect, it } from 'vitest';
import { leagueAverages, playerLines, playerRows, teamLines, teamRows } from '@/lib/football-season';
import type { FootballSeasonStats } from '@/lib/types';

const team = (id: string, name: string, games: number, cf: number, ca: number, y: number, ya: number, log: number[][] = []) =>
  ({ id, name, logo: '', games, cornersFor: cf, cornersAgainst: ca, shots: games * 10, shotsOnTarget: games * 4, shotsAgainst: games * 9, yellow: y, yellowAgainst: ya, red: 0, fouls: 0, log });
const player = (id: string, name: string, t: string, games: number, shots: number, extra = {}) =>
  ({ id, name, team: t, games, starts: games, shots, shotsOnTarget: 0, goals: 0, assists: 0, fouls: 0, fouled: 0, yellow: 0, red: 0, log: [] as number[][], ...extra });

const stats: FootballSeasonStats = {
  season: '2026-27', games: 4, missing: 0,
  teams: [team('1', 'Newcastle Jets', 4, 30, 14, 5, 6), team('2', 'Sydney FC', 4, 16, 16, 11, 9)],
  players: [player('a', 'Brandon Borrello', '1', 4, 21), player('b', 'Suplente', '1', 1, 6), player('c', 'Ziereis', '2', 4, 2, { yellow: 2, red: 1 }), player('d', 'Álvaro', '2', 4, 8)]
};

describe('playerRows', () => {
  it('por tiros por partido, con un mínimo de partidos', () => {
    expect(playerRows(stats, 'shots', 3).map(p => p.name)).toEqual(['Brandon Borrello', 'Álvaro', 'Ziereis']);
    expect(playerRows(stats, 'shots', 1)[0].name).toBe('Suplente'); // 6 tiros en 1 partido
  });
  it('tarjetas: la roja cuenta como dos amarillas', () => {
    expect(playerRows(stats, 'cards', 1)[0]).toMatchObject({ name: 'Ziereis', value: 4 });
  });
  it('busca por jugador o equipo, sin acentos', () => {
    expect(playerRows(stats, 'shots', 1, 'alvaro').map(p => p.name)).toEqual(['Álvaro']);
    expect(playerRows(stats, 'shots', 1, 'sydney').map(p => p.name)).toEqual(['Álvaro', 'Ziereis']);
  });
});

describe('teamRows y leagueAverages', () => {
  it('córneres y tarjetas del partido por partido', () => {
    expect(teamRows(stats, 'corners')[0]).toMatchObject({ name: 'Newcastle Jets', value: 11 });
    expect(teamRows(stats, 'cards')[0]).toMatchObject({ name: 'Sydney FC', value: 5 });
  });
  it('medias de la liga', () => {
    const a = leagueAverages(stats);
    expect(a.games).toBe(4);
    expect(a.corners).toBeCloseTo((30 + 16) / 4);
  });
});

describe('líneas', () => {
  // remates de cada partido: Borrello 3, 0, 2, 4 (supera 1,5 en 3 de 4); Álvaro 2, 2, 2, 2 (4 de 4)
  const s: FootballSeasonStats = { ...stats, players: [
    player('a', 'Borrello', '1', 4, 9, { log: [[3, 1, 0, 0, 0], [0, 0, 1, 0, 0], [2, 1, 0, 0, 1], [4, 2, 0, 0, 0]] }),
    player('d', 'Álvaro', '2', 4, 8, { log: [[2, 0, 0, 0, 0], [2, 0, 0, 0, 0], [2, 0, 0, 0, 0], [2, 0, 0, 0, 0]] })
  ], teams: [team('1', 'Newcastle Jets', 3, 0, 0, 0, 0, [[6, 5, 1, 2, 10], [3, 4, 2, 2, 8], [8, 4, 0, 1, 12]]), team('2', 'Sydney FC', 1, 0, 0, 0, 0, [[2, 2, 3, 3, 5]])] };
  it('jugadores: en cuántos partidos supera la línea, ordenados por porcentaje', () => {
    const r = playerLines(s, 'shots', 1.5, 'over', 1);
    expect(r.map(p => [p.name, p.hits, p.n])).toEqual([['Álvaro', 4, 4], ['Borrello', 3, 4]]);
    expect(r[1].last.map(x => x.ok)).toEqual([true, false, true, true]);
  });
  it('menos de: lo contrario', () => {
    expect(playerLines(s, 'shots', 2.5, 'under', 1).map(p => [p.name, p.hits])).toEqual([['Álvaro', 4], ['Borrello', 2]]);
  });
  it('equipos: córneres del partido', () => {
    const r = teamLines(s, 'corners', 9.5, 'over');
    expect(r[0]).toMatchObject({ name: 'Newcastle Jets', hits: 2, n: 3 });
    expect(r[0].avg).toBeCloseTo((11 + 7 + 12) / 3);
  });
});
