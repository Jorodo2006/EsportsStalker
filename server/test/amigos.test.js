// Apuestas compartidas entre amigos: lo que se envía no lleva el importe, el resultado ni las notas de quien la envía.
// Sin base de datos: npm test
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgres://nadie@localhost/nada'; // el pool no conecta hasta usarse
const { shareable } = require('../services/bets/friends');

const simple = {
  id: 'x', sport: 'basket', date: '2026-11-15', league: 'NBA', event: 'LAL @ MIL', market: 'Puntos · Ziaire Williams', selection: 'Más de 9.5',
  bookmaker: 'Betway', odds: 2.3, stake: 50, status: 'won', cashout: 0, notes: 'mi banca está en 300',
  ref: { sport: 'basket', match: 'nba:401909971', key: 'player|Puntos|ziaire williams|9.5', out: 'over' }
};

test('una simple: lo apostado y su partido, sin importe, resultado ni notas', () => {
  const s = shareable(simple);
  assert.equal(s.selection, 'Más de 9.5');
  assert.equal(s.odds, 2.3);
  assert.deepEqual(s.ref, simple.ref);
  for (const k of ['stake', 'status', 'cashout', 'notes', 'id']) assert.equal(k in s, false, k);
});

test('una combinada lleva sus selecciones, sin el estado de cada una', () => {
  const s = shareable({ ...simple, legs: [
    { event: 'A', league: 'NBA', market: 'Ganador', selection: 'A', odds: 1.5, status: 'won', sport: 'basket' },
    { event: 'B', league: 'NBA', market: 'Ganador', selection: 'B', odds: 2, status: 'lost', sport: 'basket' }
  ] });
  assert.equal(s.legs.length, 2);
  assert.equal('status' in s.legs[0], false);
  assert.equal('ref' in s, false); // la combinada se resuelve por sus selecciones
});
