// Pruebas del registro de recomendaciones (server/services/bets/predictions.js): lo que manda el navegador se valida
// antes de guardarse, porque cualquiera con sesión puede mandarlo. Sin base de datos: npm test
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgres://nadie@localhost/nada'; // el pool no conecta hasta usarse
const { clean } = require('../services/bets/predictions');

const ok = {
  sport: 'basket', match: 'nba:401909956', key: 'player|Puntos|demar derozan|10.5', out: 'over', start: '2026-11-10T01:30:00Z',
  group: 'Puntos', title: 'DeRozan: más de 10,5 puntos', event: 'DEN @ HOU', league: 'NBA', book: 'Winamax',
  price: 1.82, p: 0.58, pModel: 0.61, pMarket: 0.53, ev: 0.055, rel: 62
};

test('una recomendación bien formada se guarda con sus campos', () => {
  const r = clean(ok);
  assert.equal(r.match, ok.match);
  assert.equal(r.grp, 'Puntos');
  assert.equal(r.price, 1.82);
  assert.equal(r.rel, 62);
  assert.equal(r.start, '2026-11-10T01:30:00.000Z');
});

test('se descarta lo que no cuadra: deporte, partido, selección, probabilidad, cuota o EV', () => {
  assert.equal(clean({ ...ok, sport: 'golf' }), null);
  assert.equal(clean({ ...ok, match: 'nba:1; DROP TABLE' }), null);
  assert.equal(clean({ ...ok, out: 'más de' }), null);
  assert.equal(clean({ ...ok, p: 1.4 }), null);
  assert.equal(clean({ ...ok, p: 'abc' }), null);
  assert.equal(clean({ ...ok, price: 1 }), null);
  assert.equal(clean({ ...ok, ev: 99 }), null);
  assert.equal(clean(null), null);
});

test('los textos largos se recortan y lo opcional puede faltar', () => {
  const r = clean({ ...ok, title: 'x'.repeat(500), pModel: undefined, pMarket: null, rel: undefined, start: 'no es fecha' });
  assert.equal(r.title.length, 160);
  assert.equal(r.pModel, null);
  assert.equal(r.pMarket, null);
  assert.equal(r.rel, null);
  assert.equal(r.start, null);
});
