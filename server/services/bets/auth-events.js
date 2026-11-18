// Registro de accesos (bets.auth_events) y limpieza de lo viejo. Guarda IP: son datos personales y se conservan 90 días
// (lo dice la política de privacidad). Nunca debe impedir entrar: si falla al escribir, sólo avisa en el log.
const { query } = require('../../shared/db');

const KINDS = ['login_ok', 'login_fail', 'register', 'register_blocked'];
const KEEP_EVENTS_DAYS = 90, KEEP_LOG_DAYS = 365;

// Al fallar un acceso sólo se anota el nombre si esa cuenta existe: quien se equivoca y escribe su contraseña en el campo de
// usuario no la deja guardada en el registro
const usernameToLog = (exists, typed) => (exists ? String(typed ?? '').slice(0, 30) : null);

async function record(kind, { userId = null, username = null, ip = null } = {}) {
  try {
    await query('INSERT INTO bets.auth_events (kind, user_id, username, ip) VALUES ($1, $2, $3, $4)', [kind, userId, username, ip ? String(ip).slice(0, 64) : null]);
  } catch (e) { console.warn('registro de accesos:', e.message); }
}

const toEvent = r => ({ id: String(r.id), at: r.at, kind: r.kind, userId: r.user_id == null ? null : String(r.user_id), username: r.username, ip: r.ip });

// Más recientes primero; before es el id de la última fila vista, para pedir la página siguiente
async function list({ kind, limit, before } = {}) {
  const n = Math.min(500, Math.max(1, Number(limit) || 100));
  const args = [], where = [];
  if (KINDS.includes(kind)) { args.push(kind); where.push(`kind = $${args.length}`); }
  if (/^\d+$/.test(String(before ?? ''))) { args.push(before); where.push(`id < $${args.length}`); }
  args.push(n);
  const { rows } = await query(`SELECT id, at, kind, user_id, username, ip FROM bets.auth_events ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY id DESC LIMIT $${args.length}`, args);
  return rows.map(toEvent);
}

async function purge() {
  const a = await query(`DELETE FROM bets.auth_events WHERE at < now() - interval '${KEEP_EVENTS_DAYS} days'`);
  const b = await query(`DELETE FROM bets.admin_log WHERE at < now() - interval '${KEEP_LOG_DAYS} days'`);
  return a.rowCount + b.rowCount;
}

// Al arrancar y cada 24 h
function startPurge() {
  const run = () => purge().catch(e => console.warn('limpieza de accesos:', e.message));
  run();
  setInterval(run, 24 * 3600e3).unref();
}

module.exports = { KINDS, usernameToLog, record, list, purge, startPurge };
