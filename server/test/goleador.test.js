// Modelo del goleador (server/services/football/scorers.js): minutos y goles de una ficha de ESPN, y el reparto de los goles esperados.
// Sin red ni base de datos: npm test
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgres://nadie@localhost/nada'; // el pool no conecta hasta usarse
const { playersOfSummary, scorerProbs, norm } = require('../services/football/scorers');

const athlete = (id, displayName) => ({ id, displayName });
const player = (id, name, pos, o = {}) => ({ athlete: athlete(id, name), position: { abbreviation: pos }, starter: false, subbedIn: false, subbedOut: false, ...o });
const ev = (type, minute, team, ...names) => ({ type: { type }, clock: { displayValue: `${minute}'` }, team: { id: team }, participants: names.map(n => ({ athlete: athlete('x', n) })) });
const summary = {
  header: { competitions: [{}] },
  rosters: [{ team: { id: '1' }, roster: [
    player('a', 'Ana Gol', 'CF', { starter: true, subbedOut: true }), player('b', 'Bea Medio', 'CM', { starter: true }),
    player('c', 'Cris Banquillo', 'LW', { subbedIn: true }), player('d', 'Dani Suplente', 'CB'), player('e', 'Eva Gol', 'G', { starter: true })
  ] }],
  keyEvents: [ev('goal', 20, '1', 'Ana Gol'), ev('goal', 70, '1', 'Cris Banquillo'), ev('own-goal', 80, '1', 'Bea Medio'), ev('substitution', 60, '1', 'Cris Banquillo', 'Ana Gol')]
};

test('ficha: minutos (titular, cambio dentro y fuera) y goles, sin contar el gol en propia ni a los que no jugaron', () => {
  const p = Object.fromEntries(playersOfSummary(summary)['1'].map(x => [x.name, x]));
  assert.equal(p['Ana Gol'].min, 60); assert.equal(p['Ana Gol'].goals, 1);
  assert.equal(p['Cris Banquillo'].min, 30); assert.equal(p['Cris Banquillo'].goals, 1);
  assert.equal(p['Bea Medio'].min, 90); assert.equal(p['Bea Medio'].goals, 0); // el gol en propia no cuenta
  assert.equal(p['Dani Suplente'], undefined); // no jugó
  assert.equal(p['Ana Gol'].pos, 'F'); assert.equal(p['Eva Gol'].pos, 'G');
  assert.equal(playersOfSummary({ rosters: [] }), null);
});

test('goleador: reparte los goles esperados del equipo, más para el que marca, nada para el portero y nada con pocos partidos', () => {
  const recent = { n: 10, players: [
    { name: 'Ana', key: 'ana', pos: 'F', min: 800, goals: 8 }, { name: 'Bea', key: 'bea', pos: 'M', min: 800, goals: 1 },
    { name: 'Eva', key: 'eva', pos: 'G', min: 900, goals: 0 }, { name: 'Dani', key: 'dani', pos: 'D', min: 700, goals: 0 }
  ] };
  const m = scorerProbs(recent, 2);
  assert.ok(m.get('ana').p > m.get('bea').p && m.get('bea').p > m.get('dani').p && m.get('dani').p > m.get('eva').p);
  assert.equal(m.get('eva').p, 0);
  assert.ok(Math.abs([...m.values()].reduce((t, x) => t + x.lambda, 0) - 2 * 0.97) < 1e-9); // suma lo que se espera del equipo
  assert.ok(m.get('ana').p < 1);
  const doble = scorerProbs(recent, 4);
  assert.ok(doble.get('ana').p > m.get('ana').p); // más goles esperados, más probabilidad
  assert.equal(scorerProbs({ n: 3, players: recent.players }, 2), null); // pocos partidos
  assert.equal(norm('Vinícius  Júnior'), 'vinicius junior');
});

test('jugadores: remates y paradas con su ritmo y el prior de la posición', () => {
  const { countModel, COUNT_PRIOR, COUNT_K, poissonAtLeast } = require('../services/football/scorers');
  const recent = { n: 10, players: [
    { name: 'Ana', key: 'ana', pos: 'F', min: 900, apps: 10, goals: 0, stats: { shots: 50 } }, // 5 remates por partido
    { name: 'Bea', key: 'bea', pos: 'F', min: 900, apps: 10, goals: 0, stats: { shots: 5 } },
    { name: 'Cris', key: 'cris', pos: 'D', min: 180, apps: 2, goals: 0, stats: { shots: 0 } } // sólo juega el 20 % de los partidos
  ] };
  const m = countModel(recent, 'shots', COUNT_PRIOR.shots, { prior90s: COUNT_K.shots });
  assert.ok(m.get('ana').atLeast(3) > m.get('bea').atLeast(3));
  assert.ok(m.get('ana').atLeast(1) > m.get('ana').atLeast(3)); // más exigente, menos probable
  assert.ok(Math.abs(m.get('cris').q - 0.2) < 1e-9 && m.get('cris').atLeast(1) < 0.2); // no juega siempre
  assert.ok(Math.abs(poissonAtLeast(2, 1) - (1 - Math.exp(-2))) < 1e-12);
  assert.equal(countModel({ n: 2, players: recent.players }, 'shots', COUNT_PRIOR.shots), null); // pocos partidos
});
