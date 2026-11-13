// Entrar con Google: lo que no necesita red (usuario de las cuentas nuevas y comprobación de la identidad). Sin base de datos
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgres://nadie@localhost/nada'; // el pool no conecta hasta usarse
const { usernameBase, freeUsername, claimsOf } = require('../services/bets/google');

const REGLA = /^[\p{L}\p{N}_.-]{3,30}$/u;
const token = claims => `x.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.firma`;
const bueno = { iss: 'https://accounts.google.com', aud: 'cliente', exp: Date.now() / 1000 + 600, sub: '1234', email: 'ana@gmail.com', email_verified: true, name: 'Ana' };

test('el usuario sale del correo y cumple las reglas del registro', () => {
  assert.equal(usernameBase('jordi.garcia@gmail.com'), 'jordi.garcia');
  assert.equal(usernameBase('María+apuestas@gmail.com'), 'Maríaapuestas');
  assert.equal(usernameBase('ab@x.com', 'Ana Belén Ruiz'), 'Ana.Belén.Ruiz');
  assert.equal(usernameBase('', ''), 'usuario');
  assert.equal(usernameBase('un.nombre.larguisimo.de.correo.que.no.cabe@x.com').length, 30);
  for (const e of ['jordi.garcia@gmail.com', '__raro..@x.com', 'a@b.c', 'muy-largo-'.repeat(5) + '@x.com']) assert.match(usernameBase(e, 'Nombre'), REGLA);
});

test('si el usuario ya existe, el primero libre', () => {
  assert.equal(freeUsername('ana', []), 'ana');
  assert.equal(freeUsername('ana', ['ANA', 'ana2']), 'ana3');
  const largo = 'x'.repeat(30);
  const libre = freeUsername(largo, [largo]);
  assert.equal(libre.length, 30);
  assert.match(libre, REGLA);
});

test('identidad de Google: válida', () => {
  assert.deepEqual(claimsOf(token(bueno), 'cliente'), { sub: '1234', email: 'ana@gmail.com', name: 'Ana' });
});

test('identidad de Google: se rechaza si no es de Google, no es para esta app, ha caducado o el correo no está verificado', () => {
  const rechaza = (claims, texto) => assert.throws(() => claimsOf(token({ ...bueno, ...claims }), 'cliente'), e => e.message.includes(texto));
  rechaza({ iss: 'https://otro.com' }, 'no la ha emitido Google');
  rechaza({ aud: 'otra-app' }, 'no es para esta app');
  rechaza({ exp: Date.now() / 1000 - 10 }, 'caducado');
  rechaza({ email_verified: false }, 'no está verificado');
  rechaza({ sub: '' }, 'qué cuenta');
  assert.throws(() => claimsOf('basura', 'cliente'), /identidad válida/);
});
