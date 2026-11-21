import { describe, expect, it } from 'vitest';
import { findPlayer, playerOf, trackOf, type LiveGame, type LivePlayer } from './bet-track';

const pl = (name: string, o: Partial<LivePlayer> = {}): LivePlayer => ({ name, min: 20, pts: 0, reb: 0, ast: 0, stl: 0, blk: 0, tov: 0, fg3: '0-0', ...o });
const game = (o: Partial<LiveGame> & { sc?: Record<number, [number, number]> } = {}): LiveGame => ({
  state: 'in', score: p => o.sc?.[p] ?? null, ...o
});

describe('seguimiento de apuestas en juego', () => {
  it('sin empezar no se enseña nada', () => {
    expect(trackOf({ sport: 'basket', key: 'total|0||220.5', out: 'over' }, game({ state: 'pre', sc: { 0: [0, 0] } }))).toBeNull();
  });

  it('línea de jugador: su cifra frente a la línea, encontrándolo como la resolución', () => {
    const g = game({ players: [pl('Jake LaRavia', { pts: 12, reb: 4, ast: 2 }), pl('Donovan Mitchell'), pl('Davion Mitchell')] });
    const t = trackOf({ sport: 'basket', key: 'player|Puntos|jake laravia|14.5', out: 'over' }, g);
    expect(t).toMatchObject({ kind: 'bar', value: 12, line: 14.5, mood: 'even', done: false, player: 'Jake LaRavia' });
    expect(trackOf({ sport: 'basket', key: 'player|Pts + Reb + Ast|jake laravia|16.5', out: 'over' }, g)).toMatchObject({ value: 18, mood: 'good', done: true });
    expect(trackOf({ sport: 'basket', key: 'player|Puntos|jake laravia|10.5', out: 'under' }, g)).toMatchObject({ mood: 'bad', done: true });
    // «D. Mitchell» encaja con dos: no se adivina, y se cuenta como si aún no hubiera jugado
    expect(findPlayer(g.players!, 'D. Mitchell')).toBeNull();
    expect(findPlayer(g.players!, 'J. LaRavia')?.name).toBe('Jake LaRavia');
    expect(playerOf({ key: 'player|Puntos|jake laravia|14.5' })).toBe('jake laravia');
    expect(playerOf({ key: 'total|0||220.5' })).toBeNull();
  });

  it('un «más de» que no llega se da por perdido al acabar', () => {
    const t = trackOf({ sport: 'basket', key: 'total|0||220.5', out: 'over' }, game({ state: 'post', sc: { 0: [105, 110] } }));
    expect(t).toMatchObject({ kind: 'bar', value: 215, mood: 'bad', done: true });
  });

  it('ganador, hándicap y totales de equipo con el marcador orientado como la clave', () => {
    const g = game({ sc: { 0: [50, 54], 11: [20, 30] } });
    expect(trackOf({ sport: 'basket', key: 'moneyline|0||', out: 'b' }, g)).toEqual({ kind: 'lead', mood: 'good', text: 'Gana de 4' });
    expect(trackOf({ sport: 'basket', key: 'spread|0||+5.5', out: 'a' }, g)).toMatchObject({ mood: 'good', text: 'Cubre por 1,5' });
    expect(trackOf({ sport: 'basket', key: 'spread|0||+5.5', out: 'b' }, g)).toMatchObject({ mood: 'bad', text: 'Le faltan 1,5' });
    expect(trackOf({ sport: 'basket', key: 'team_total|11|b|28.5', out: 'over' }, g)).toMatchObject({ value: 30, mood: 'good' });
    // Un periodo sin datos: nada
    expect(trackOf({ sport: 'basket', key: 'total|12||50.5', out: 'over' }, g)).toBeNull();
  });

  it('fútbol: empate, ambos marcan y goleador', () => {
    const g = game({ sc: { 0: [1, 1] }, scorers: ['Kylian Mbappé', 'Lamine Yamal'] });
    expect(trackOf({ sport: 'football', key: 'moneyline|0||', out: 'x' }, g)).toMatchObject({ mood: 'good' });
    expect(trackOf({ sport: 'football', key: 'btts|0||', out: 'yes' }, g)).toMatchObject({ mood: 'good' });
    expect(trackOf({ sport: 'football', key: 'btts|0||', out: 'no' }, g)).toMatchObject({ mood: 'bad' });
    expect(trackOf({ sport: 'football', key: 'wmx|Goleador|', out: 'x' }, g, 'Kylian Mbappe')).toMatchObject({ value: 1, mood: 'good', done: true });
    expect(trackOf({ sport: 'football', key: 'wmx|Marca 2 goles o más|', out: 'x' }, g, 'Kylian Mbappé')).toMatchObject({ value: 1, line: 1.5, mood: 'even' });
  });

  it('tenis: el ganador va por sets; MMA sólo al acabar', () => {
    expect(trackOf({ sport: 'tennis', key: 'moneyline|0||', out: 'b' }, game({ sets: [1, 0], sc: { 0: [9, 7] } }))).toMatchObject({ mood: 'bad', text: 'Pierde 0-1 en sets' });
    expect(trackOf({ sport: 'tennis', key: 'total|0||22.5', out: 'under' }, game({ sets: [1, 0], sc: { 0: [9, 7] } }))).toMatchObject({ value: 16, mood: 'good' });
    expect(trackOf({ sport: 'mma', key: 'moneyline|0||', out: 'a' }, game())).toBeNull();
    expect(trackOf({ sport: 'mma', key: 'moneyline|0||', out: 'a' }, game({ state: 'post', winner: 'a' }))).toMatchObject({ mood: 'good', text: 'Ha ganado' });
  });
});
