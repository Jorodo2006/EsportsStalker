import { describe, expect, it } from 'vitest';
import { fromBasket, fromFootballLines, fromMmaLines, fromTennisBoard, windowDays } from './plan-sources';
import type { BasketPick } from './basket-picks';
import type { FootballLineRow, MmaLineRow, TennisBoard } from './types';

describe('windowDays', () => {
  it('da hoy, mañana y pasado en hora de España', () => {
    expect(windowDays(Date.parse('2026-11-18T10:00:00Z'))).toEqual(['2026-11-18', '2026-11-19', '2026-11-20']);
  });
  it('a las 23:30 UTC ya es el día siguiente en España', () => {
    expect(windowDays(Date.parse('2026-11-18T23:30:00Z'))).toEqual(['2026-11-19', '2026-11-20', '2026-11-21']);
  });
  it('en el cambio de hora de octubre no repite ni salta ningún día', () => {
    // 00:30 del 25 (CEST) + 48 h = 23:30 del 26 (CET): sólo dos días
    expect(windowDays(Date.parse('2026-10-24T22:30:00Z'))).toEqual(['2026-10-25', '2026-10-26']);
    // 23:59 del 24 + 48 h llega al 26: el 25, de 25 h, no se salta
    expect(windowDays(Date.parse('2026-10-24T21:59:00Z'))).toEqual(['2026-10-24', '2026-10-25', '2026-10-26']);
  });
});

const pk = (id: string, score = 66) => ({ id, title: `Gana ${id}`, book: 'Winamax', price: 1.5, p: 0.7, ev: -0.02, rel: { score } });

describe('adaptadores', () => {
  it('tenis: todas las líneas del tablero, con el mismo partido', () => {
    const board = { noOdds: [], matches: [{ m: { id: 't1', tournament: 'Torneo', date: '2026-11-18T15:00:00Z', a: { name: 'Nombre A' }, b: { name: 'Nombre B' } }, picks: [pk('x', 71), pk('y', 50), pk('z')] }] } as unknown as TennisBoard;
    const out = fromTennisBoard(board);
    expect(out).toHaveLength(3);
    expect(new Set(out.map(p => p.match)).size).toBe(1);
    expect(out[0]).toMatchObject({ sport: 'tennis', event: 'Nombre A vs Nombre B', league: 'Torneo', rel: 71, start: '2026-11-18T15:00:00Z', id: 'tennis:t1:x' });
  });
  it('fútbol: una fila por línea, con los equipos y la liga', () => {
    const row = (id: string) => ({ id: 'f1', leagueName: 'LaLiga', date: '2026-11-18T19:00:00Z', home: { name: 'Real' }, away: { name: 'Betis' }, pick: pk(id) });
    const out = fromFootballLines([row('x'), row('y'), row('x')] as unknown as FootballLineRow[]);
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ sport: 'football', event: 'Real vs Betis', league: 'LaLiga', match: 'football:f1' });
  });
  it('MMA usa los luchadores y la organización', () => {
    const r = { id: 'm1', orgName: 'UFC', date: '2026-11-19T02:00:00Z', a: { name: 'Uno' }, b: { name: 'Dos' }, pick: pk('x') } as unknown as MmaLineRow;
    expect(fromMmaLines([r])[0]).toMatchObject({ sport: 'mma', event: 'Uno vs Dos', league: 'UFC' });
  });
  it('baloncesto: las del navegador, con la liga y el partido', () => {
    const game = { id: 'g1', league: 'nba', date: '2026-11-19T01:00:00Z', away: { name: 'Golden State Warriors' }, home: { name: 'Dallas Mavericks' } };
    const b = (id: string) => ({ id, game, title: 'Total: más de 220,5', book: 'Betway', price: 1.9, p: 0.55, ev: 0.04, rel: { score: 60 } });
    const out = fromBasket([b('a'), b('b'), b('a')] as unknown as BasketPick[]);
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ sport: 'basket', match: 'basket:g1', event: 'Golden State Warriors @ Dallas Mavericks', league: 'NBA', rel: 60, start: '2026-11-19T01:00:00Z' });
  });
  // Al cupón con su partido y mercado: así la apuesta sale en «Tus apuestas» y se resuelve sola (antes iba sin ref)
  it('cada opción lleva su ref: el partido y la clave del mercado', () => {
    const row = { id: 'f1', leagueName: 'LaLiga', date: '2026-11-18T19:00:00Z', home: { name: 'Real' }, away: { name: 'Betis' }, pick: pk('total|0||2.5#over') };
    expect(fromFootballLines([row] as unknown as FootballLineRow[])[0].ref).toEqual({ sport: 'football', match: 'f1', key: 'total|0||2.5', out: 'over', start: '2026-11-18T19:00:00Z' });
    // Sin «clave#selección», sin ref
    expect(fromFootballLines([{ ...row, pick: pk('x') }] as unknown as FootballLineRow[])[0].ref).toBeUndefined();
    const game = { id: 'g1', league: 'nba', date: '2026-11-19T01:00:00Z', away: { name: 'A' }, home: { name: 'B' } };
    const player = { id: 'p', kind: 'player', marketKey: 'pts', who: { name: 'Stephen Curry' }, line: 24.5, side: 'over', game, title: '', price: 1.9, p: 0.5, ev: 0, rel: { score: 60 } };
    expect(fromBasket([player] as unknown as BasketPick[])[0].ref).toEqual({ sport: 'basket', match: 'g1', key: 'player|Puntos|stephen curry|24.5', out: 'over', start: '2026-11-19T01:00:00Z' });
  });
});
