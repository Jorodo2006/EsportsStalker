const test = require('node:test');
const assert = require('node:assert');
const fx = require('./fixtures/espn-ufc-scoreboard.json');
const { normalizeEvent, methodOf } = require('../services/mma/espn');

test('methodOf traduce el resultado de ESPN', () => {
  assert.strictEqual(methodOf('kotko'), 'ko');
  assert.strictEqual(methodOf('submission'), 'sub');
  assert.strictEqual(methodOf('decision-unanimous'), 'dec');
  assert.strictEqual(methodOf('decision-split'), 'dec');
  assert.strictEqual(methodOf('dq'), 'other');
  assert.strictEqual(methodOf(''), '');
});

test('un evento pendiente da combates con luchadores, récord y orden de cartelera', () => {
  const f = normalizeEvent(fx.events[1], 'ufc');
  assert.strictEqual(f.length, 3);
  const first = f.find(x => x.a.name === 'Evan Elder');
  assert.strictEqual(first.a.record, '10-2-0');
  assert.strictEqual(first.weightClass, 'Lightweight');
  assert.strictEqual(first.state, 'pre');
  assert.strictEqual(first.rounds, 3);
  assert.strictEqual(first.org, 'ufc');
  assert.strictEqual(first.event, 'UFC 334: Gane vs. Hokit');
  // el último de la lista de ESPN es el principal: posición 1
  assert.strictEqual(f.find(x => x.rounds === 5 && x.cardPos === 1).a.name, 'Ciryl Gane');
  assert.ok(f.every(x => x.result === undefined));
});

test('un combate terminado trae ganador y método (del mapa de resultados)', () => {
  const ev = fx.events[0];
  const comp = ev.competitions[0];
  const f = normalizeEvent(ev, 'ufc', { [comp.id]: { name: 'kotko', round: 1, time: '4:16' } });
  const done = f.find(x => x.id === 'ufc:' + comp.id);
  assert.strictEqual(done.state, 'post');
  assert.deepStrictEqual(done.result, { winner: 'b', method: 'ko', round: 1, time: '4:16', draw: false, noContest: false });
});

test('un combate terminado sin ganador marcado es anulado, no ganado por nadie', () => {
  const ev = JSON.parse(JSON.stringify(fx.events[0]));
  ev.competitions[0].competitors.forEach(c => { c.winner = false; });
  const f = normalizeEvent(ev, 'ufc', { [ev.competitions[0].id]: { name: 'no-contest', round: 2, time: '1:00' } });
  const r = f.find(x => x.id === 'ufc:' + ev.competitions[0].id).result;
  assert.strictEqual(r.winner, null);
  assert.strictEqual(r.noContest, true);
});

test('un evento sin combates devuelve lista vacía', () => {
  assert.deepStrictEqual(normalizeEvent({ id: '1', name: 'X', date: '2026-01-01T00:00Z', competitions: [] }, 'ufc'), []);
  assert.deepStrictEqual(normalizeEvent({ id: '1', name: 'X', date: '2026-01-01T00:00Z' }, 'ufc'), []);
});

test('un combate cancelado o aplazado se marca y no trae resultado', () => {
  for (const name of ['STATUS_CANCELED', 'STATUS_POSTPONED']) {
    const ev = JSON.parse(JSON.stringify(fx.events[1]));
    ev.competitions[0].status.type = { id: '9', name, state: 'post', completed: false, description: 'Cancelado' };
    const f = normalizeEvent(ev, 'ufc').find(x => x.id === 'ufc:' + ev.competitions[0].id);
    assert.strictEqual(f.cancelled, true, name);
    assert.strictEqual(f.result, undefined, name);
  }
  assert.ok(!normalizeEvent(fx.events[1], 'ufc')[0].cancelled);
});

test('parseProfile: edad, medidas en métrico, KO, sumisiones y estilo a partir de las fichas de ESPN', () => {
  const { parseProfile } = require('../services/mma/espn');
  const p = parseProfile(require('./fixtures/espn-athlete.json'), require('./fixtures/espn-athlete-record.json'), require('./fixtures/espn-athlete-stats.json'));
  assert.strictEqual(p.age, 36);
  assert.strictEqual(p.heightCm, 193); // 76 pulgadas
  assert.strictEqual(p.reachCm, 206); // 81 pulgadas
  assert.strictEqual(p.weightKg, 112); // 248 libras
  assert.strictEqual(p.stance, 'Orthodox');
  assert.strictEqual(p.country, 'France');
  assert.deepStrictEqual({ w: p.wins, l: p.losses, d: p.draws }, { w: 14, l: 2, d: 0 });
  assert.strictEqual(p.kos, 7);
  assert.strictEqual(p.subs, 3);
  assert.strictEqual(p.decisions, 4); // 14 - 7 - 3
  assert.strictEqual(p.titleWins, 5);
  assert.strictEqual(p.strikesPerMin, 5.4);
  assert.strictEqual(p.takedownAvg, 0.66);
});

test('parseProfile: sin datos devuelve nulos, no ceros ni errores', () => {
  const { parseProfile } = require('../services/mma/espn');
  const p = parseProfile({}, null, null);
  assert.strictEqual(p.age, null);
  assert.strictEqual(p.heightCm, null);
  assert.strictEqual(p.kos, null);
  assert.strictEqual(p.decisions, null);
  assert.strictEqual(p.strikesPerMin, null);
});

test('una decisión técnica no es una decisión normal: se resuelve a mano', () => {
  assert.strictEqual(methodOf('decision-technical'), 'other');
  assert.strictEqual(methodOf('technical-decision'), 'other');
  assert.strictEqual(methodOf('decision-majority'), 'dec');
});
