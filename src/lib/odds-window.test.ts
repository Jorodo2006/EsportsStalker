// Cuándo se leen solas las cuotas (las reglas de server/services/odds/scheduler.js) y lo que se le dice al usuario
import { describe, expect, it } from 'vitest';
import { aheadHours, cardNote, oddsExplanation } from './odds-window';

const inHours = (h: number) => new Date(Date.now() + h * 3600e3).toISOString();

describe('aheadHours', () => {
  it('con las lecturas lejanas encendidas, todo desde 48 h antes', () => {
    for (const sport of ['lol', 'basket', 'tennis', 'football', 'mma'] as const) expect(aheadHours({ sport }, {})).toBe(48);
  });
  it('con las lejanas apagadas, oddsAutoHours, y tenis, fútbol y MMA 3 h como mucho', () => {
    const s = { oddsFarEnabled: false, oddsAutoHours: 6 };
    expect(aheadHours({ sport: 'basket' }, s)).toBe(6);
    expect(aheadHours({ sport: 'football' }, s)).toBe(3);
  });
  it('Challenger desde 12 h; previas y lecturas apagadas, nunca', () => {
    expect(aheadHours({ sport: 'tennis', challenger: true }, {})).toBe(12);
    expect(aheadHours({ sport: 'tennis', challenger: true }, { challengerOddsEnabled: false })).toBeNull();
    expect(aheadHours({ sport: 'tennis', qualifying: true }, {})).toBeNull();
    expect(aheadHours({ sport: 'basket' }, { oddsAutoEnabled: false })).toBeNull();
  });
});

describe('textos', () => {
  it('la tarjeta dice desde cuándo, o que aún no hay', () => {
    expect(cardNote(inHours(60), { sport: 'football' }, {})).toMatch(/^Cuotas desde el /);
    expect(cardNote(inHours(20), { sport: 'football' }, {})).toBe('Sin cuotas todavía');
    expect(cardNote(inHours(20), { sport: 'basket' }, { oddsAutoEnabled: false })).toBe('Sin cuotas');
  });
  it('la pestaña dice lo que contestó cada casa, sin la nota interna de la foto', () => {
    const t = oddsExplanation(inHours(30), { sport: 'football' }, {}, {
      Betway: { ok: false, msg: 'No encuentro el partido en Betway (he guardado una foto de la lista)', ts: Date.now() }
    }).join(' ');
    expect(t).toContain('«No encuentro el partido en Betway»');
    expect(t).not.toContain('foto');
  });
  it('en baloncesto avisa de que las líneas de jugador salen el mismo día', () => {
    expect(oddsExplanation(inHours(30), { sport: 'basket' }, {}, {}).join(' ')).toMatch(/mismo día/);
  });
});
