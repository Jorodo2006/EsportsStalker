// Caché de las peticiones a las fuentes de baloncesto: en memoria y en basket.cache.
// Si la fuente falla se sirve lo último guardado. keep: los datos que no cambian (box scores terminados, días ya jugados)
// se leen de la base de datos aunque la memoria esté vacía, sin volver a pedirlos.
const { query } = require('../../shared/db');

const mem = new Map();
const pending = new Map(); // lo que ya se está pidiendo: dos pantallas a la vez no repiten la petición

const stored = async key => (await query('SELECT value FROM basket.cache WHERE key = $1', [key]).catch(() => ({ rows: [] }))).rows[0]?.value;

async function fetchJSON(url) {
  try {
    const res = await fetch(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(20000) });
    if (!res.ok) throw new Error(`respondió ${res.status}`);
    return await res.json();
  } catch (e) {
    throw new Error(`No se pudo leer ${new URL(url).hostname} (${e.message})`);
  }
}

// Guarda lo que devuelva fn. Sirve para quedarse sólo con lo necesario: el log de un jugador de ESPN pesa 700 KB y de él
// se usan 15 KB, y una jornada completa son 340 jugadores
async function remember(key, ttlMs, fn, { keep = false } = {}) {
  const hit = mem.get(key);
  if (hit && (keep || Date.now() - hit.t < ttlMs)) return hit.v;
  if (keep) {
    const v = await stored(key);
    if (v !== undefined) { mem.set(key, { t: Date.now(), v }); return v; }
  }
  if (pending.has(key)) return pending.get(key);
  const job = (async () => {
    try {
      const v = await fn();
      mem.set(key, { t: Date.now(), v });
      query(`INSERT INTO basket.cache (key, value, t) VALUES ($1, $2::jsonb, now())
        ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, t = EXCLUDED.t`, [key, JSON.stringify(v)])
        .catch(e => console.error('basket.cache:', e.message));
      return v;
    } catch (e) {
      const old = hit?.v ?? await stored(key);
      if (old !== undefined) return old;
      throw e;
    } finally { pending.delete(key); }
  })();
  pending.set(key, job);
  return job;
}

const getJSON = (url, ttlMs, opts) => remember(url, ttlMs, () => fetchJSON(url), opts);

// Peticiones en bloque (toda la temporada de una liga, los jugadores de una jornada): como mucho 8 a la vez entre todas,
// para no lanzar cientos de golpe contra la fuente
const BULK = 8;
let busy = 0;
const waiting = [];
function bulk(fn) {
  return new Promise((resolve, reject) => {
    const run = () => {
      busy++;
      Promise.resolve().then(fn).then(resolve, reject).finally(() => { busy--; waiting.shift()?.(); });
    };
    if (busy < BULK) run(); else waiting.push(run);
  });
}

// Al arrancar: fuera lo viejo, salvo lo que no cambia y se reaprovecha toda la temporada
const init = () => query(`DELETE FROM basket.cache WHERE t < now() - interval '7 days' AND key NOT LIKE '%/stats' AND key NOT LIKE 'keep:%'`);

module.exports = { getJSON, remember, fetchJSON, bulk, init };
