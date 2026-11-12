// Caché de las peticiones JSON a fuentes externas (ESPN) de tenis y fútbol: en memoria y en la tabla <esquema>.cache de cada
// servicio (cada uno pasa la suya: ninguno toca la de otro).
// - Fresco (menos de ttl): se devuelve tal cual.
// - Caducado hace poco (menos de STALE): se devuelve al momento y se renueva por detrás. ESPN tarda 1-2 s y nadie tiene que
//   esperarlo si hay algo de hace un rato. Recién arrancado se aprovecha lo guardado en la tabla, con su hora.
// - Más viejo: se espera a lo nuevo, para no enseñar un marcador de hace media hora. Si la fuente falla, lo último guardado.
// Dos peticiones a la vez por lo mismo comparten la descarga. En la tabla se guarda como mucho cada saveEvery: es sólo una copia
// por si la fuente no responde, y un mes de una liga pesa cientos de KB.
const { query } = require('./db');

const STALE = 10 * 60e3;

function cachedJSON({ table, saveEvery, label = 'ESPN', timeout = 20000 }) {
  const mem = new Map(), saved = new Map(), pending = new Map();
  const fromDb = async url => (await query(`SELECT value, t FROM ${table} WHERE key = $1`, [url]).catch(() => ({ rows: [] }))).rows[0];

  function load(url, hit) {
    if (pending.has(url)) return pending.get(url);
    const job = (async () => {
      try {
        const res = await fetch(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(timeout) });
        if (!res.ok) throw new Error(`respondió ${res.status}`);
        const v = await res.json();
        mem.set(url, { t: Date.now(), v });
        if (Date.now() - (saved.get(url) || 0) >= saveEvery) {
          saved.set(url, Date.now());
          query(`INSERT INTO ${table} (key, value, t) VALUES ($1, $2::jsonb, now()) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, t = EXCLUDED.t`,
            [url, JSON.stringify(v)]).catch(e => console.error(`${table}:`, e.message));
        }
        return v;
      } catch (e) {
        const old = hit?.v ?? (await fromDb(url))?.value;
        if (old) return old;
        throw new Error(`No se pudo leer ${label} (${e.message})`);
      } finally { pending.delete(url); }
    })();
    pending.set(url, job);
    return job;
  }

  return async function getJSON(url, ttlMs) {
    let hit = mem.get(url);
    if (!hit) {
      const row = await fromDb(url);
      if (row) { hit = { t: new Date(row.t).getTime(), v: row.value }; mem.set(url, hit); }
    }
    const age = hit ? Date.now() - hit.t : Infinity;
    if (age < ttlMs) return hit.v;
    if (age < ttlMs + STALE) { load(url, hit).catch(() => {}); return hit.v; }
    return load(url, hit);
  };
}

// Repite fn cada `every` desde el arranque (tras `delay`), sin que un fallo pare las siguientes: tiene preparados los datos que
// más se piden (partidos de hoy, directos) para que el primero que entre no espere a ESPN
function warmEvery(name, every, fn, delay = 5000) {
  const run = () => Promise.resolve().then(fn).catch(e => console.error(`[${name}] precalentar:`, e.message));
  setTimeout(() => { run(); setInterval(run, every).unref(); }, delay).unref();
}

module.exports = { cachedJSON, warmEvery, STALE };
