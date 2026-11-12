// fetch con timeout y una caché en memoria muy simple para no saturar las APIs gratuitas. Lo caducado hace poco (hasta tres
// veces su duración, como mucho 10 minutos) se devuelve al momento y se renueva por detrás: nadie espera a lolesports si hay
// algo de hace un rato. Dos peticiones a la vez por lo mismo comparten la descarga.
const cache = new Map();

async function fetchJson(url, headers, timeout) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Sharpex/0.3 (uso personal)', Accept: 'application/json', ...headers },
      signal: ctrl.signal
    });
    if (res.status === 204) return null;
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`HTTP ${res.status} en ${new URL(url).host}: ${body.slice(0, 200)}`);
    }
    return await res.json();
  } catch (e) {
    if (e.name === 'AbortError') throw new Error(`Tiempo de espera agotado (${new URL(url).host})`);
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

async function getJson(url, { headers = {}, ttl = 0, timeout = 15000 } = {}) {
  if (!(ttl > 0)) return fetchJson(url, headers, timeout);
  const hit = cache.get(url);
  const age = hit ? Date.now() - hit.t : Infinity;
  if (hit && age < ttl) return hit.v;
  const running = hit?.running || fetchJson(url, headers, timeout).then(v => { cache.set(url, { t: Date.now(), v }); return v; })
    .finally(() => { const h = cache.get(url); if (h?.running === running) h.running = null; });
  if (hit) hit.running = running; else cache.set(url, { t: 0, v: undefined, running });
  if (hit && hit.v !== undefined && age < ttl + Math.min(ttl * 3, 10 * 60e3)) { running.catch(() => {}); return hit.v; }
  return running;
}

function qs(params) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') p.set(k, v);
  return p.toString();
}

module.exports = { getJson, qs };
