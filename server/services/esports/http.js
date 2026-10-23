// fetch con timeout y una caché en memoria muy simple para no saturar las APIs gratuitas.
const cache = new Map();

async function getJson(url, { headers = {}, ttl = 0, timeout = 15000 } = {}) {
  if (ttl > 0) {
    const hit = cache.get(url);
    if (hit && Date.now() - hit.t < ttl) return hit.v;
  }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'LoLEsportsTracker/0.3 (app de escritorio personal)', Accept: 'application/json', ...headers },
      signal: ctrl.signal
    });
    if (res.status === 204) return null;
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`HTTP ${res.status} en ${new URL(url).host}: ${body.slice(0, 200)}`);
    }
    const v = await res.json();
    if (ttl > 0) cache.set(url, { t: Date.now(), v });
    return v;
  } catch (e) {
    if (e.name === 'AbortError') throw new Error(`Tiempo de espera agotado (${new URL(url).host})`);
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

function qs(params) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') p.set(k, v);
  return p.toString();
}

module.exports = { getJson, qs };
