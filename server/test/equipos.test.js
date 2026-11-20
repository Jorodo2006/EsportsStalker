// Emparejar los equipos de las casas con los nuestros (server/services/odds/equipos.js): con el partido RIG @ DER de la EuroCup
// (18-11-2026) Betway decía "Derthona Basket - Rigas Zelli", Winamax "Tortona Basket - Rigas Zelli" y nosotros "Riga Zelli" y
// "Derthona": no se emparejaba y sus cuotas no se guardaban. Sin red: npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const { teamScore, orient } = require('../services/odds/equipos');

const riga = { name: 'Riga Zelli', code: 'RIG', alt: ['Riga Zelli'] };
// Con los nombres que añade el servicio de baloncesto (ALIAS en basket/euroleague.js)
const derthona = { name: 'Derthona', code: 'DER', alt: ['Bertram Derthona Tortona', 'Tortona', 'Tortona Basket', 'Derthona Basket'] };

test('una letra de diferencia en una palabra del nombre es el mismo equipo', () => {
  assert.ok(teamScore(riga, 'Rigas Zelli') >= 0.9);
  assert.ok(teamScore({ name: 'Real Madrid' }, 'Real Betis') < 0.9); // otra palabra entera no
  assert.ok(teamScore({ name: 'Hapoel Tel Aviv' }, 'Maccabi Tel Aviv') < 0.9);
});

test('el partido de Betway y el de Winamax ya se emparejan', () => {
  assert.ok(orient(riga, derthona, 'Derthona Basket', 'Rigas Zelli')); // Betway
  assert.ok(orient(riga, derthona, 'Tortona Basket', 'Rigas Zelli')); // Winamax
  assert.equal(orient(riga, derthona, 'Tortona Basket', 'Rigas Zelli').swapped, true); // en la casa va primero el local
});

test('y no se emparejan con otro partido', () => {
  assert.equal(orient(riga, derthona, 'BAXI Manresa', 'PAOK'), null);
  assert.equal(orient(riga, derthona, 'Derthona Basket', 'Cedevita Olimpija'), null);
});

// Dobles de tenis: nuestras parejas ("Marcelo Arevalo / Mate Pavic", server/services/tennis/doubles.js) contra como las escriben las casas
const arevaloPavic = { name: 'Marcelo Arevalo / Mate Pavic', code: '', alt: ['Arevalo / Pavic'] };
const luzMatos = { name: 'Orlando Luz / Rafael Matos', code: '', alt: ['Luz / Matos'] };

test('dobles: la pareja casa con sus dos apellidos en cualquier orden y con la inicial delante o detrás', () => {
  for (const n of ['Arevalo M. / Pavic M.', 'Pavic/Arevalo', 'M. Pavic / M. Arevalo', 'Marcelo Arevalo / Mate Pavic']) assert.ok(teamScore(arevaloPavic, n) >= 0.8, n);
  const o = orient(arevaloPavic, luzMatos, 'Luz O. / Matos R.', 'Pavic M. / Arevalo M.');
  assert.ok(o && o.swapped, 'la casa las tiene al revés: se da la vuelta');
});

test('dobles: una pareja con un solo jugador en común no es la nuestra, ni un individual', () => {
  assert.equal(teamScore(arevaloPavic, 'Arevalo M. / Zeballos H.'), 0);
  assert.equal(teamScore(arevaloPavic, 'Mate Pavic'), 0);
  assert.equal(orient(arevaloPavic, luzMatos, 'Arevalo M. / Zeballos H.', 'Luz O. / Matos R.'), null);
});

test('un equipo con barra en el nombre no se toma por una pareja', () => {
  // Como antes de los dobles: sin barra en la casa también casa (como pareja daría 0)
  assert.ok(teamScore({ name: 'Bodø/Glimt', code: 'BOD' }, 'Bodo/Glimt') >= 0.8);
  assert.ok(teamScore({ name: 'Bodø/Glimt', code: 'BOD' }, 'Bodø Glimt') >= 0.8);
});

test('dobles: apellidos compuestos y segundos nombres, como los escribe Winamax (noviembre de 2026)', () => {
  const reyes = { name: 'Miguel Angel Reyes / Reese Stalder' }, trotter = { name: 'James Kent Trotter / Justin Boulais' };
  const o = orient(reyes, trotter, 'M.A.Reyes-Varela / R.Stalder', 'J.Boulais / J.Trotter');
  assert.ok(o && !o.swapped && o.score >= 1.9);
  assert.ok(teamScore({ name: 'Nuria Brancaccio / Guiomar Maristany Zuleta De Reales' }, 'N.Brancaccio / G.Maristany Zuleta de Reales') >= 0.9);
  assert.ok(teamScore({ name: 'Bruno Oliveira / Nicolas Rodrigues' }, 'B.Oliveira (2002) / N.Rodrigues') >= 0.9);
  // Una partícula sola no empareja ("van" de otro jugador)
  assert.equal(teamScore({ name: 'Botic van de Zandschulp / Tim Puetz' }, 'J.Van Lottum / T.Puetz'), 0);
});
