// Servidor HTTP mínimo para cada servicio (sin framework, sólo node:http).
// Rutas: [método, '/ruta/:param', handler]. El handler recibe { req, res, params, query, body }.
// Las rutas /api/* y /internal/* responden { ok: true, data } o { ok: false, error }, igual que el IPC de Electron.
// Las demás (las del marcador y la extensión) devuelven lo que devuelva el handler tal cual.
const http = require('http');

const MAX_BODY = 12e6; // las fotos de las páginas de las casas pesan bastante

function compile(pattern) {
  const keys = [];
  const re = new RegExp('^' + pattern.replace(/:(\w+)/g, (_, k) => (keys.push(k), '([^/]+)')) + '$');
  return { re, keys };
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let s = '';
    req.setEncoding('utf8');
    req.on('data', c => {
      s += c;
      if (s.length > MAX_BODY) { reject(Object.assign(new Error('Petición demasiado grande'), { status: 413 })); req.destroy(); }
    });
    req.on('end', () => {
      if (!s) return resolve(undefined);
      // La extensión manda JSON como text/plain (para evitar la petición previa de CORS)
      try { resolve(JSON.parse(s)); } catch (_) { reject(new Error('El cuerpo no es JSON válido')); }
    });
    req.on('error', reject);
  });
}

function send(res, code, value) {
  if (res.headersSent) return;
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(value));
}

// Error con código HTTP (por defecto 400)
const fail = (msg, status = 400) => Object.assign(new Error(msg), { status });

function start({ name, port, routes, health }) {
  const table = [
    ['GET', '/health', async () => (health ? await health() : true)],
    ...routes
  ].map(([method, pattern, fn]) => ({ method, fn, wrap: /^\/(api|internal)\//.test(pattern) || pattern === '/health', ...compile(pattern) }));

  const server = http.createServer(async (req, res) => {
    const u = new URL(req.url, 'http://localhost');
    let params = null;
    const hit = table.find(r => {
      if (r.method !== req.method) return false;
      const m = u.pathname.match(r.re);
      if (m) params = Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]));
      return !!m;
    });
    if (!hit) return send(res, 404, { ok: false, error: `${name}: no existe ${req.method} ${u.pathname}` });
    try {
      const body = req.method === 'GET' ? undefined : await readBody(req);
      const out = await hit.fn({ req, res, params, query: Object.fromEntries(u.searchParams), body });
      if (res.headersSent || res.writableEnded) return;
      send(res, 200, hit.wrap ? { ok: true, data: out === undefined ? null : out } : out);
    } catch (e) {
      if (!e.status || e.status >= 500) console.error(`[${name}] ${req.method} ${u.pathname}:`, e);
      send(res, e.status || 500, { ok: false, error: e.message || String(e) });
    }
  });
  server.listen(port, '0.0.0.0', () => console.log(`${name} escuchando en el puerto ${port}`));
  return server;
}

module.exports = { start, fail, send };
