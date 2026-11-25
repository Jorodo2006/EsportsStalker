// Cuota de cierre para el CLV: qué partido del comparador es el de la apuesta, qué cuota estaba vigente al empezar y cuál cuenta
const test = require('node:test');
const assert = require('node:assert');
const { pickMatch, closeOf } = require('../services/odds/closing');
const { chooseClose, pendingOf, bookOf } = require('../services/bets/closing');

const START = '2026-11-20T19:00:00.000Z';
const match = (a, b, start = START, sport = 'football') => ({ key: `${a}|${b}`, a: { name: a, code: '' }, b: { name: b, code: '' }, start, sport });

test('el partido del comparador: mismo deporte, inicio cercano y los dos equipos en el texto', () => {
  const list = [match('Albacete', 'Celta'), match('Albacete', 'Celta', '2026-11-27T19:00:00.000Z'), match('Albacete', 'Celta', START, 'basket'), match('Elche', 'Celta')];
  const item = { sport: 'football', start: '2026-11-20T19:30:00.000Z', event: 'Albacete - Celta' };
  assert.strictEqual(pickMatch(item, list), list[0]);
  assert.strictEqual(pickMatch({ ...item, event: 'Albacete - Elche' }, list), null);
  assert.strictEqual(pickMatch({ ...item, sport: 'tennis' }, list), null);
});

test('la cuota vigente al empezar, sólo si se vio cerca del inicio', () => {
  const rows = [
    { book: 'winamax', price: 2.1, ts: '2026-11-20T10:00:00Z', last_seen: '2026-11-20T15:00:00Z' },
    { book: 'winamax', price: 1.95, ts: '2026-11-20T15:05:00Z', last_seen: '2026-11-20T20:00:00Z' }, // vigente al empezar
    { book: 'winamax', price: 1.5, ts: '2026-11-20T19:20:00Z', last_seen: '2026-11-20T19:40:00Z' }, // ya en juego: no cuenta
    { book: 'betway', price: 2.0, ts: '2026-11-19T10:00:00Z', last_seen: '2026-11-20T12:00:00Z' } // vista 7 h antes: no es cierre
  ];
  assert.deepStrictEqual(closeOf(rows, START), { winamax: { price: 1.95, at: START } });
});

test('cuenta la de la misma casa; si no, la mejor', () => {
  const books = { winamax: { price: 1.9, at: START }, betway: { price: 2.05, at: START } };
  assert.strictEqual(chooseClose(books, 'Winamax').price, 1.9);
  assert.deepStrictEqual(chooseClose(books, 'bet365'), { book: 'betway', price: 2.05, at: START });
  assert.strictEqual(chooseClose({}, 'Winamax'), null);
  assert.strictEqual(bookOf('BETWAY'), 'betway');
});

test('qué selecciones necesitan la cuota de cierre', () => {
  const now = +new Date(START) + 3600e3;
  const ref = { sport: 'football', match: '1', key: 'moneyline|0||', out: 'a', start: START };
  const simple = { event: 'Albacete - Celta', sport: 'football', ref };
  assert.deepStrictEqual(pendingOf(simple, [], now).map(x => x.pos), [-1]);
  // Ya la tiene, de la misma selección
  assert.deepStrictEqual(pendingOf(simple, [{ pos: -1, match: '1', key: 'moneyline|0||', out: 'a' }], now), []);
  // La tenía de otra (se editó la apuesta): otra vez
  assert.strictEqual(pendingOf(simple, [{ pos: -1, match: '1', key: 'moneyline|0||', out: 'b' }], now).length, 1);
  // No ha empezado todavía
  assert.deepStrictEqual(pendingOf(simple, [], +new Date(START)), []);
  // Combinada: cada selección con ref
  const combo = { event: '', sport: 'mix', legs: [{ event: 'A - B', ref }, { event: 'C - D' }, { event: 'E - F', ref: { ...ref, match: '2' } }] };
  assert.deepStrictEqual(pendingOf(combo, [], now).map(x => x.pos), [0, 2]);
});
