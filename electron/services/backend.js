// Cliente del backend (gateway en 127.0.0.1:47365). El proceso principal hace todas las peticiones;
// el renderer sigue hablando sólo con window.api.
const http = require('http');

const BASE = process.env.LOLET_BACKEND || 'http://127.0.0.1:47365';
const DOWN = 'El servidor de la app no responde. Arranca el backend con «npm run backend» (hace falta Docker Desktop encendido).';

async function call(method, path, body) {
  let res;
  try {
    res = await fetch(BASE + path, {
      method,
      headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(180e3) // las stats esperan en la cola de Leaguepedia
    });
  } catch (e) {
    if (e.name === 'TimeoutError') throw new Error('El servidor de la app tarda demasiado en responder');
    throw new Error(DOWN);
  }
  const j = await res.json().catch(() => null);
  if (!j) throw new Error(`El servidor ha respondido HTTP ${res.status}`);
  if (j.ok === false) throw new Error(j.error || 'Error del servidor');
  return j.data;
}

const get = (path, params) => {
  const q = params ? new URLSearchParams(Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== '')).toString() : '';
  return call('GET', q ? `${path}?${q}` : path);
};

// Avisos en vivo del backend (SSE): cuotas nuevas y progreso de los trabajos. Se reconecta solo.
function events({ onEvent, onConnect, onDisconnect }) {
  let connected = false;
  const retry = () => { if (connected) { connected = false; onDisconnect?.(); } setTimeout(connect, 3000); };
  function connect() {
    let over = false;
    const again = () => { if (!over) { over = true; retry(); } };
    const req = http.get(BASE + '/events', res => {
      if (res.statusCode !== 200) { res.resume(); return again(); }
      connected = true;
      onConnect?.();
      res.setEncoding('utf8');
      let buf = '';
      res.on('data', chunk => {
        buf += chunk;
        let i;
        while ((i = buf.indexOf('\n\n')) >= 0) {
          const block = buf.slice(0, i);
          buf = buf.slice(i + 2);
          const data = block.split('\n').filter(l => l.startsWith('data: ')).map(l => l.slice(6)).join('\n');
          if (data) try { onEvent(JSON.parse(data)); } catch (_) {}
        }
      });
      res.on('close', again);
      res.on('error', again);
    });
    req.on('error', again);
  }
  connect();
}

module.exports = { call, get, events, BASE };
