// Llamadas entre servicios dentro de la red de Docker. Desenvuelve { ok, data } y lanza el error si ok es false.
const URLS = {
  bets: process.env.BETS_URL || 'http://bets:4003',
  esports: process.env.ESPORTS_URL || 'http://esports:4001',
  odds: process.env.ODDS_URL || 'http://odds:4002',
  basket: process.env.BASKET_URL || 'http://basket:4004',
  tennis: process.env.TENNIS_URL || 'http://tennis:4005',
  football: process.env.FOOTBALL_URL || 'http://football:4006'
};

async function call(service, method, path, body, timeout = 30000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await fetch(URLS[service] + path, {
      method,
      headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: ctrl.signal
    });
    const j = await res.json().catch(() => null);
    if (!j || j.ok === false) throw new Error(j?.error || `${service}: HTTP ${res.status}`);
    return j.data;
  } catch (e) {
    if (e.name === 'AbortError') throw new Error(`${service} no responde`);
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

// Ajustes efectivos (los guarda bets; lo del .env ya viene aplicado). Caché corta para no preguntar en cada petición.
let cached = null, cachedAt = 0;
async function settings() {
  if (cached && Date.now() - cachedAt < 10e3) return cached;
  cached = await call('bets', 'GET', '/internal/settings');
  cachedAt = Date.now();
  return cached;
}

module.exports = { call, settings, URLS };
