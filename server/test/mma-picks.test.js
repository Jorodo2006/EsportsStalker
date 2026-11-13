const test = require('node:test');
const assert = require('node:assert');
const M = require('../services/mma/model');
const { buildPicks } = require('../services/mma/picks');

const fight = { id: 'ufc:1', org: 'ufc', state: 'pre', rounds: 3, a: { name: 'Ilia Topuria', alt: ['Topuria'] }, b: { name: 'Max Holloway', alt: ['Holloway'] } };
const pred = M.predict({ elo: 1650, fights: 12, record: '' }, { elo: 1500, fights: 12, record: '' }, { org: 'ufc', rounds: 3 });
const line = (key, group, outcomes, extra = {}) => ({ key, group, period: 0, line: null, outcomes, ...extra });
const o = (id, label, prices) => ({ id, label, prices });
const odds = {
  sources: { winamax: { ts: Date.now() } },
  markets: [
    line('moneyline|0||', 'Ganador', [o('a', 'Ilia Topuria', { winamax: 1.4 }), o('b', 'Max Holloway', { winamax: 3.1 })]),
    line('method|0|ko|', 'Gana por KO/TKO', [o('a', 'Ilia Topuria', { winamax: 2.6 }), o('b', 'Max Holloway', { winamax: 7 })]),
    line('distance|0||', 'El combate llega a decisión', [o('yes', 'Sí', { winamax: 2.1 }), o('no', 'No', { winamax: 1.7 })]),
    line('total_rounds|0||2.5', 'Total de asaltos', [o('over', 'Más de 2.5', { winamax: 1.9 }), o('under', 'Menos de 2.5', { winamax: 1.9 })], { line: 2.5 }),
    line('moneyline|0||x', 'Mercado raro', [o('a', 'sin cuota', {})])
  ]
};

test('cada mercado conocido da una selección con su probabilidad del modelo', () => {
  const { all } = buildPicks(fight, pred, odds);
  const by = id => all.find(p => p.id === id);
  const win = by('moneyline|0||#a');
  assert.strictEqual(win.family, 'Ganador');
  assert.strictEqual(win.side, 'a');
  assert.ok(Math.abs(win.pModel - pred.pA) < 1e-9);
  assert.ok(Math.abs(by('moneyline|0||#b').pModel - pred.pB) < 1e-9);
  assert.ok(Math.abs(by('method|0|ko|#a').pModel - pred.joint.a.ko) < 1e-9);
  assert.ok(Math.abs(by('distance|0||#yes').pModel - pred.goesDistance) < 1e-9);
  assert.ok(Math.abs(by('total_rounds|0||2.5#over').pModel + by('total_rounds|0||2.5#under').pModel - 1) < 1e-9);
  assert.ok(Math.abs(by('total_rounds|0||2.5#over').pModel - M.pOver(pred, 3, 12.5)) < 1e-9);
});

test('la probabilidad final mezcla modelo y casa, y el valor es p·cuota−1', () => {
  const { all } = buildPicks(fight, pred, odds);
  const w = all.find(p => p.id === 'moneyline|0||#a');
  const lo = Math.min(w.pModel, w.pMarket), hi = Math.max(w.pModel, w.pMarket);
  assert.ok(w.p >= lo - 1e-9 && w.p <= hi + 1e-9);
  assert.ok(Math.abs(w.ev - (w.p * w.price - 1)) < 1e-9);
  assert.strictEqual(w.book, 'winamax');
});

test('las cuotas se quitan de márgenes sumando el mercado completo', () => {
  const { all } = buildPicks(fight, pred, odds);
  const a = all.find(p => p.id === 'moneyline|0||#a'), b = all.find(p => p.id === 'moneyline|0||#b');
  assert.ok(Math.abs(a.pMarket + b.pMarket - 1) < 1e-9);
});

test('sin cuotas, sin selecciones, y sin pronóstico si el combate ya no es pendiente', () => {
  const none = buildPicks(fight, pred, { sources: {}, markets: [] });
  assert.strictEqual(none.all.length, 0);
  assert.strictEqual(none.top, null);
  const done = buildPicks({ ...fight, state: 'post' }, pred, odds);
  assert.strictEqual(done.all.length, 0);
  assert.ok(done.warnings.includes('Combate ya empezado o terminado'));
});

test('un combate anulado o sin luchadores claros no da recomendaciones', () => {
  const bad = buildPicks({ ...fight, state: 'pre', cancelled: true }, pred, odds);
  assert.strictEqual(bad.all.length, 0);
  assert.ok(bad.warnings.includes('Combate anulado'));
});

test('no recomienda lo que el modelo ve muy distinto de la casa', () => {
  const far = { sources: odds.sources, markets: [line('moneyline|0||', 'Ganador', [o('a', 'Ilia Topuria', { winamax: 6 }), o('b', 'Max Holloway', { winamax: 1.1 })])] };
  const { top, easy } = buildPicks(fight, pred, far);
  assert.strictEqual(top, null);
  assert.strictEqual(easy.length, 0);
});

test('en el método la casa no suma 100 % entre A y B (faltan sumisión y decisión): se le supone un margen', () => {
  const { all } = buildPicks(fight, pred, odds);
  const a = all.find(p => p.id === 'method|0|ko|#a'), b = all.find(p => p.id === 'method|0|ko|#b');
  assert.ok(Math.abs(a.pMarket - (1 / 2.6) / 1.07) < 1e-9);
  assert.ok(Math.abs(b.pMarket - (1 / 7) / 1.07) < 1e-9);
  assert.ok(a.pMarket + b.pMarket < 0.6, 'no suman 1');
});
