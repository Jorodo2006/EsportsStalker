// NBA Cup en los partidos de ESPN: qué es (cupOf, la misma regla que cupKind de src/lib/basket-context.ts) y la ronda en español
const test = require('node:test');
const assert = require('node:assert');
const { cupOf, cupRound } = require('../services/basket/espn');

test('la nota de ESPN dice si es NBA Cup y de qué fase', () => {
  assert.strictEqual(cupOf('NBA Cup - Group Play'), 'group');
  assert.strictEqual(cupOf('NBA Cup - Quarterfinals'), 'ko');
  assert.strictEqual(cupOf('NBA Cup Championship'), 'ko');
  assert.strictEqual(cupOf('NBA London Game 2026'), null);
  assert.strictEqual(cupOf(''), null);
});

test('la ronda que sale en la ficha', () => {
  assert.strictEqual(cupRound('NBA Cup - Group Play'), 'NBA Cup · Fase de grupos');
  assert.strictEqual(cupRound('NBA Cup - Quarterfinals'), 'NBA Cup · Cuartos');
  assert.strictEqual(cupRound('NBA Cup - Semifinals'), 'NBA Cup · Semifinal');
  assert.strictEqual(cupRound('NBA Cup Championship'), 'NBA Cup · Final');
  assert.strictEqual(cupRound('West 1st Round - Game 1'), '');
});
