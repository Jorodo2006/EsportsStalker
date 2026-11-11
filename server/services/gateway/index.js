// gateway: única puerta del backend en 127.0.0.1:47365 (el mismo puerto que usaban el marcador y la extensión).
// Reparte cada petición a su servicio y reenvía a la app los avisos de PostgreSQL (LISTEN lolet) por SSE.
const http = require('http');
const crypto = require('crypto');
const { Client } = require('pg');
const { URLS, call } = require('../../shared/client');

const internal = require('../../shared/internal');

const PORT = Number(process.env.PORT) || 47365;

// Con LECTOR_TOKEN (producción), las rutas del lector (/jobs, /odds…) exigen ese token y ya no se abren con CORS: sólo
// las usa el contenedor lector. Sin él (desarrollo) siguen abiertas, para el marcador y la extensión de reserva
const LECTOR_TOKEN = process.env.LECTOR_TOKEN || '';
function lectorTokenOk(req) {
  const got = Buffer.from(String(req.headers['x-lector-token'] || ''));
  const want = Buffer.from(LECTOR_TOKEN);
  return got.length === want.length && crypto.timingSafeEqual(got, want);
}

// Prefijo de la ruta → servicio. /internal/* no se publica: es sólo entre servicios.
const ROUTES = [
  [/^\/api\/(auth|bets|settings)(\/|$)/, 'bets'],
  [/^\/api\/(esports|stats)(\/|$)/, 'esports'],
  [/^\/api\/odds(\/|$)/, 'odds'],
  [/^\/api\/basket(\/|$)/, 'basket'],
  [/^\/api\/tennis(\/|$)/, 'tennis'],
  [/^\/api\/football(\/|$)/, 'football'],
  [/^\/(odds|bet365|snapshot|auto|jobs)(\/|$)/, 'odds']
];

// Lo único de /api que se puede usar sin sesión: entrar y registrarse
const PUBLIC = /^\/api\/auth\/(config|me|register|login|logout)$/;

const json = (res, code, v) => { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(v)); };

// Usuario de la cookie de sesión, o null
function sessionUser(req) {
  const m = String(req.headers.cookie || '').match(/(?:^|;\s*)lolet_session=([^;]+)/);
  return m ? call('bets', 'POST', '/internal/auth/session', { token: m[1] }) : null;
}

function proxy(req, res, service, user) {
  const target = new URL(req.url, URLS[service]);
  // Las cabeceras de usuario sólo las pone el gateway: las que manden de fuera se tiran
  const headers = { ...req.headers, host: target.host };
  delete headers['x-user-id'];
  delete headers['x-user-admin'];
  delete headers['x-user-sig'];
  delete headers['x-lector-token']; // el token del lector no sale del gateway
  if (user) {
    headers['x-user-id'] = user.id;
    headers['x-user-admin'] = user.isAdmin ? '1' : '0';
    const sig = internal.sign(headers['x-user-id'], headers['x-user-admin']);
    if (sig) headers['x-user-sig'] = sig;
  }
  const up = http.request(target, { method: req.method, headers }, r => {
    res.writeHead(r.statusCode || 502, { ...r.headers, ...(req.url.startsWith('/api/') || LECTOR_TOKEN ? {} : { 'access-control-allow-origin': '*' }) });
    r.pipe(res);
  });
  up.setTimeout(180e3, () => up.destroy(new Error('tiempo de espera agotado')));
  up.on('error', e => { if (!res.headersSent) json(res, 502, { ok: false, error: `El servicio ${service} no responde (${e.message})` }); else res.end(); });
  req.pipe(up);
}

// ---------- Avisos en vivo (SSE) ----------
// Buscador de la cabecera: pregunta a la vez a los cuatro deportes (cada uno busca en lo suyo, /api/<servicio>/search) y
// junta lo que respondan; si uno tarda o falla, salen los demás. Primero lo que está en juego, luego lo que encaja por
// equipo o jugador (no sólo por la competición) y, dentro de eso, lo más cercano a ahora, antes lo que viene que lo pasado
const SEARCH = ['esports', 'basket', 'tennis', 'football'];
async function search(q) {
  const qs = String(q || '').trim().slice(0, 60);
  if (qs.length < 2) return { matches: [], competitions: [] };
  const parts = await Promise.all(SEARCH.map(svc => call(svc, 'GET', `/api/${svc}/search?q=${encodeURIComponent(qs)}`, undefined, 8000)
    .catch(e => { console.error(`[buscador] ${svc}:`, e.message); return { matches: [], competitions: [] }; })));
  const now = Date.now();
  const rank = m => (m.state === 'in' ? 0 : 1e13) + (m.team ? 0 : 1e12) + (+new Date(m.date) >= now - 3 * 3600e3 ? +new Date(m.date) - now : 1e11 + (now - +new Date(m.date)));
  const matches = parts.flatMap(p => p.matches || []).sort((a, b) => rank(a) - rank(b)).slice(0, 15);
  const competitions = parts.flatMap(p => p.competitions || []).slice(0, 8);
  return { matches, competitions };
}

const clients = new Set();
function broadcast(text) { for (const res of clients) res.write(`data: ${text}\n\n`); }

async function listen() {
  const c = new Client({ connectionString: process.env.DATABASE_URL });
  c.on('notification', n => broadcast(n.payload));
  // Si se cae la conexión, se vuelve a escuchar
  c.on('error', e => { console.error('LISTEN:', e.message); c.end().catch(() => {}); setTimeout(listen, 3000); });
  try {
    await c.connect();
    await c.query('LISTEN lolet');
    console.log('Escuchando avisos de PostgreSQL');
  } catch (e) {
    console.error('No se puede escuchar PostgreSQL:', e.message);
    c.end().catch(() => {});
    setTimeout(listen, 3000);
  }
}

async function health() {
  const out = { gateway: true };
  await Promise.all(Object.keys(URLS).map(async s => {
    try { out[s] = (await (await fetch(URLS[s] + '/health', { signal: AbortSignal.timeout(3000) })).json()).ok === true; }
    catch (_) { out[s] = false; }
  }));
  return out;
}

const server = http.createServer(async (req, res) => {
  // "//host/ruta" se interpretaría como otro servidor al construir la URL del servicio: sólo valen rutas que empiecen por una "/"
  if (!/^\/(?!\/|\\)/.test(req.url)) return json(res, 400, { ok: false, error: 'Ruta no válida' });
  const { pathname } = new URL(req.url, 'http://localhost');
  const isApi = pathname.startsWith('/api/');
  // CORS + acceso a red local para que la página de la casa pueda llamar a 127.0.0.1. La API de la web no lo
  // necesita (va por el mismo origen), y exigir JSON hace que otra web no pueda escribir en ella desde el navegador
  if (!isApi && !LECTOR_TOKEN) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, GET, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Access-Control-Allow-Private-Network', 'true');
  }
  if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
  if (isApi && ['POST', 'PUT'].includes(req.method) && !/^application\/json/i.test(req.headers['content-type'] || '')) {
    return json(res, 415, { ok: false, error: 'La API sólo acepta JSON' });
  }

  if (pathname === '/ping') return json(res, 200, { ok: true });
  if (LECTOR_TOKEN && !isApi && pathname !== '/events' && !lectorTokenOk(req)) return json(res, 401, { ok: false, error: 'Falta el token del lector' });
  if (pathname === '/api/health') return json(res, 200, { ok: true, data: await health() });
  // Toda la API y los avisos piden sesión. Las rutas del lector (/jobs, /odds…) no: nginx no las publica,
  // sólo se llega a ellas desde este equipo y no tienen datos de ningún usuario
  let user = null;
  if ((isApi && !PUBLIC.test(pathname)) || pathname === '/events') {
    try { user = await sessionUser(req); }
    catch (e) { return json(res, 502, { ok: false, error: `No se puede comprobar la sesión (${e.message})` }); }
    if (!user) return json(res, 401, { ok: false, error: 'Inicia sesión' });
  }
  if (pathname === '/events') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
    res.write(': conectado\n\n');
    clients.add(res);
    const ping = setInterval(() => res.write(': ping\n\n'), 25e3);
    req.on('close', () => { clearInterval(ping); clients.delete(res); });
    return;
  }
  if (pathname === '/api/search' && req.method === 'GET') return json(res, 200, { ok: true, data: await search(new URL(req.url, 'http://localhost').searchParams.get('q')) });
  const hit = ROUTES.find(([re]) => re.test(pathname));
  if (!hit) return json(res, 404, { ok: false, error: `No existe ${req.method} ${pathname}` });
  proxy(req, res, hit[1], user);
});

server.listen(PORT, '0.0.0.0', () => console.log(`gateway escuchando en el puerto ${PORT}`));
listen();
