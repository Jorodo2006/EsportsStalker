// Apuestas compartidas entre amigos: la copia que se guarda no lleva el importe, el resultado ni las notas de quien la envía;
// el estado se enseña el de ahora (stateOf) y sólo se puede copiar mientras está pendiente. Sin base de datos: npm test
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgres://nadie@localhost/nada'; // el pool no conecta hasta usarse
const { shareable, stateOf } = require('../services/bets/friends');

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

test('estado de ahora: pendiente se puede copiar; ganada, perdida o cash out, no', () => {
  assert.deepEqual(stateOf({ orig_status: 'pending', orig_legs: null }), { status: 'pending', legStatus: null, open: true });
  for (const s of ['won', 'lost', 'void', 'cashout', 'halfwon', 'halflost']) {
    const st = stateOf({ orig_status: s, orig_legs: null });
    assert.equal(st.status, s);
    assert.equal(st.open, false, s);
  }
});

test('sin la apuesta original (borrada o pasada antes) no se sabe el estado y se puede copiar, como antes', () => {
  assert.deepEqual(stateOf({ orig_status: null, orig_legs: null }), { status: null, legStatus: null, open: true });
  assert.deepEqual(stateOf({}), { status: null, legStatus: null, open: true });
});

test('en una combinada va el estado de cada selección; en una simple, no', () => {
  assert.deepEqual(stateOf({ orig_status: 'lost', orig_legs: ['won', 'lost', 'pending'] }).legStatus, ['won', 'lost', 'pending']);
  assert.equal(stateOf({ orig_status: 'won', orig_legs: ['won'] }).legStatus, null);
});
