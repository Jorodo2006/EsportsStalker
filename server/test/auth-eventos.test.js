// Registro de accesos (server/services/bets/auth-events.js): qué nombre se guarda al fallar un acceso. Sin base de datos: npm test
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgres://nadie@localhost/nada'; // el pool no conecta hasta usarse
const { usernameToLog } = require('../services/bets/auth-events');

test('el nombre sólo se guarda si la cuenta existe', () => {
  assert.equal(usernameToLog(true, 'jordi'), 'jordi');
  // Una contraseña escrita por error en el campo de usuario no puede acabar en el registro
  assert.equal(usernameToLog(false, 'Contraseña123'), null);
});

test('un nombre largo se recorta a 30 caracteres', () => {
  assert.equal(usernameToLog(true, 'x'.repeat(80)), 'x'.repeat(30));
});
