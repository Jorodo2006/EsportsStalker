// Surebets entre Winamax y Betway (odds/surebets.js): qué mercados se pueden cubrir y cuándo hay beneficio seguro
const test = require('node:test');
const assert = require('node:assert/strict');
const { arbsOf } = require('../services/odds/surebets');

const market = (key, outcomes) => ({ key, group: key, outcomes: outcomes.map(([id, prices]) => ({ id, label: id, prices })) });

test('dos salidas, cada una mejor en una casa: surebet con la mejor de cada una', () => {
  const r = arbsOf({ markets: [market('total|0||210.5', [['over', { Winamax: 2.1, Betway: 1.9 }], ['under', { Winamax: 1.8, Betway: 2.05 }]])] });
  assert.equal(r.length, 1);
  assert.deepEqual(r[0].legs.map(l => [l.id, l.book, l.price]), [['over', 'Winamax', 2.1], ['under', 'Betway', 2.05]]);
  assert.equal(r[0].edge, Math.round((1 / (1 / 2.1 + 1 / 2.05) - 1) * 1e4) / 1e4);
});

test('sin beneficio, de una sola casa, incompleta o demasiado buena: nada', () => {
  const none = [
    market('moneyline|0||', [['a', { Winamax: 1.9, Betway: 1.85 }], ['b', { Winamax: 1.95, Betway: 1.9 }]]), // margen normal
    market('btts|0||', [['yes', { Winamax: 2.2 }], ['no', { Winamax: 2.2 }]]), // una sola casa
    market('moneyline|0||', [['a', { Winamax: 3 }], ['x', {}], ['b', { Betway: 3.5 }]]), // falta el empate
    market('total|0||5.5', [['over', { Winamax: 3 }], ['under', { Betway: 3 }]]) // un 50 %: línea mal leída
  ];
  for (const m of none) assert.deepEqual(arbsOf({ markets: [m] }), [], m.key);
});

test('la doble oportunidad y los mercados propios de una casa no se cubren', () => {
  const p = [['1x', { Winamax: 2.5 }], ['12', { Betway: 2.5 }], ['x2', { Winamax: 2.5 }]];
  assert.deepEqual(arbsOf({ markets: [market('double|0||', p), market('wmx|Algo|', [['a', { Winamax: 2.2 }], ['b', { Betway: 2.2 }]])] }), []);
});

test('fútbol 1X2 con las tres', () => {
  const r = arbsOf({ markets: [market('moneyline|0||', [['a', { Winamax: 2.9, Betway: 2.7 }], ['x', { Winamax: 3.3, Betway: 3.6 }], ['b', { Winamax: 3.1, Betway: 3.0 }]])] });
  assert.equal(r.length, 1);
  assert.equal(r[0].legs.length, 3);
});

test('el método de MMA no se cubre: A y B por KO pierden las dos si va a decisión', () => {
  assert.deepEqual(arbsOf({ markets: [market('method|0|ko|', [['a', { Winamax: 2.6 }], ['b', { Betway: 2.6 }]])] }), []);
});
