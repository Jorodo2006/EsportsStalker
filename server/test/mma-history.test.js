const test = require('node:test');
const assert = require('node:assert');
// history.js usa shared/db (pool de pg) al cargarse; sin DATABASE_URL no abre conexiones hasta que se llama a query
const H = require('../services/mma/history');

test('quarters: trimestres naturales desde 2016 hasta el actual, el último incluido', () => {
  const q = H.quarters(new Date('2016-05-10T00:00:00Z'));
  assert.deepStrictEqual(q, [{ from: '2016-01-01', to: '2016-03-31' }, { from: '2016-04-01', to: '2016-06-30' }]);
  const end = H.quarters(new Date('2017-01-01T00:00:00Z'));
  assert.deepStrictEqual(end[end.length - 1], { from: '2017-01-01', to: '2017-03-31' });
  assert.strictEqual(end.length, 5);
});

test('compact deja sólo lo necesario del combate terminado', () => {
  const f = { id: 'ufc:1', org: 'ufc', date: 'd', state: 'post', rounds: 3, weightClass: 'W', event: 'E', venue: 'x', a: { id: '1', name: 'A', record: '1-0-0', photo: 'p', alt: [] }, b: { id: '2', name: 'B', record: '0-1-0' }, result: { winner: 'a' } };
  const c = H.compact(f);
  assert.deepStrictEqual(Object.keys(c).sort(), ['a', 'b', 'date', 'event', 'id', 'org', 'result', 'rounds', 'state', 'weightClass']);
  assert.deepStrictEqual(Object.keys(c.a).sort(), ['age', 'id', 'name', 'record']);
});

test('fighterCtx: Elo, combates, récord y días sin pelear; un desconocido es neutral', () => {
  const ratings = new Map([['1', { elo: 1620, fights: 9, lastDate: '2026-01-01T00:00:00Z' }]]);
  const now = Date.parse('2026-01-11T00:00:00Z');
  const c = H.fighterCtx(ratings, { id: '1', record: '10-1-0', age: 33 }, now);
  assert.deepStrictEqual({ ...c, daysSinceLast: Math.round(c.daysSinceLast) }, { elo: 1620, fights: 9, record: '10-1-0', ageYears: 33, daysSinceLast: 10 });
  const n = H.fighterCtx(ratings, { id: 'nuevo', record: '' }, now);
  assert.strictEqual(n.elo, 1500);
  assert.strictEqual(n.fights, 0);
  assert.strictEqual(n.daysSinceLast, undefined);
});

test('rankingOf: los activos con suficientes combates, por Elo, con su puesto', () => {
  const now = Date.parse('2026-06-01T00:00:00Z');
  const f = (id, a, b, date, org = 'ufc') => ({ id, org, date, state: 'post', a: { id: a, name: 'N' + a, record: '5-1-0' }, b: { id: b, name: 'N' + b, record: '1-5-0' }, result: { winner: 'a' } });
  const fights = [];
  for (let i = 0; i < 6; i++) fights.push(f('x' + i, 'top', 'v' + i, `2026-0${1 + (i % 5)}-10T00:00Z`));
  for (let i = 0; i < 6; i++) fights.push(f('y' + i, 'viejo', 'w' + i, `2020-01-0${1 + i}T00:00Z`)); // sin pelear desde 2020
  const ratings = new Map([['top', { elo: 1700, fights: 6, lastDate: '2026-05-10T00:00Z' }], ['viejo', { elo: 1800, fights: 6, lastDate: '2020-01-06T00:00Z' }], ['v0', { elo: 1400, fights: 1, lastDate: '2026-01-10T00:00Z' }]]);
  const r = H.rankingOf(fights, ratings, now);
  assert.deepStrictEqual(r.map(x => x.id), ['top']);
  assert.strictEqual(r[0].rank, 1);
  assert.strictEqual(r[0].name, 'Ntop');
  assert.strictEqual(Math.round(r[0].elo), 1700);
  assert.strictEqual(r[0].fights, 6);
  assert.strictEqual(H.rankingOf(fights, ratings, now, { minFights: 1 }).length, 2, 'v0 (1 combate) entra al bajar el mínimo');
});
