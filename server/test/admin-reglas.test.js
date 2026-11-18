// Reglas del panel de administración (server/services/bets/admin-rules.js): quién puede cambiar o borrar qué, y qué no se guarda
// en el registro. Todo puro, sin base de datos: npm test
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgres://nadie@localhost/nada'; // el pool no conecta hasta usarse
const { validUsername, checkUserChange, checkDelete, redact, seenStale } = require('../services/bets/admin-rules');

const user = (o = {}) => ({ id: '2', isAdmin: false, suspended: false, ...o });

test('validUsername: 3 a 30 letras, números o . _ -', () => {
  assert.equal(validUsername('ab'), false);
  assert.equal(validUsername('abc'), true);
  assert.equal(validUsername('a'.repeat(31)), false);
  assert.equal(validUsername('Jordi.R_1-x'), true);
  assert.equal(validUsername('con espacio'), false);
  assert.equal(validUsername('ñandú'), true);
});

test('cambios normales sobre otra cuenta: sin error', () => {
  assert.equal(checkUserChange({ actorId: '1', target: user(), patch: { username: 'nuevo' }, activeAdmins: 1 }), null);
  assert.equal(checkUserChange({ actorId: '1', target: user(), patch: { isAdmin: true }, activeAdmins: 1 }), null);
  assert.equal(checkUserChange({ actorId: '1', target: user(), patch: { suspended: true }, activeAdmins: 1 }), null);
});

test('no puedes quitarte el rol ni suspenderte, pero sí renombrarte', () => {
  const me = user({ id: '1', isAdmin: true });
  assert.equal(checkUserChange({ actorId: '1', target: me, patch: { isAdmin: false }, activeAdmins: 3 }), 'No puedes quitarte a ti mismo el rol de administrador');
  assert.equal(checkUserChange({ actorId: '1', target: me, patch: { suspended: true }, activeAdmins: 3 }), 'No puedes suspender tu propia cuenta');
  assert.equal(checkUserChange({ actorId: '1', target: me, patch: { username: 'otro-nombre' }, activeAdmins: 3 }), null);
});

test('nunca queda sin administrador activo', () => {
  const admin = user({ isAdmin: true });
  const MSG = 'Tiene que quedar al menos un administrador activo';
  assert.equal(checkUserChange({ actorId: '1', target: admin, patch: { isAdmin: false }, activeAdmins: 1 }), MSG);
  assert.equal(checkUserChange({ actorId: '1', target: admin, patch: { suspended: true }, activeAdmins: 1 }), MSG);
  assert.equal(checkUserChange({ actorId: '1', target: admin, patch: { isAdmin: false }, activeAdmins: 2 }), null);
  // Un administrador ya suspendido no cuenta como activo: degradarlo no deja a nadie sin acceso
  assert.equal(checkUserChange({ actorId: '1', target: user({ isAdmin: true, suspended: true }), patch: { isAdmin: false }, activeAdmins: 1 }), null);
});

test('un nombre inválido se rechaza', () => {
  assert.equal(checkUserChange({ actorId: '1', target: user(), patch: { username: 'a b' }, activeAdmins: 1 }), 'El usuario debe tener de 3 a 30 letras, números o . _ -');
});

test('borrar: no la propia, sólo suspendida y confirmando el nombre exacto', () => {
  const ok = { actorId: '1', target: user({ suspended: true }), confirm: 'Pepe', targetName: 'Pepe' };
  assert.equal(checkDelete(ok), null);
  assert.equal(checkDelete({ ...ok, target: user({ id: '1', suspended: true }) }), 'No puedes borrar tu propia cuenta');
  assert.equal(checkDelete({ ...ok, target: user() }), 'Suspende la cuenta antes de borrarla');
  assert.equal(checkDelete({ ...ok, confirm: 'pepe' }), 'Escribe el nombre de la cuenta para confirmar');
  assert.equal(checkDelete({ ...ok, confirm: '' }), 'Escribe el nombre de la cuenta para confirmar');
});

test('redact quita contraseñas y tokens, también anidados', () => {
  assert.deepEqual(redact({ password: 'x', nested: { contraseña: 'y', ok: 1 }, ok: 2 }), { nested: { ok: 1 }, ok: 2 });
  assert.deepEqual(redact({ session_token: 'abc', from: 'a', to: 'b' }), { from: 'a', to: 'b' });
});

test('seenStale: se actualiza el último acceso como mucho cada 5 minutos', () => {
  const now = Date.parse('2026-11-18T12:00:00Z');
  assert.equal(seenStale(null, now), true);
  assert.equal(seenStale(new Date(now - 4 * 60e3), now), false);
  assert.equal(seenStale(new Date(now - 6 * 60e3).toISOString(), now), true);
});

test('toAdminUser: sólo lo que enseña el panel, con ids como texto y sin la contraseña', () => {
  const { toAdminUser } = require('../services/bets/admin');
  const row = { id: 7, username: 'pepe', is_admin: true, suspended_at: null, created_at: '2026-11-01T10:00:00Z', last_seen_at: null,
    has_password: true, google_email: null, bets: 3, sessions: 1, password_hash: 'secreto' };
  const u = toAdminUser(row);
  assert.deepEqual(u, { id: '7', username: 'pepe', isAdmin: true, suspended: false, createdAt: '2026-11-01T10:00:00Z', lastSeenAt: null,
    hasPassword: true, googleEmail: null, bets: 3, sessions: 1 });
  assert.equal(JSON.stringify(u).includes('secreto'), false);
  assert.equal(toAdminUser({ ...row, suspended_at: '2026-11-02T00:00:00Z', google_email: 'a@b.c', has_password: false }).suspended, true);
  assert.equal(toAdminUser({ ...row, has_password: false, google_email: 'a@b.c' }).googleEmail, 'a@b.c');
});
