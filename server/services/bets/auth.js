// Usuarios y sesiones. El gateway pregunta aquí quién es cada petición y pasa el usuario a los servicios.
const crypto = require('crypto');
const { promisify } = require('util');
const { query, tx } = require('../../shared/db');
const { fail } = require('../../shared/service');
const store = require('./store');
const google = require('./google');

const scrypt = promisify(crypto.scrypt);
const COOKIE = 'lolet_session';
const SESSION_DAYS = 30;
const MAX_FAILS = 5, LOCK_MS = 60e3;
const FIRST_USER_LOCK = 727001; // dos registros a la vez no pueden ser los dos el primero

const sha = t => crypto.createHash('sha256').update(String(t)).digest('hex');
// google y googleEmail: si tiene Google vinculado; hasPassword: si puede entrar también con contraseña (quien se registró con
// Google no tiene hasta que se la pone en «Tu cuenta»)
const toUser = r => ({ id: String(r.id), username: r.username, isAdmin: r.is_admin, google: !!r.google_sub, googleEmail: r.google_email || null, hasPassword: !!r.password_hash });

async function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  return `${salt}:${(await scrypt(password, salt, 64)).toString('hex')}`;
}

async function checkPassword(password, stored) {
  if (!stored) return false;
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

// Con HTTPS (COOKIE_SECURE=1 en el .env, o el proxy avisa con X-Forwarded-Proto) la cookie sólo viaja cifrada
const isSecure = req => process.env.COOKIE_SECURE === '1' || String(req?.headers?.['x-forwarded-proto'] || '').split(',')[0].trim() === 'https';

// Se añade a las que ya haya: al volver de Google se borra además la cookie del intento (google.js)
function setCookie(res, token, maxAge, secure) {
  const prev = res.getHeader('Set-Cookie');
  res.setHeader('Set-Cookie', [...(prev ? [].concat(prev) : []), `${COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAge}${secure ? '; Secure' : ''}`]);
}

async function openSession(res, userId, secure) {
  const token = crypto.randomBytes(32).toString('hex');
  await query('DELETE FROM bets.sessions WHERE expires_at < now()');
  await query(`INSERT INTO bets.sessions (token_hash, user_id, expires_at) VALUES ($1, $2, now() + interval '${SESSION_DAYS} days')`, [sha(token), userId]);
  setCookie(res, token, SESSION_DAYS * 86400, secure);
}

// ---------- Límites de intentos (en memoria: se reinician con el servicio) ----------
// IP del cliente: nginx la pone en X-Real-IP (y se pisa, no se acepta la que mande el cliente)
const ipOf = req => String(req?.headers?.['x-real-ip'] || req?.socket?.remoteAddress || 'desconocida');

// Cuenta eventos por clave en una ventana; devuelve true si ya se pasó del máximo
function limiter(max, windowMs) {
  const m = new Map();
  const prune = () => { if (m.size > 20000) { const now = Date.now(); for (const [k, v] of m) if (v.until < now) m.delete(k); } };
  return {
    blocked(key) { const v = m.get(key); return !!v && v.n >= max && Date.now() < v.until; },
    add(key) { prune(); const v = m.get(key); m.set(key, v && Date.now() < v.until ? { n: v.n + 1, until: v.until } : { n: 1, until: Date.now() + windowMs }); },
    clear(key) { m.delete(key); }
  };
}
const loginPair = limiter(MAX_FAILS, LOCK_MS);          // misma IP y mismo usuario: 5 fallos → 1 minuto
const loginIp = limiter(30, 10 * 60e3);                 // una IP que prueba muchos usuarios: 30 fallos → 10 minutos
const registerIp = limiter(5, 60 * 60e3);               // altas desde una IP: 5 por hora

async function config() {
  const { rows } = await query('SELECT count(*)::int AS n FROM bets.users');
  const first = rows[0].n === 0;
  return { first, signupOpen: first || (await store.getSettings(null)).signupOpen !== false, google: google.enabled() };
}

// ADMIN_USER y ADMIN_PASSWORD en el .env: si aún no hay usuarios se crea ese administrador al arrancar, y así el primer
// registro de la web nunca es el administrador por casualidad. Si ya hay usuarios no hace nada (no pisa contraseñas)
async function bootstrapAdmin() {
  const username = String(process.env.ADMIN_USER || '').trim();
  const password = process.env.ADMIN_PASSWORD;
  if (!username || !password) return;
  if (!/^[\p{L}\p{N}_.-]{3,30}$/u.test(username)) throw new Error('ADMIN_USER no es válido (3 a 30 letras, números o . _ -)');
  validPassword(password);
  const hash = await hashPassword(password);
  await tx(async c => {
    await c.query('SELECT pg_advisory_xact_lock($1)', [FIRST_USER_LOCK]);
    if ((await c.query('SELECT 1 FROM bets.users LIMIT 1')).rowCount) return;
    const { rows } = await c.query('INSERT INTO bets.users (username, password_hash, is_admin) VALUES ($1, $2, true) RETURNING *', [username, hash]);
    await store.claimExisting(c, rows[0].id);
    console.log(`Administrador creado: ${username}`);
  });
}

async function register(body, req, res) {
  const ip = ipOf(req);
  if (registerIp.blocked(ip)) throw fail('Demasiados registros desde esta conexión: prueba más tarde', 429);
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
  registerIp.add(ip);
  await openSession(res, user.id, isSecure(req));
  return toUser(user);
}

// El bloqueo es por IP (y usuario), no sólo por usuario: así nadie puede dejar sin acceso a otro repitiendo su nombre
async function login(body, req, res) {
  const ip = ipOf(req);
  const username = String(body?.username || '').trim();
  const pair = `${ip}|${username.toLowerCase()}`;
  if (loginPair.blocked(pair) || loginIp.blocked(ip)) throw fail('Demasiados intentos: espera un poco', 429);
  const { rows } = await query('SELECT * FROM bets.users WHERE lower(username) = lower($1)', [username]);
  const ok = await checkPassword(body?.password ?? '', rows[0]?.password_hash || await DUMMY);
  if (!ok || !rows[0]) {
    loginPair.add(pair);
    loginIp.add(ip);
    throw fail('Usuario o contraseña incorrectos', 401);
  }
  loginPair.clear(pair);
  await openSession(res, rows[0].id, isSecure(req));
  return toUser(rows[0]);
}

async function logout(req, res) {
  const token = cookieOf(req);
  if (token) await query('DELETE FROM bets.sessions WHERE token_hash = $1', [sha(token)]);
  setCookie(res, '', 0, isSecure(req));
}

// Usuario de un token, o null si no hay sesión o ha caducado
async function userOf(token) {
  if (!token) return null;
  const { rows } = await query(`SELECT u.* FROM bets.sessions s JOIN bets.users u ON u.id = s.user_id
    WHERE s.token_hash = $1 AND s.expires_at > now()`, [sha(token)]);
  return rows[0] ? toUser(rows[0]) : null;
}

// Al cambiarla se cierran las sesiones de los demás dispositivos, pero no la de éste. Quien entró sólo con Google no tiene
// contraseña: se pone una sin que se le pida la actual
async function changePassword(userId, req, body) {
  validPassword(body?.next);
  const { rows } = await query('SELECT password_hash FROM bets.users WHERE id = $1', [userId]);
  if (!rows[0]) throw fail('Inicia sesión', 401);
  if (rows[0].password_hash && !(await checkPassword(body?.current ?? '', rows[0].password_hash))) throw fail('La contraseña actual no es correcta', 403);
  await query('UPDATE bets.users SET password_hash = $2 WHERE id = $1', [userId, await hashPassword(body.next)]);
  await query('DELETE FROM bets.sessions WHERE user_id = $1 AND token_hash <> $2', [userId, sha(cookieOf(req))]);
}

// ---------- Google (google.js) ----------
const googleStart = (req, res, q) => google.start(req, res, q, { secure: isSecure(req) });
function googleCallback(req, res, q) {
  const ip = ipOf(req);
  return google.callback(req, res, q, {
    secure: isSecure(req),
    firstUserLock: FIRST_USER_LOCK,
    currentUser: r => userOf(cookieOf(r)),
    signupOpen: async () => (await store.getSettings(null)).signupOpen !== false,
    claimExisting: store.claimExisting,
    registerBlocked: () => registerIp.blocked(ip),
    registered: () => registerIp.add(ip),
    openSession: (r, id) => openSession(r, id, isSecure(req))
  });
}

module.exports = { bootstrapAdmin, config, register, login, logout, userOf, changePassword, cookieOf, hashPassword, googleStart, googleCallback };
