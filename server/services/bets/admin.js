// Administración de cuentas (panel de administración). Las reglas están en admin-rules.js; aquí se aplican dentro de una
// transacción con un candado, para que dos administradores no se quiten el rol a la vez y deje de haber alguno. Cada cambio escribe su
// fila en bets.admin_log en la misma transacción. Las rutas (index.js) sólo llegan aquí tras comprobar que quien pide es administrador.
const { query, tx } = require('../../shared/db');
const { fail } = require('../../shared/service');
const { hashPassword, validPassword } = require('./auth');
const { checkUserChange, checkDelete, redact } = require('./admin-rules');

const ADMIN_LOCK = 727002; // distinto del de «primer usuario» (auth.js)

// Un número por usuario de apuestas y sesiones: nunca columnas de la apuesta (los datos de cada usuario son suyos)
const SELECT_USERS = `SELECT u.id, u.username, u.is_admin, u.suspended_at, u.created_at, u.last_seen_at, u.google_email,
  (u.password_hash IS NOT NULL) AS has_password,
  (SELECT count(*)::int FROM bets.bets b WHERE b.user_id = u.id) AS bets,
  (SELECT count(*)::int FROM bets.sessions s WHERE s.user_id = u.id AND s.expires_at > now()) AS sessions
  FROM bets.users u`;

const toAdminUser = r => ({
  id: String(r.id), username: r.username, isAdmin: !!r.is_admin, suspended: !!r.suspended_at, createdAt: r.created_at,
  lastSeenAt: r.last_seen_at || null, hasPassword: !!r.has_password, googleEmail: r.google_email || null, bets: r.bets, sessions: r.sessions
});

const idOf = id => { if (!/^\d+$/.test(String(id ?? ''))) throw fail('Cuenta no válida', 400); return String(id); };

async function listUsers() {
  const { rows } = await query(`${SELECT_USERS} ORDER BY u.id`);
  return rows.map(toAdminUser);
}

// Dentro de la transacción: quién actúa (el nombre se copia al registro) y la cuenta afectada, bloqueada hasta el final
async function actorOf(c, actorId) {
  const { rows } = await c.query('SELECT id, username FROM bets.users WHERE id = $1', [actorId]);
  if (!rows[0]) throw fail('Inicia sesión', 401);
  return rows[0];
}
async function lockTarget(c, id) {
  const { rows } = await c.query('SELECT * FROM bets.users WHERE id = $1 FOR UPDATE', [id]);
  if (!rows[0]) throw fail('No existe esa cuenta', 404);
  return rows[0];
}
const logAction = (c, actor, action, target, detail = {}) => c.query(
  'INSERT INTO bets.admin_log (admin_id, admin_name, action, target_id, target_name, detail) VALUES ($1, $2, $3, $4, $5, $6::jsonb)',
  [actor.id, actor.username, action, target.id, target.username, JSON.stringify(redact(detail))]);
const userNow = async (c, id) => toAdminUser((await c.query(`${SELECT_USERS} WHERE u.id = $1`, [id])).rows[0]);

async function updateUser(actorId, id, patch) {
  const uid = idOf(id);
  const want = {};
  if (typeof patch?.username === 'string') want.username = patch.username.trim();
  if (typeof patch?.isAdmin === 'boolean') want.isAdmin = patch.isAdmin;
  if (typeof patch?.suspended === 'boolean') want.suspended = patch.suspended;
  return tx(async c => {
    await c.query('SELECT pg_advisory_xact_lock($1)', [ADMIN_LOCK]);
    const actor = await actorOf(c, actorId);
    const t = await lockTarget(c, uid);
    const target = { id: String(t.id), isAdmin: !!t.is_admin, suspended: !!t.suspended_at };
    // Sólo lo que de verdad cambia: pedir lo que ya hay no escribe nada ni deja rastro
    const change = {};
    if (want.username !== undefined && want.username !== t.username) change.username = want.username;
    if (want.isAdmin !== undefined && want.isAdmin !== target.isAdmin) change.isAdmin = want.isAdmin;
    if (want.suspended !== undefined && want.suspended !== target.suspended) change.suspended = want.suspended;
    if (!Object.keys(change).length) return userNow(c, uid);
    const activeAdmins = (await c.query('SELECT count(*)::int AS n FROM bets.users WHERE is_admin AND suspended_at IS NULL')).rows[0].n;
    const err = checkUserChange({ actorId: String(actorId), target, patch: change, activeAdmins });
    if (err) throw fail(err, 400);
    try {
      if (change.username !== undefined) await c.query('UPDATE bets.users SET username = $2 WHERE id = $1', [uid, change.username]);
      if (change.isAdmin !== undefined) await c.query('UPDATE bets.users SET is_admin = $2 WHERE id = $1', [uid, change.isAdmin]);
      if (change.suspended !== undefined) await c.query('UPDATE bets.users SET suspended_at = $2 WHERE id = $1', [uid, change.suspended ? new Date() : null]);
    } catch (e) {
      if (e.code === '23505') throw fail('Ese usuario ya existe', 409);
      throw e;
    }
    // Al suspender, sus sesiones dejan de valer ya (userOf además rechaza a los suspendidos)
    if (change.suspended === true) await c.query('DELETE FROM bets.sessions WHERE user_id = $1', [uid]);
    if (change.username !== undefined) await logAction(c, actor, 'user.rename', t, { from: t.username, to: change.username });
    if (change.isAdmin !== undefined) await logAction(c, actor, 'user.role', t, { admin: change.isAdmin });
    if (change.suspended !== undefined) await logAction(c, actor, change.suspended ? 'user.suspend' : 'user.unsuspend', t);
    return userNow(c, uid);
  });
}

// La contraseña temporal no se guarda en ninguna parte salvo como hash; se cierran todas las sesiones de esa cuenta
async function setPassword(actorId, id, password) {
  const uid = idOf(id);
  validPassword(password);
  const hash = await hashPassword(password);
  return tx(async c => {
    const actor = await actorOf(c, actorId);
    const t = await lockTarget(c, uid);
    await c.query('UPDATE bets.users SET password_hash = $2 WHERE id = $1', [uid, hash]);
    await c.query('DELETE FROM bets.sessions WHERE user_id = $1', [uid]);
    await logAction(c, actor, 'user.password', t);
    return { ok: true };
  });
}

async function closeSessions(actorId, id) {
  const uid = idOf(id);
  return tx(async c => {
    const actor = await actorOf(c, actorId);
    const t = await lockTarget(c, uid);
    const closed = (await c.query('DELETE FROM bets.sessions WHERE user_id = $1', [uid])).rowCount;
    await logAction(c, actor, 'user.sessions', t, { closed });
    return { closed };
  });
}

// Borrar arrastra por cascada apuestas, amigos, mensajes y avisos. En el registro queda el nombre de la cuenta borrada
async function deleteUser(actorId, id, confirm) {
  const uid = idOf(id);
  return tx(async c => {
    await c.query('SELECT pg_advisory_xact_lock($1)', [ADMIN_LOCK]);
    const actor = await actorOf(c, actorId);
    const t = await lockTarget(c, uid);
    const err = checkDelete({ actorId: String(actorId), target: { id: String(t.id), isAdmin: !!t.is_admin, suspended: !!t.suspended_at }, confirm, targetName: t.username });
    if (err) throw fail(err, 400);
    await c.query('DELETE FROM bets.users WHERE id = $1', [uid]);
    await logAction(c, actor, 'user.delete', t, { wasAdmin: !!t.is_admin });
    return { ok: true };
  });
}

// Más recientes primero; before es el id de la última fila vista
async function listLog({ limit, before } = {}) {
  const n = Math.min(500, Math.max(1, Number(limit) || 100));
  const args = [], where = [];
  if (/^\d+$/.test(String(before ?? ''))) { args.push(before); where.push(`id < $${args.length}`); }
  args.push(n);
  const { rows } = await query(`SELECT id, at, admin_id, admin_name, action, target_id, target_name, detail FROM bets.admin_log
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY id DESC LIMIT $${args.length}`, args);
  return rows.map(r => ({ id: String(r.id), at: r.at, adminId: r.admin_id == null ? null : String(r.admin_id), adminName: r.admin_name,
    action: r.action, targetId: r.target_id == null ? null : String(r.target_id), targetName: r.target_name, detail: r.detail }));
}

module.exports = { toAdminUser, listUsers, updateUser, setPassword, closeSessions, deleteUser, listLog };
