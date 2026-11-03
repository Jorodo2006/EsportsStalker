// Caché de las peticiones a las fuentes de baloncesto: en memoria y en basket.cache.
// Si la fuente falla se sirve lo último guardado. keep: los datos que no cambian (box scores terminados) se leen de la
// base de datos aunque la memoria esté vacía, sin volver a pedirlos.
const { query } = require('../../shared/db');

const mem = new Map();

async function getJSON(url, ttlMs, { keep = false } = {}) {
  const hit = mem.get(url);
  if (hit && (keep || Date.now() - hit.t < ttlMs)) return hit.v;
  if (keep) {
    const row = (await query('SELECT value FROM basket.cache WHERE key = $1', [url]).catch(() => ({ rows: [] }))).rows[0];
    if (row) { mem.set(url, { t: Date.now(), v: row.value }); return row.value; }
  }
  try {
    const res = await fetch(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(20000) });
    if (!res.ok) throw new Error(`respondió ${res.status}`);
    const v = await res.json();
    mem.set(url, { t: Date.now(), v });
    query(`INSERT INTO basket.cache (key, value, t) VALUES ($1, $2::jsonb, now())
      ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, t = EXCLUDED.t`, [url, JSON.stringify(v)])
      .catch(e => console.error('basket.cache:', e.message));
    return v;
  } catch (e) {
    const old = hit?.v ?? (await query('SELECT value FROM basket.cache WHERE key = $1', [url]).catch(() => ({ rows: [] }))).rows[0]?.value;
    if (old) return old;
    throw new Error(`No se pudo leer ${new URL(url).hostname} (${e.message})`);
  }
}

// Al arrancar: fuera lo viejo, salvo los box scores (que se reaprovechan toda la temporada)
const init = () => query(`DELETE FROM basket.cache WHERE t < now() - interval '7 days' AND key NOT LIKE '%/stats'`);

module.exports = { getJSON, init };
