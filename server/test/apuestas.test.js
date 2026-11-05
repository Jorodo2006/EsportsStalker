// Pruebas de la validación de apuestas y de las firmas entre servicios. Sin base de datos: npm test
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgres://nadie@localhost/nada'; // el pool no conecta hasta usarse
const { normalizeBet } = require('../services/bets/store');

const rechaza = (b, texto) => assert.throws(() => normalizeBet(b), e => e.status === 400 && (!texto || e.message.includes(texto)));

test('apuesta simple: acepta coma decimal y rellena lo que falta', () => {
  const b = normalizeBet({ stake: '10,5', odds: '1.85', selection: 'T1' });
  assert.equal(b.stake, 10.5);
  assert.equal(b.odds, 1.85);
  assert.equal(b.status, 'pending');
  assert.equal(b.market, 'Ganador del partido');
  assert.ok(b.id);
});

test('una apuesta sin cuota todavía es válida', () => {
  assert.equal(normalizeBet({ stake: 5 }).odds, 0);
});

test('rechaza importes y cuotas fuera de rango o que no son números', () => {
  rechaza({ stake: -5, odds: 2 }, 'fuera de rango');
  rechaza({ stake: 1e9, odds: 2 }, 'fuera de rango');
  rechaza({ stake: 5, odds: 0.5 }, 'fuera de rango');
  rechaza({ stake: 5, odds: 5000 }, 'fuera de rango');
  rechaza({ stake: 5, odds: 'abc' }, 'no es un número');
  rechaza({ stake: 'NaN', odds: 2 }, 'no es un número');
  rechaza({ stake: 5, odds: 2, cashout: -1 }, 'fuera de rango');
});

test('rechaza textos demasiado largos y entradas que no son una apuesta', () => {
  rechaza({ stake: 1, odds: 2, notes: 'x'.repeat(2001) }, 'demasiado largo');
  rechaza({ stake: 1, odds: 2, id: 'x'.repeat(65) }, 'demasiado largo');
  rechaza(null, 'no válida');
  rechaza('hola', 'no válida');
});

test('combinada: la cuota es el producto y el estado sale de las selecciones', () => {
  const b = normalizeBet({ stake: 10, legs: [{ selection: 'A', odds: 2, status: 'won' }, { selection: 'B', odds: 1.5 }] });
  assert.equal(b.market, 'Combinada');
  assert.equal(b.odds, 3);
  assert.equal(b.status, 'pending');
  assert.equal(normalizeBet({ stake: 10, legs: [{ selection: 'A', odds: 2, status: 'won' }, { selection: 'B', odds: 1.5, status: 'lost' }] }).status, 'lost');
  assert.equal(normalizeBet({ stake: 10, legs: [{ selection: 'A', odds: 2, status: 'won' }, { selection: 'B', odds: 1.5, status: 'won' }] }).status, 'won');
});

test('combinada: lo que mande el cliente no cambia la cuota ni el estado', () => {
  const b = normalizeBet({ stake: 10, odds: 99, status: 'won', legs: [{ selection: 'A', odds: 2 }, { selection: 'B', odds: 2 }] });
  assert.equal(b.odds, 4);
  assert.equal(b.status, 'pending');
});

test('combinada: máximo de 30 selecciones y las nulas cuentan 1', () => {
  rechaza({ stake: 1, legs: Array.from({ length: 31 }, (_, i) => ({ selection: 's' + i, odds: 2 })) }, 'máximo');
  assert.equal(normalizeBet({ stake: 1, legs: [{ selection: 'A', odds: 2 }, { selection: 'B', odds: 9, status: 'void' }] }).odds, 2);
});

test('firma de cabeceras de usuario: sin secreto todo vale; con secreto sólo lo firmado', () => {
  delete process.env.INTERNAL_SECRET;
  const internal = require('../shared/internal');
  assert.equal(internal.sign('1', '0'), null);
  assert.equal(internal.verify('1', '0', undefined), true);

  process.env.INTERNAL_SECRET = 'secreto-de-prueba';
  const sig = internal.sign('1', '0');
  assert.ok(sig && sig.length === 64);
  assert.equal(internal.verify('1', '0', sig), true);
  assert.equal(internal.verify('2', '0', sig), false, 'otro usuario con la firma de éste');
  assert.equal(internal.verify('1', '1', sig), false, 'hacerse administrador con la firma de un usuario normal');
  assert.equal(internal.verify('1', '0', undefined), false);
  assert.equal(internal.verify('1', '0', 'x'), false);
  delete process.env.INTERNAL_SECRET;
});
