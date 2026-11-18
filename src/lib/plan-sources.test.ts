import { describe, expect, it } from 'vitest';
import { fromFootball, fromMma, fromTennis, windowDays } from './plan-sources';
import type { FootballDayPick, MmaDayPick, TennisDayPick } from './types';

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
  it('tenis: top y hard con el mismo partido', () => {
    const m = { id: 't1', tournament: 'Torneo', date: '2026-11-18T15:00:00Z', a: { name: 'Nombre A' }, b: { name: 'Nombre B' }, top: pk('x', 71), hard: pk('y', 50) } as unknown as TennisDayPick;
    const out = fromTennis([m]);
    expect(out).toHaveLength(2);
    expect(out[0].match).toBe(out[1].match);
    expect(out[0]).toMatchObject({ sport: 'tennis', event: 'Nombre A vs Nombre B', league: 'Torneo', rel: 71, start: '2026-11-18T15:00:00Z', id: 'tennis:t1:x' });
    expect(fromTennis([{ ...m, hard: null } as unknown as TennisDayPick])).toHaveLength(1);
  });
  it('fútbol usa los nombres de los equipos y la liga', () => {
    const m = { id: 'f1', leagueName: 'LaLiga', date: '2026-11-18T19:00:00Z', home: { name: 'Real' }, away: { name: 'Betis' }, top: pk('x'), hard: null } as unknown as FootballDayPick;
    expect(fromFootball([m])[0]).toMatchObject({ sport: 'football', event: 'Real vs Betis', league: 'LaLiga', match: 'football:f1' });
  });
  it('MMA usa los luchadores y la organización', () => {
    const m = { id: 'm1', orgName: 'UFC', date: '2026-11-19T02:00:00Z', a: { name: 'Uno' }, b: { name: 'Dos' }, top: pk('x'), hard: null } as unknown as MmaDayPick;
    expect(fromMma([m])[0]).toMatchObject({ sport: 'mma', event: 'Uno vs Dos', league: 'UFC' });
  });
  it('el mismo partido en dos listas no duplica sus apuestas', () => {
    const m = { id: 't1', tournament: 'T', date: '2026-11-18T15:00:00Z', a: { name: 'A' }, b: { name: 'B' }, top: pk('x'), hard: pk('y') } as unknown as TennisDayPick;
    expect(fromTennis([m, m])).toHaveLength(2);
  });
});
