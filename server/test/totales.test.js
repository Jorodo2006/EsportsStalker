// Córneres y tarjetas del partido (football/totals.js): lo esperado de cada equipo y la probabilidad de más o menos de la línea
const test = require('node:test');
const assert = require('node:assert/strict');
const T = require('../services/football/totals');

// Un partido como lo guarda season.js: [id, nombre, escudo, córneres, remates, a puerta, amarillas, rojas, faltas]
const match = (h, a, ch, ca, yh = 2, ya = 2) => ({ t: [[h, h, '', ch, 10, 4, yh, 0, 12], [a, a, '', ca, 10, 4, ya, 0, 12]] });

test('las probabilidades de una binomial negativa suman 1 y su media es la pedida', () => {
  for (const r of [5, 25, Infinity]) {
    const P = T.pmf(9.5, r, 80);
    assert.ok(Math.abs(P.reduce((s, p) => s + p, 0) - 1) < 1e-6, `r=${r}`);
    assert.ok(Math.abs(P.reduce((s, p, x) => s + p * x, 0) - 9.5) < 1e-3, `r=${r}`);
  }
  const { over, under } = T.overUnder(9.5, 25, 9.5);
  assert.ok(Math.abs(over + under - 1) < 1e-9);
  assert.ok(over > 0.4 && over < 0.55);
});

test('el que saca muchos córneres contra el que concede muchos: más de lo normal', () => {
  const list = [match('A', 'X', 8, 3), match('A', 'Y', 9, 4), match('B', 'X', 4, 6), match('B', 'Y', 3, 7), match('X', 'Y', 5, 5)];
  const rates = T.ratesOf(list, 'corners');
  const k0 = T.expected(rates, 'A', 'B', { k: 0 }), big = T.expected(rates, 'A', 'B', { k: 1e9 });
  assert.ok(k0.a > big.a, 'A saca más que la media');
  assert.ok(Math.abs(big.mu - 2 * rates.avg) < 1e-6, 'con K enorme es la media de la liga');
  assert.equal(k0.games, 2);
  assert.equal(T.expected(rates, 'A', 'Z', { k: 2 }), null);
});

test('las tarjetas cuentan amarillas y rojas', () => {
  const m = { t: [['A', '', '', 0, 0, 0, 3, 1, 0], ['B', '', '', 0, 0, 0, 2, 0, 0]] };
  assert.equal(T.STATS.cards(m.t[0]), 4);
});
