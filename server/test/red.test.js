// El lector dice que la red bloquea la casa (en vez de "No encuentro el partido") cuando el DNS la manda a una página de bloqueo,
// como hace Cisco Umbrella en la red del instituto. Sin red: el DNS se simula. npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const { blocked, isBlockIp } = require('../lector/red');

test('direcciones de páginas de bloqueo', () => {
  for (const ip of ['146.112.61.106', '::ffff:146.112.61.104', '0.0.0.0', '127.0.0.1']) assert.equal(isBlockIp(ip), true, ip);
  for (const ip of ['104.18.20.33', '2606:4700::6812:1a57', '146.112.62.1']) assert.equal(isBlockIp(ip), false, ip);
});

test('con el DNS desviado se dice que la red bloquea la casa; con uno normal, nada', async () => {
  const umbrella = async () => [{ address: '::ffff:146.112.61.106', family: 6 }];
  const normal = async () => [{ address: '104.18.20.33', family: 4 }];
  assert.match(await blocked('winamax', umbrella), /La red de este equipo bloquea Winamax/);
  assert.equal(await blocked('betway', normal), null);
  assert.equal(await blocked('bet365', umbrella), null); // casa que no se lee: no se mira
});
