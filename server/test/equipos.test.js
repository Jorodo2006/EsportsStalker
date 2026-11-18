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
