// Entrar o crear la cuenta con Google: OAuth 2.0 con OpenID Connect, flujo de código con PKCE. Es gratis: sólo hace falta un
// cliente OAuth de tipo "Aplicación web" en Google Cloud, con GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET y PUBLIC_URL en el .env y
// la dirección de vuelta <PUBLIC_URL>/api/auth/google/callback autorizada allí. Sin esas variables el botón no sale.
//
// 1. /api/auth/google guarda en una cookie corta un state y un verificador PKCE al azar y manda a Google.
// 2. Google vuelve a /api/auth/google/callback con un código y el state: si no coincide con la cookie, se descarta (así nadie
//    puede colar su propia cuenta de Google en la sesión de otro).
// 3. El código se cambia por el id_token directamente con Google por HTTPS, y se comprueba de quién es y para quién.
// 4. Con ese usuario de Google se entra; si no existe, se crea la cuenta (mismas reglas que el registro: el primero es el
//    administrador y con el registro cerrado no se crean). Con ?link=1 y sesión abierta, se vincula a la cuenta actual.
const crypto = require('crypto');
const { query, tx } = require('../../shared/db');
const { fail } = require('../../shared/service');

const AUTH = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN = 'https://oauth2.googleapis.com/token';
const FLOW = 'lolet_google';
const FLOW_MAX_AGE = 600; // diez minutos para elegir la cuenta en Google
const ISSUERS = ['https://accounts.google.com', 'accounts.google.com'];

const env = () => ({ id: process.env.GOOGLE_CLIENT_ID || '', secret: process.env.GOOGLE_CLIENT_SECRET || '', base: String(process.env.PUBLIC_URL || '').replace(/\/+$/, '') });
const enabled = () => { const e = env(); return !!(e.id && e.secret && e.base); };
const redirectUri = () => `${env().base}/api/auth/google/callback`;
const b64url = buf => Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const rand = n => b64url(crypto.randomBytes(n));

// ---------- piezas sin red (las prueba server/test/google.test.js) ----------
// Usuario para una cuenta nueva: la parte de su correo antes de la @, con las mismas reglas que el registro
// (3 a 30 letras, números o . _ -). Si no sirve, su nombre; y si tampoco, "usuario"
function usernameBase(email, name) {
  const clean = s => String(s || '').normalize('NFC').replace(/[^\p{L}\p{N}_.-]+/gu, '').replace(/^[._-]+|[._-]+$/g, '').slice(0, 30);
  for (const c of [clean(String(email || '').split('@')[0]), clean(String(name || '').replace(/\s+/g, '.'))]) if (c.length >= 3) return c;
  return 'usuario';
}
// El primero libre: base, base2, base3… (recortando la base para no pasar de 30)
function freeUsername(base, taken) {
  const used = new Set([...taken].map(x => String(x).toLowerCase()));
  if (!used.has(base.toLowerCase())) return base;
  for (let i = 2; i < 10000; i++) { const c = `${base.slice(0, 30 - String(i).length)}${i}`; if (!used.has(c.toLowerCase())) return c; }
  return `${base.slice(0, 22)}${crypto.randomInt(1e7)}`;
}
// El id_token llega directo de Google por HTTPS (paso 3), así que vale lo que dice (OpenID Connect, 3.1.3.7): se comprueba
// que lo ha emitido Google, que es para esta app, que no ha caducado y que el correo está verificado
function claimsOf(idToken, clientId, now = Date.now()) {
  let c;
  try { c = JSON.parse(Buffer.from(String(idToken).split('.')[1], 'base64url').toString('utf8')); } catch { throw fail('Google no ha devuelto una identidad válida'); }
  if (!ISSUERS.includes(c.iss)) throw fail('La identidad no la ha emitido Google');
  if (c.aud !== clientId && !(Array.isArray(c.aud) && c.aud.includes(clientId))) throw fail('La identidad de Google no es para esta app');
  if (!(Number(c.exp) * 1000 > now)) throw fail('La identidad de Google ha caducado: vuelve a probar');
  if (!c.sub) throw fail('Google no ha dicho qué cuenta es');
  if (c.email && c.email_verified === false) throw fail('Tu correo de Google no está verificado');
  return { sub: String(c.sub), email: c.email ? String(c.email) : null, name: c.name ? String(c.name) : null };
}

// ---------- cookies ----------
const flowCookie = (value, maxAge, secure) => `${FLOW}=${value}; HttpOnly; SameSite=Lax; Path=/api/auth/google; Max-Age=${maxAge}${secure ? '; Secure' : ''}`;
function readFlow(req) {
  for (const part of String(req.headers.cookie || '').split(';')) {
    const [k, v] = part.trim().split('=');
    if (k !== FLOW || !v) continue;
    try { const f = JSON.parse(Buffer.from(v, 'base64url').toString('utf8')); return f && typeof f.state === 'string' && typeof f.verifier === 'string' ? f : null; } catch { return null; }
  }
  return null;
}
function addCookie(res, c) { const prev = res.getHeader('Set-Cookie'); res.setHeader('Set-Cookie', [...(prev ? [].concat(prev) : []), c]); }
function redirect(res, to) { res.writeHead(302, { Location: to, 'Cache-Control': 'no-store' }); res.end(); }

// ---------- rutas ----------
function start(req, res, q, { secure }) {
  if (!enabled()) throw fail('Entrar con Google no está configurado', 404);
  const flow = { state: rand(16), verifier: rand(32), link: q.link === '1' };
  addCookie(res, flowCookie(b64url(JSON.stringify(flow)), FLOW_MAX_AGE, secure));
  const params = new URLSearchParams({
    client_id: env().id, redirect_uri: redirectUri(), response_type: 'code', scope: 'openid email profile', state: flow.state,
    code_challenge: b64url(crypto.createHash('sha256').update(flow.verifier).digest()), code_challenge_method: 'S256', prompt: 'select_account'
  });
  redirect(res, `${AUTH}?${params}`);
}

async function identity(code, verifier) {
  const e = env();
  const r = await fetch(TOKEN, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, signal: AbortSignal.timeout(15000),
    body: new URLSearchParams({ code, client_id: e.id, client_secret: e.secret, redirect_uri: redirectUri(), grant_type: 'authorization_code', code_verifier: verifier })
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.id_token) throw fail(`Google no ha aceptado la entrada (${j.error_description || j.error || r.status})`);
  return claimsOf(j.id_token, e.id);
}

// deps: lo que pone auth.js (sesiones, límites de registro, administrador), para no repetirlo aquí
async function callback(req, res, q, deps) {
  const flow = readFlow(req);
  addCookie(res, flowCookie('', 0, deps.secure));
  // Vuelve a la web: con ?login_error=… la pantalla de entrada (o «Tu cuenta», al vincular) lo enseña
  const back = (msg, link) => redirect(res, msg ? `/?login_error=${encodeURIComponent(msg)}` : link ? '/?google=vinculada' : '/');
  try {
    if (q.error) return back(q.error === 'access_denied' ? 'Has cancelado la entrada con Google' : `Google ha devuelto un error (${q.error})`);
    if (!flow || !q.state || q.state !== flow.state || !q.code) return back('La entrada con Google ha caducado o no es válida: vuelve a probar');
    const g = await identity(String(q.code), flow.verifier);

    if (flow.link) {
      const me = await deps.currentUser(req);
      if (!me) return back('Para vincular Google tienes que haber entrado antes con tu cuenta');
      const moved = await tx(async c => {
        const other = (await c.query('SELECT id, username, is_admin, password_hash FROM bets.users WHERE google_sub = $1 FOR UPDATE', [g.sub])).rows[0];
        let freed = null;
        if (other && String(other.id) !== String(me.id)) {
          // Si esa cuenta de Google sólo tiene una cuenta vacía, la que se creó sola al entrar con ella (sin contraseña, sin
          // apuestas ni ajustes propios y sin ser administrador), es la misma persona: el vínculo pasa aquí y la vacía se borra.
          // Si tiene algo suyo, no se toca
          const used = other.is_admin || !!other.password_hash
            || (await c.query('SELECT 1 FROM bets.bets WHERE user_id = $1 UNION ALL SELECT 1 FROM bets.user_settings WHERE user_id = $1 LIMIT 1', [other.id])).rowCount > 0;
          if (used) throw fail(`Esa cuenta de Google ya es la del usuario «${other.username}», que tiene sus propios datos. Entra con Google para usarla.`, 409);
          await c.query('DELETE FROM bets.users WHERE id = $1', [other.id]);
          freed = other.username;
        }
        await c.query('UPDATE bets.users SET google_sub = $2, google_email = $3 WHERE id = $1', [me.id, g.sub, g.email]);
        return freed;
      });
      return redirect(res, moved ? `/?google=vinculada&borrada=${encodeURIComponent(moved)}` : '/?google=vinculada');
    }

    let user = (await query('SELECT * FROM bets.users WHERE google_sub = $1', [g.sub])).rows[0];
    if (user) {
      if (g.email && g.email !== user.google_email) await query('UPDATE bets.users SET google_email = $2 WHERE id = $1', [user.id, g.email]);
    } else {
      if (deps.registerBlocked()) return back('Demasiados registros desde esta conexión: prueba más tarde');
      user = await tx(async c => {
        await c.query('SELECT pg_advisory_xact_lock($1)', [deps.firstUserLock]);
        const first = (await c.query('SELECT 1 FROM bets.users LIMIT 1')).rowCount === 0;
        if (!first && !(await deps.signupOpen())) throw fail('El registro está cerrado: pídele una cuenta al administrador', 403);
        const base = usernameBase(g.email, g.name);
        const taken = (await c.query('SELECT username FROM bets.users WHERE lower(username) LIKE lower($1) || \'%\'', [base.slice(0, 20)])).rows.map(r => r.username);
        const { rows } = await c.query(`INSERT INTO bets.users (username, password_hash, is_admin, google_sub, google_email) VALUES ($1, NULL, $2, $3, $4) RETURNING *`,
          [freeUsername(base, taken), first, g.sub, g.email]);
        if (first) await deps.claimExisting(c, rows[0].id);
        return rows[0];
      });
      deps.registered();
    }
    await deps.openSession(res, user.id);
    return back(null);
  } catch (e) {
    if (!e.status || e.status >= 500) console.error('[bets] Google:', e.message);
    return back(e.message || 'No se ha podido entrar con Google');
  }
}

module.exports = { enabled, start, callback, usernameBase, freeUsername, claimsOf };
