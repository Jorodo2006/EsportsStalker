// Bajas en los puntos de equipo (basket-absences.ts): qué cuenta como baja de un habitual, cuánto se resta (lo medido con
// scripts/backtest-puntos.ts) y cómo se reparte por tramos
import { describe, expect, it } from 'vitest';
import { ABSENCE, lineupDelta, playChance, teamOuts, withOuts } from './basket-absences';
import type { PointProjection, TeamRow } from './basket-teams';
import type { BasketTeamLogs } from './types';

// Diez partidos del equipo esta temporada, del más reciente al más antiguo, todos con el mismo peso
const pool = Array.from({ length: 10 }, (_, i) => ({ id: `g${i}`, season: 2027, date: `2026-11-${String(15 - i).padStart(2, '0')}T01:00:00Z` })) as unknown as TeamRow[];
const weights = pool.map(() => 1);
const games = (pts: number, ids: string[]) => ids.map(id => ({ id, date: pool.find(r => r.id === id)!.date, teamId: 'GS', min: 32, pts, type: 'reg' as const }));
const all = pool.map(r => r.id);
const logs = (players: { id: string; name: string; pts: number; ids: string[]; injury?: string }[]) =>
  ({ currentSeason: 2027, players: players.map(p => ({ id: p.id, name: p.name, injury: p.injury ?? null, games: games(p.pts, p.ids) })) }) as unknown as BasketTeamLogs;
const BEFORE = '2026-11-19T02:00:00Z';

describe('playChance', () => {
  it('lo que dice el parte', () => {
    expect(playChance('Out')).toBe(0);
    expect(playChance('Doubtful')).toBe(0.25);
    expect(playChance('Questionable')).toBe(0.5);
    expect(playChance('Day-To-Day')).toBe(0.7);
    expect(playChance(null)).toBe(1);
  });
});

describe('lineupDelta', () => {
  it('falta el que estaba en toda la muestra: se pierden sus puntos; si estaba en la mitad, la mitad', () => {
    const team = logs([{ id: 'curry', name: 'Stephen Curry', pts: 28, ids: all }, { id: 'b', name: 'B', pts: 10, ids: all.slice(0, 5) }]).players;
    const r = lineupDelta(team, 'GS', pool, weights, () => 0, BEFORE);
    expect(r.changes.find(c => c.id === 'curry')!.delta).toBeCloseTo(-28);
    expect(r.changes.find(c => c.id === 'b')!.delta).toBeCloseTo(-5);
  });
  it('una baja de semanas ya está en la muestra (no cambia) y el que vuelve suma', () => {
    const team = logs([{ id: 'x', name: 'X', pts: 20, ids: ['g9'] }]).players;
    expect(lineupDelta(team, 'GS', pool, weights, () => 1, BEFORE).changes[0].delta).toBeCloseTo(18); // vuelve: estaba en 1 de 10
  });
});

describe('teamOuts', () => {
  it('Curry y otro titular fuera: baja grande, se resta lo medido', () => {
    const data = logs([
      { id: 'curry', name: 'Stephen Curry', pts: 28, ids: all, injury: 'Out' },
      { id: 'w', name: 'Brandon Williams', pts: 10, ids: all, injury: 'Out' },
      { id: 'g', name: 'Draymond Green', pts: 9, ids: all }
    ]);
    const o = teamOuts(data, 'GS', { pool, weights }, BEFORE, (_id, roster) => roster);
    expect(o.outs.map(c => c.name)).toEqual(['Stephen Curry', 'Brandon Williams']);
    expect(o.delta).toBeCloseTo(-38);
    expect(o.big).toBe(true);
    expect(o.shift).toBeCloseTo(ABSENCE.k * -38);
  });
  it('una baja pequeña no cambia la proyección; un no habitual no cuenta', () => {
    const data = logs([
      { id: 'a', name: 'A', pts: 8, ids: all, injury: 'Out' },
      { id: 'n', name: 'Novato', pts: 15, ids: ['g0', 'g1'], injury: 'Out' } // 2 de los 10 últimos: no es habitual
    ]);
    const o = teamOuts(data, 'GS', { pool, weights }, BEFORE, (_id, roster) => roster);
    expect(o.outs.map(c => c.name)).toEqual(['A']);
    expect(o.big).toBe(false);
    expect(o.shift).toBe(0);
  });
});

describe('withOuts', () => {
  const P = { period: 'h1', away: { mu: 55, sd: 8 }, home: { mu: 54, sd: 8 }, total: { mu: 109, sd: 12 } } as unknown as PointProjection;
  it('en una mitad se resta la mitad', () => {
    const big = { delta: -40, shift: -2, big: true, outs: [] };
    const none = { delta: 0, shift: 0, big: false, outs: [] };
    const Q = withOuts(P, big, none);
    expect(Q.away.mu).toBeCloseTo(54);
    expect(Q.total.mu).toBeCloseTo(108);
    expect(Q.home.mu).toBe(54);
  });
});
