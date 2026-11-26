// Reajuste diario del modelo de baloncesto (server/services/bets/tuning.js): sólo cambia si mejora en días que no se usaron para
// ajustar, poco a poco y con muestra suficiente
const test = require('node:test');
const assert = require('node:assert');
const { fitWeight, blend } = require('../services/bets/tuning');

// Líneas inventadas: la verdad es la mezcla con peso `truth`; el modelo y la casa difieren al azar
function lines(n, truth, seed) {
  let x = seed;
  const rnd = () => ((x = (x * 1103515245 + 12345) % 2147483648) / 2147483648);
  return Array.from({ length: n }, () => {
    const f = 0.3 + 0.4 * rnd(), m = Math.min(0.95, Math.max(0.05, f + (rnd() - 0.5) * 0.3));
    return { m, f, y: rnd() < blend(m, f, truth) ? 1 : 0 };
  });
}

test('si el modelo acierta más de lo que se le deja pesar, sube, pero como mucho 0,05', () => {
  const r = fitWeight(lines(20000, 1, 1), lines(3000, 1, 2), 0.3);
  assert.ok(r.fitW >= 0.6, `ajuste ${r.fitW}`);
  assert.strictEqual(r.w, 0.35);
  assert.strictEqual(r.applied, true);
  assert.ok(r.ll.next < r.ll.prev);
});

test('si en los días de prueba no mejora, no cambia (lo que ajusta bien y prueba mal es sobreentrenarse)', () => {
  // Ajuste con datos en los que el modelo vale; prueba con datos en los que sólo vale la casa
  const r = fitWeight(lines(6000, 0.8, 3), lines(1500, 0, 4), 0.3);
  assert.strictEqual(r.applied, false);
  assert.strictEqual(r.w, 0.3);
  assert.match(r.reason, /no mejora/);
});

test('con poca muestra no se toca', () => {
  const r = fitWeight(lines(800, 0.6, 5), lines(100, 0.6, 6), 0.3);
  assert.deepStrictEqual([r.applied, r.w], [false, 0.3]);
  assert.match(r.reason, /poca muestra/);
});

test('nunca pasa de 0,5', () => {
  const r = fitWeight(lines(6000, 1, 7), lines(1500, 1, 8), 0.48);
  assert.ok(r.w <= 0.5);
});
