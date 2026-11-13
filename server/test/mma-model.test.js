const test = require('node:test');
const assert = require('node:assert');
const M = require('../services/mma/model');

const fight = (id, date, a, b, winner, extra = {}) => ({
  id, org: 'ufc', date, state: 'post', rounds: 3, a: { id: a, record: '' }, b: { id: b, record: '' },
  result: { winner, method: 'dec', round: 3, time: '5:00', draw: false, noContest: false }, ...extra
});
const ctx = (over = {}) => ({ elo: 1500, fights: 10, record: '', ...over });
const OPTS = { org: 'ufc', rounds: 3, weightClass: 'Lightweight' };
const near = (x, y, e = 1e-9) => assert.ok(Math.abs(x - y) <= e, `${x} != ${y}`);

test('pA + pB suma 1 y dos luchadores iguales dan 50 %', () => {
  const p = M.predict(ctx(), ctx(), OPTS);
  near(p.pA + p.pB, 1);
  near(p.pA, 0.5);
});

test('mayor Elo da más probabilidad, y el modelo es simétrico', () => {
  const ab = M.predict(ctx({ elo: 1650 }), ctx({ elo: 1500 }), OPTS);
  const ba = M.predict(ctx({ elo: 1500 }), ctx({ elo: 1650 }), OPTS);
  assert.ok(ab.pA > 0.6);
  near(ab.pA, ba.pB);
});

test('la edad avanzada y la inactividad restan', () => {
  const base = M.predict(ctx(), ctx(), OPTS).pA;
  assert.ok(M.predict(ctx({ ageYears: 41 }), ctx({ ageYears: 28 }), OPTS).pA < base);
  assert.ok(M.predict(ctx({ daysSinceLast: 900 }), ctx({ daysSinceLast: 90 }), OPTS).pA < base);
  near(M.predict(ctx({ ageYears: 30 }), ctx({ ageYears: 30 }), OPTS).pA, 0.5);
});

test('con pocos combates el récord pesa; con muchos, el Elo', () => {
  const rookie = M.predict(ctx({ fights: 0, record: '12-0-0' }), ctx({ fights: 0, record: '2-9-0' }), OPTS);
  assert.ok(rookie.pA > 0.6, 'sin historial manda el récord');
  const vet = M.predict(ctx({ fights: 30, record: '12-0-0' }), ctx({ fights: 30, record: '2-9-0' }), OPTS);
  near(vet.pA, 0.5, 0.01);
});

test('la fiabilidad baja con poco historial y WOW nunca pasa de media', () => {
  assert.strictEqual(M.predict(ctx({ fights: 1 }), ctx(), OPTS).reliability, 'baja');
  assert.strictEqual(M.predict(ctx({ fights: 12 }), ctx({ fights: 9 }), OPTS).reliability, 'alta');
  assert.strictEqual(M.predict(ctx({ fights: 12 }), ctx({ fights: 9 }), { ...OPTS, org: 'wow' }).reliability, 'media');
});

test('método y duración: suman 1 y a cinco asaltos se llega menos a decisión', () => {
  const p = M.predict(ctx({ elo: 1600 }), ctx(), OPTS);
  near(p.method.ko + p.method.sub + p.method.dec, 1);
  near(p.joint.a.ko + p.joint.a.sub + p.joint.a.dec + p.joint.b.ko + p.joint.b.sub + p.joint.b.dec, 1);
  near(p.joint.a.ko + p.joint.a.sub + p.joint.a.dec, p.pA);
  near(p.goesDistance, p.method.dec);
  const five = M.predict(ctx({ elo: 1600 }), ctx(), { ...OPTS, rounds: 5 });
  assert.ok(five.goesDistance < p.goesDistance);
  const lopsided = M.predict(ctx({ elo: 1900 }), ctx(), OPTS);
  assert.ok(lopsided.goesDistance < M.predict(ctx(), ctx(), OPTS).goesDistance, 'un favorito claro acaba antes');
});

test('probabilidad de que dure más de N minutos: decreciente y entre 0 y 1', () => {
  const p = M.predict(ctx(), ctx(), OPTS);
  const o = [2.5, 7.5, 12.5, 14.99].map(t => M.pOver(p, 3, t));
  for (let i = 1; i < o.length; i++) assert.ok(o[i] <= o[i - 1]);
  assert.ok(o.every(x => x >= 0 && x <= 1));
  near(M.pOver(p, 3, 15), 0); // a tres asaltos no se pasa de 15 minutos
  assert.ok(M.pOver(p, 3, 0) > 0.999);
  assert.ok(M.pOver(p, 3, 14.99) >= p.goesDistance - 1e-9);
});

test('buildRatings: el ganador sube, el perdedor baja, y se procesa por fecha', () => {
  const list = [
    fight('2', '2025-02-01T00:00Z', 'a', 'b', 'a'),
    fight('1', '2025-01-01T00:00Z', 'a', 'b', 'b')
  ];
  const r = M.buildRatings(list);
  assert.strictEqual(r.get('a').fights, 2);
  assert.strictEqual(r.get('a').lastDate, '2025-02-01T00:00Z');
  // b ganó primero (sube) y luego perdió; si se hubiese procesado al revés, a acabaría más arriba
  const inOrder = M.buildRatings([list[1], list[0]]);
  near(r.get('a').elo, inOrder.get('a').elo);
  const one = M.buildRatings([fight('1', '2025-01-01T00:00Z', 'a', 'b', 'a')]);
  assert.ok(one.get('a').elo > 1500 && one.get('b').elo < 1500);
  near(one.get('a').elo + one.get('b').elo, 3000);
});

test('empate, sin resultado, pendiente o sin ganador no mueven el Elo; un sustituto empieza de cero', () => {
  const draw = fight('1', '2025-01-01T00:00Z', 'a', 'b', null, { result: { winner: null, method: '', round: 3, time: '', draw: true, noContest: false } });
  const nc = fight('2', '2025-01-02T00:00Z', 'a', 'b', null, { result: { winner: null, method: '', round: 1, time: '', draw: false, noContest: true } });
  const pre = fight('3', '2025-01-03T00:00Z', 'a', 'b', 'a', { state: 'pre', result: undefined });
  const r = M.buildRatings([draw, nc, pre]);
  assert.strictEqual(r.size, 0);
  const sub = M.buildRatings([fight('4', '2025-01-04T00:00Z', 'a', 'c', 'a')]);
  assert.strictEqual(sub.get('b'), undefined);
  assert.strictEqual(sub.get('c').fights, 1);
});

test('recordElo: récord ganador por encima de 1500 y perdedor por debajo; sin récord, neutral', () => {
  assert.ok(M.recordElo('20-2-0') > 1500);
  assert.ok(M.recordElo('2-10-0') < 1500);
  assert.strictEqual(M.recordElo(''), 1500);
  assert.strictEqual(M.recordElo('basura'), 1500);
});
