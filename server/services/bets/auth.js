// Usuarios y sesiones. El gateway pregunta aquí quién es cada petición y pasa el usuario a los servicios.
const crypto = require('crypto');
const { promisify } = require('util');
const { query, tx } = require('../../shared/db');
const { fail } = require('../../shared/service');
const store = require('./store');

const scrypt = promisify(crypto.scrypt);
const COOKIE = 'lolet_session';
const SESSION_DAYS = 30;
const MAX_FAILS = 5, LOCK_MS = 60e3;
const FIRST_USER_LOCK = 727001; // dos registros a la vez no pueden ser los dos el primero

const sha = t => crypto.createHash('sha256').update(String(t)).digest('hex');
const toUser = r => ({ id: String(r.id), username: r.username, isAdmin: r.is_admin });

async function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  return `${salt}:${(await scrypt(password, salt, 64)).toString('hex')}`;
}

async function checkPassword(password, stored) {
  const [salt, hash] = stored.split(':');
  return crypto.timingSafeEqual(await scrypt(String(password), salt, 64), Buffer.from(hash, 'hex'));
}
// Se comprueba igual si el usuario no existe, para no delatar por el tiempo de respuesta cuáles existen
const DUMMY = hashPassword('sin-usuario');

function validPassword(password) {
  if (typeof password !== 'string' || password.length < 8) throw fail('La contraseña necesita al menos 8 caracteres');
  if (password.length > 200) throw fail('La contraseña es demasiado larga');
}

function cookieOf(req) {
  for (const part of String(req.headers.cookie || '').split(';')) {
    const [k, v] = part.trim().split('=');
    if (k === COOKIE) return v;
  }
  return null;
}

function setCookie(res, token, maxAge) {
  res.setHeader('Set-Cookie', `${COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAge}`);
}

async function openSession(res, userId) {
  const token = crypto.randomBytes(32).toString('hex');
  await query('DELETE FROM bets.sessions WHERE expires_at < now()');
  await query(`INSERT INTO bets.sessions (token_hash, user_id, expires_at) VALUES ($1, $2, now() + interval '${SESSION_DAYS} days')`, [sha(token), userId]);
  setCookie(res, token, SESSION_DAYS * 86400);
}

async function config() {
  const { rows } = await query('SELECT count(*)::int AS n FROM bets.users');
  const first = rows[0].n === 0;
  return { first, signupOpen: first || (await store.getSettings(null)).signupOpen !== false };
}

async function register(body, res) {
  const username = String(body?.username || '').trim();
  if (!/^[\p{L}\p{N}_.-]{3,30}$/u.test(username)) throw fail('El usuario debe tener de 3 a 30 letras, números o . _ -');
  validPassword(body?.password);
  const hash = await hashPassword(body.password);
  const user = await tx(async c => {
    await c.query('SELECT pg_advisory_xact_lock($1)', [FIRST_USER_LOCK]);
    const first = (await c.query('SELECT 1 FROM bets.users LIMIT 1')).rowCount === 0;
    if (!first && (await store.getSettings(null)).signupOpen === false) throw fail('El registro está cerrado: pídele una cuenta al administrador', 403);
    const { rows } = await c.query(`INSERT INTO bets.users (username, password_hash, is_admin) VALUES ($1, $2, $3)
      ON CONFLICT (lower(username)) DO NOTHING RETURNING *`, [username, hash, first]);
    if (!rows[0]) throw fail('Ese usuario ya existe', 409);
    if (first) await store.claimExisting(c, rows[0].id);
    return rows[0];
  });
  await openSession(res, user.id);
  return toUser(user);
}

// Intentos fallidos por usuario, en memoria: basta para frenar a quien pruebe contraseñas desde la red
const fails = new Map();

async function login(body, res) {
  const username = String(body?.username || '').trim();
  const key = username.toLowerCase();
  const f = fails.get(key);
  if (f && f.n >= MAX_FAILS && Date.now() < f.until) throw fail('Demasiados intentos: espera un minuto', 429);
  const { rows } = await query('SELECT * FROM bets.users WHERE lower(username) = lower($1)', [username]);
  const ok = await checkPassword(body?.password ?? '', rows[0]?.password_hash || await DUMMY);
  if (!ok || !rows[0]) {
    const n = f && Date.now() < f.until ? f.n + 1 : 1;
    fails.set(key, { n, until: Date.now() + LOCK_MS });
    throw fail('Usuario o contraseña incorrectos', 401);
  }
  fails.delete(key);
  await openSession(res, rows[0].id);
  return toUser(rows[0]);
}

async function logout(req, res) {
  const token = cookieOf(req);
  if (token) await query('DELETE FROM bets.sessions WHERE token_hash = $1', [sha(token)]);
  setCookie(res, '', 0);
}

// Usuario de un token, o null si no hay sesión o ha caducado
async function userOf(token) {
  if (!token) return null;
  const { rows } = await query(`SELECT u.* FROM bets.sessions s JOIN bets.users u ON u.id = s.user_id
    WHERE s.token_hash = $1 AND s.expires_at > now()`, [sha(token)]);
  return rows[0] ? toUser(rows[0]) : null;
}

// Al cambiarla se cierran las sesiones de los demás dispositivos, pero no la de éste
async function changePassword(userId, req, body) {
  validPassword(body?.next);
  const { rows } = await query('SELECT password_hash FROM bets.users WHERE id = $1', [userId]);
  if (!rows[0] || !(await checkPassword(body?.current ?? '', rows[0].password_hash))) throw fail('La contraseña actual no es correcta', 403);
  await query('UPDATE bets.users SET password_hash = $2 WHERE id = $1', [userId, await hashPassword(body.next)]);
  await query('DELETE FROM bets.sessions WHERE user_id = $1 AND token_hash <> $2', [userId, sha(cookieOf(req))]);
}

module.exports = { config, register, login, logout, userOf, changePassword, cookieOf, hashPassword };
