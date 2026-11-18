const test = require('node:test');
const assert = require('node:assert');
const { isOtherMatch } = require('../services/odds/otro-partido');

// Knicks - Raptors: el trabajo es del 18 de noviembre (00:30 UTC) y la dirección guardada llevaba al del 15, ya terminado
const job = Date.parse('2026-11-18T00:30:00Z');
const now = Date.parse('2026-11-17T23:50:00Z');

test('el partido anterior entre los mismos equipos se reconoce', () => {
  assert.strictEqual(isOtherMatch(job, { matchStart: 1794784500, status: 'ENDED' }, now), true);
  assert.strictEqual(isOtherMatch(job, { matchStart: 1794784500, status: 'PREMATCH' }, now), true); // a 2 días, aunque no diga terminado
});

test('el de esta noche vale, aunque la hora no coincida al minuto', () => {
  assert.strictEqual(isOtherMatch(job, { matchStart: job / 1000 + 600, status: 'PREMATCH' }, now), false);
  assert.strictEqual(isOtherMatch(job, { matchStart: job / 1000, status: 'LIVE' }, job + 3600e3), false);
});

test('terminado cuando el nuestro aún no ha empezado; sin datos, no se rechaza', () => {
  assert.strictEqual(isOtherMatch(job, { status: 'ENDED' }, now), true);
  assert.strictEqual(isOtherMatch(job, { matchStart: job / 1000, status: 'ENDED' }, job + 3 * 3600e3), false); // ya jugado: es este
  assert.strictEqual(isOtherMatch(null, { matchStart: 1, status: 'ENDED' }, now), false);
  assert.strictEqual(isOtherMatch(job, undefined, now), false);
});
