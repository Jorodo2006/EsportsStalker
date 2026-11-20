// winamaxFind (server/lector/winamaxfind.js) corre dentro de la página de Winamax: aquí, con un PRELOADED_STATE falso con la forma del
// de verdad (matches con competitor1Name, competitor2Name y sportId; 5 es el tenis). Sin red: npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const { winamaxFind } = require('../lector/winamaxfind');

function find(teams, cfg, matches) {
  globalThis.window = { PRELOADED_STATE: { matches } };
  try { return winamaxFind(teams, cfg); } finally { delete globalThis.window; }
}
const m = (matchId, a, b, sportId = 5) => ({ matchId, sportId, competitor1Name: a, competitor2Name: b });
const list = {
  1: m(1, 'Pavic M. / Arevalo M.', 'Luz O. / Matos R.'),
  2: m(2, 'Mate Pavic', 'Orlando Luz'),
  3: m(3, 'Arevalo M. / Zeballos H.', 'Luz O. / Matos R.')
};
const pair = (name, alt = []) => ({ name, code: '', alt });

test('dobles: encuentra el partido de las dos parejas, en cualquier orden y con la inicial detrás', () => {
  const teams = [pair('Orlando Luz / Rafael Matos'), pair('Marcelo Arevalo / Mate Pavic')];
  assert.equal(find(teams, { sport: 5, doubles: true }, list), '1');
});

test('dobles: no se queda con el de otra pareja que comparte un jugador', () => {
  const teams = [pair('Marcelo Arevalo / Horacio Zeballos'), pair('Orlando Luz / Rafael Matos')];
  assert.equal(find(teams, { sport: 5, doubles: true }, { 1: list[1], 2: list[2] }), 'no');
});

test('un individual de tenis no se queda con un dobles de los mismos jugadores', () => {
  // Con el código de antes, "Pavic" estaba dentro de "pavic m arevalo m" y "Luz O" dentro de "luz o matos r": se quedaba con el 1
  const teams = [{ name: 'Mate Pavic', code: '', alt: ['Pavic', 'M. Pavic', 'Pavic M'] }, { name: 'Orlando Luz', code: '', alt: ['Luz', 'O. Luz', 'Luz O'] }];
  assert.equal(find(teams, { sport: 5 }, list), '2');
});

test('dobles: con segundos nombres y apellidos compuestos (los de Drummondville en Winamax, 19-11-2026)', () => {
  const teams = [pair('Miguel Angel Reyes / Reese Stalder'), pair('James Kent Trotter / Justin Boulais')];
  assert.equal(find(teams, { sport: 5, doubles: true }, { 7: m(7, 'M.A.Reyes-Varela / R.Stalder', 'J.Boulais / J.Trotter') }), '7');
});
