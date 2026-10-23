// gateway: única puerta del backend en 127.0.0.1:47365 (el mismo puerto que usaban el marcador y la extensión).
// Reparte cada petición a su servicio y reenvía a la app los avisos de PostgreSQL (LISTEN lolet) por SSE.
const http = require('http');
const { Client } = require('pg');
const { URLS } = require('../../shared/client');

const PORT = Number(process.env.PORT) || 47365;

// Prefijo de la ruta → servicio. /internal/* no se publica: es sólo entre servicios.
const ROUTES = [
  [/^\/api\/(bets|settings|legacy)(\/|$)/, 'bets'],
  [/^\/api\/(esports|stats)(\/|$)/, 'esports'],
  [/^\/api\/odds(\/|$)/, 'odds'],
  [/^\/(odds|bet365|snapshot|auto|jobs)(\/|$)/, 'odds']
];

const json = (res, code, v) => { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(v)); };

function proxy(req, res, service) {
  const target = new URL(req.url, URLS[service]);
  const up = http.request(target, { method: req.method, headers: { ...req.headers, host: target.host } }, r => {
    res.writeHead(r.statusCode || 502, { ...r.headers, 'access-control-allow-origin': '*' });
    r.pipe(res);
  });
  up.setTimeout(180e3, () => up.destroy(new Error('tiempo de espera agotado')));
  up.on('error', e => { if (!res.headersSent) json(res, 502, { ok: false, error: `El servicio ${service} no responde (${e.message})` }); else res.end(); });
  req.pipe(up);
}

// ---------- Avisos en vivo (SSE) ----------
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
  // CORS + acceso a red local para que la página de la casa pueda llamar a 127.0.0.1
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Private-Network', 'true');
  if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
  const { pathname } = new URL(req.url, 'http://localhost');

  if (pathname === '/ping') return json(res, 200, { ok: true });
  if (pathname === '/api/health') return json(res, 200, { ok: true, data: await health() });
  if (pathname === '/events') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
    res.write(': conectado\n\n');
    clients.add(res);
    const ping = setInterval(() => res.write(': ping\n\n'), 25e3);
    req.on('close', () => { clearInterval(ping); clients.delete(res); });
    return;
  }
  const hit = ROUTES.find(([re]) => re.test(pathname));
  if (!hit) return json(res, 404, { ok: false, error: `No existe ${req.method} ${pathname}` });
  proxy(req, res, hit[1]);
});

server.listen(PORT, '0.0.0.0', () => console.log(`gateway escuchando en el puerto ${PORT}`));
listen();
