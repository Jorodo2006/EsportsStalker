import { describe, expect, it } from 'vitest';
import { mondayOf, tuningHealth, weekly } from './model-weeks';
import type { ModelTuningRow, PredictionRow } from './types';

const row = (start: string, group: string, status: PredictionRow['status'], price = 2, p = 0.5, pMarket: number | null = 0.5): PredictionRow => ({
  sport: 'basket', group, league: 'NBA', book: 'Winamax', price, firstPrice: price, closePrice: null, p, pModel: p, pMarket, ev: 0, rel: 60,
  status, start, title: '', event: '', result: null
});
const tune = (day: string, kind: 'player' | 'team', prev: number, w: number): ModelTuningRow => ({
  day, kind, prev, fit: w, w, applied: prev !== w, reason: '', nFit: 0, nTest: 0, ll: { prev: null, next: null, market: null, model: null }
});

describe('Resumen semanal del modelo', () => {
  it('el lunes de la semana', () => {
    expect(mondayOf('2026-11-26')).toBe('2026-11-23'); // jueves
    expect(mondayOf('2026-11-23')).toBe('2026-11-23');
    expect(mondayOf('2026-11-29')).toBe('2026-11-23'); // domingo
  });
  it('separa por semanas en hora de España, de la más reciente a la más antigua', () => {
    // Domingo 22 a las 23:30 UTC ya es lunes 23 en España
    const w = weekly([row('2026-11-22T23:30:00Z', 'Puntos', 'won'), row('2026-11-20T20:00:00Z', 'Puntos', 'lost')], [], r => r.group);
    expect(w.map(x => [x.week, x.n, x.pl])).toEqual([['2026-11-23', 1, 1], ['2026-11-16', 1, -1]]);
  });
  it('nombra el mercado más rentable y el que peor ha ido sólo con casos suficientes', () => {
    const rs = [
      ...Array.from({ length: 10 }, (_, i) => row('2026-11-24T20:00:00Z', 'Puntos', i < 7 ? 'won' : 'lost')), // +4
      ...Array.from({ length: 10 }, (_, i) => row('2026-11-24T20:00:00Z', 'Rebotes', i < 3 ? 'won' : 'lost')), // −4
      ...Array.from({ length: 3 }, () => row('2026-11-24T20:00:00Z', 'Triples', 'won')) // +3, pero sólo 3
    ];
    const [w] = weekly(rs, [], r => r.group);
    expect(w.best?.key).toBe('Puntos');
    expect(w.worst?.key).toBe('Rebotes');
  });
  it('más preciso: el mercado donde la app acierta mejor que la casa (Brier)', () => {
    const rs = Array.from({ length: 20 }, (_, i) => row('2026-11-24T20:00:00Z', 'Puntos', i < 14 ? 'won' : 'lost', 1.8, 0.7, 0.5));
    const [w] = weekly(rs, [], r => r.group);
    expect(w.precise?.key).toBe('Puntos');
    expect(w.brier!.app).toBeLessThan(w.brier!.market);
  });
  it('lo que aprendió el reajuste en la semana: intentos, aplicados y de qué peso a qué peso', () => {
    const [w] = weekly([], [tune('2026-11-24', 'player', 0.3, 0.3), tune('2026-11-25', 'player', 0.3, 0.35), tune('2026-11-25', 'team', 0.25, 0.25)], r => r.group);
    expect(w.tuning).toEqual({ tries: 3, applied: 1, from: { player: 0.3, team: 0.25 }, to: { player: 0.35, team: 0.25 } });
    expect(w.n).toBe(0);
  });
});

describe('Salud del reajuste diario', () => {
  const feed = (days: string[]) => days.map(day => ({ day, n: 500 }));
  const week = ['2026-11-19', '2026-11-20', '2026-11-21', '2026-11-22', '2026-11-23', '2026-11-24', '2026-11-25'];
  it('bien: se ejecutó hoy y hay líneas de cada día', () => {
    expect(tuningHealth([tune('2026-11-26', 'player', 0.3, 0.3)], feed(week), '2026-11-26')).toMatchObject({ ok: true, stale: false, emptyDays: [] });
  });
  it('avisa si lleva más de un día sin ejecutarse', () => {
    expect(tuningHealth([tune('2026-11-24', 'player', 0.3, 0.3)], feed(week), '2026-11-26')).toMatchObject({ ok: false, stale: true });
    expect(tuningHealth([], feed(week), '2026-11-26').stale).toBe(true);
  });
  it('avisa de los días sin líneas guardadas', () => {
    const h = tuningHealth([tune('2026-11-26', 'player', 0.3, 0.3)], feed(week.filter(d => !['2026-11-19', '2026-11-24', '2026-11-25'].includes(d))), '2026-11-26');
    expect(h.emptyDays).toEqual(['2026-11-19', '2026-11-24', '2026-11-25']);
    expect(h.ok).toBe(false);
  });
  it('avisa si el último intento no tenía muestra suficiente', () => {
    const t = { ...tune('2026-11-26', 'team', 0.25, 0.25), reason: 'poca muestra (100 de ajuste, 20 de prueba)' };
    expect(tuningHealth([t], feed(week), '2026-11-26')).toMatchObject({ ok: false, lowSample: true });
  });
});
