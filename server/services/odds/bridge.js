// Puente de las cuotas: recibe lo que leen de las páginas de Winamax y Betway el lector de Docker (server/lector),
// la extensión o el marcador de Chrome, y lleva los trabajos de lectura. Bet365 se quitó (no se deja leer desde Docker).
// Todo se guarda en PostgreSQL (esquema odds); el gateway publica estas rutas en 127.0.0.1:47365.
const fs = require('fs');
const path = require('path');
const { query, tx, notify } = require('../../shared/db');
const { orient } = require('./equipos');

const TTL_SQL = `interval '6 hours'`; // una importación vale 6 horas: el doble del tramo más espaciado del programador
const HISTORY_DAYS = 365; // lo que se guarda del histórico de cuotas
const SAME_MATCH = 12 * 3600; // misma pareja con el inicio a menos de 12 h: es el mismo partido, aunque se haya movido la hora
const BOOKS = ['winamax', 'betway'];
const MANUAL_WAIT = 30e3; // si ningún lector coge un trabajo manual en 30 s, se da por perdido
const AUTO_WAIT_MIN = 10; // los programados esperan en cola hasta 10 min (el lector puede estar ocupado)
const CAPTURAS = process.env.CAPTURAS_DIR || null;

const keyOf = m => `${m.a?.name}|${m.b?.name}`;
const ms = d => (d ? new Date(d).getTime() : null);

// ---------- Partidos ----------
async function noteMatch(m) {
  if (!m?.a?.name || !m?.b?.name) return;
  const team = t => JSON.stringify({ name: t.name, code: t.code || '' });
  await query(`INSERT INTO odds.matches (key, a, b, start, sport, league, seen_at) VALUES ($1, $2::jsonb, $3::jsonb, $4, $5, $6, now())
    ON CONFLICT (key) DO UPDATE SET seen_at = now(), start = COALESCE(EXCLUDED.start, odds.matches.start),
      sport = EXCLUDED.sport, league = COALESCE(EXCLUDED.league, odds.matches.league)`,
  [keyOf(m), team(m.a), team(m.b), m.start || null, m.sport || 'lol', m.league || null]);
}

const recent = async () => (await query('SELECT key, a, b FROM odds.matches ORDER BY seen_at DESC LIMIT 30')).rows;

// ¿A qué partido de la app pertenece? Por el trabajo; si no, por los equipos de la página; si no, el último abierto
async function assign(p) {
  const job = p.job && await getJob(p.job);
  if (job) return { key: keyOf(job.match), a: job.match.a, b: job.match.b, sport: job.match.sport };
  const list = await recent();
  if (p.home && p.away) for (const r of list) if (orient(r.a, r.b, p.home, p.away)) return r;
  const parts = String(p.title || '').split(/\s+(?:v|vs|-)\s+/i);
  const low = `${p.title}\n${p.header || ''}`.toLowerCase();
  const has = t => [t.name, t.code].filter(x => x && x.length >= 2).some(x => low.includes(x.toLowerCase()));
  for (const r of list) {
    if (parts.length >= 2 && orient(r.a, r.b, parts[0], parts[1])) return r;
    if (has(r.a) && has(r.b)) return r;
  }
  return list[0] || null;
}

// ---------- Importaciones ----------
// Guarda lo leído. Devuelve la respuesta para el lector y, aparte, el partido y la entrada (para el normalizador)
async function add(payload) {
  if (payload?.type !== 'LOL_ET' || !BOOKS.includes(payload.book)) throw Object.assign(new Error('No son cuotas del marcador'), { status: 400 });
  const m = await assign(payload);
  const matchKey = m?.key || null;
  if (m?.sport) payload.sport = m.sport; // el normalizador de cuotas cambia según el deporte
  const map = Number(payload.map) || 1;
  const page = payload.page ? String(payload.page) : null;
  const id = await tx(async c => {
    // Cada página de la casa (pestaña) sustituye sólo a la misma página; las antiguas sin página, por mapa
    await c.query(`DELETE FROM odds.imports WHERE match_key IS NOT DISTINCT FROM $1 AND book = $2 AND (
      $2 = 'winamax' OR (CASE WHEN $3::text IS NOT NULL AND page IS NOT NULL THEN page = $3 ELSE map = $4 END))`,
    [matchKey, payload.book, page, map]);
    const r = await c.query(`INSERT INTO odds.imports (match_key, book, page, map, payload) VALUES ($1, $2, $3, $4, $5::jsonb) RETURNING id`,
      [matchKey, payload.book, page, map, JSON.stringify(payload)]);
    if (m && payload.url) {
      await c.query(`INSERT INTO odds.book_urls (match_key, book, url) VALUES ($1, $2, $3)
        ON CONFLICT (match_key, book) DO UPDATE SET url = EXCLUDED.url, updated_at = now()`, [matchKey, payload.book, String(payload.url)]);
    }
    return r.rows[0].id;
  });
  notify('odds:imported', { matchKey, book: payload.book });
  const entry = { ...payload, id, map, matchKey, ts: Date.now() };
  return { res: { ok: true, partido: m ? `${m.a.name} vs ${m.b.name}` : null }, match: m, entry };
}

const toImport = r => ({ ...r.payload, id: r.id, map: r.map, matchKey: r.match_key, ts: ms(r.ts) });

async function forMatch(m) {
  const { rows } = await query(`SELECT id, match_key, map, payload, ts FROM odds.imports
    WHERE match_key = $1 AND ts > now() - ${TTL_SQL} ORDER BY ts DESC`, [keyOf(m)]);
  return rows.map(toImport);
}

const setMoneyline = (id, ml) => query('UPDATE odds.imports SET ml = $2::jsonb WHERE id = $1', [id, JSON.stringify(ml)]);

// Mejor cuota de ganador de cada partido entre las casas con importaciones vigentes: { matchKey: { a, b } }, y x (empate) en fútbol
async function moneylines(events) {
  const keys = [...new Set(events.map(keyOf))];
  if (!keys.length) return {};
  const { rows } = await query(`SELECT match_key, max((ml->>'a')::float) AS a, max((ml->>'b')::float) AS b, max((ml->>'x')::float) AS x FROM odds.imports
    WHERE match_key = ANY($1) AND ml IS NOT NULL AND ts > now() - ${TTL_SQL} GROUP BY match_key`, [keys]);
  return Object.fromEntries(rows.map(r => [r.match_key, { a: r.a, b: r.b, ...(r.x ? { x: r.x } : {}) }]));
}

// Filas del histórico de este partido (y no de otro anterior entre los mismos equipos). $1 es el inicio
const sameMatch = `(match_start IS NOT DISTINCT FROM $1::timestamptz OR abs(extract(epoch FROM match_start - $1::timestamptz)) < ${SAME_MATCH})`;

// Histórico: si la cuota no ha cambiado se alarga su tramo (last_seen); si ha cambiado, se abre uno nuevo
async function recordPrices(matchKey, book, rows) {
  if (!matchKey || !rows.length) return;
  const start = (await query('SELECT start FROM odds.matches WHERE key = $1', [matchKey])).rows[0]?.start || null;
  const { rows: last } = await query(`SELECT DISTINCT ON (market_key, outcome_id) id, market_key, outcome_id, price FROM odds.price_history
    WHERE ${sameMatch} AND match_key = $2 AND book = $3 ORDER BY market_key, outcome_id, ts DESC`, [start, matchKey, book]);
  const prev = new Map(last.map(r => [`${r.market_key}\u0000${r.outcome_id}`, r]));
  const same = [], changed = [];
  for (const r of rows) {
    const p = prev.get(`${r.market_key}\u0000${r.outcome_id}`);
    if (p?.price === r.price) same.push(p.id); else changed.push(r);
  }
  if (same.length) await query('UPDATE odds.price_history SET last_seen = now() WHERE id = ANY($1::bigint[])', [same]);
  if (!changed.length) return;
  const cols = ['market_key', 'market', 'outcome_id', 'outcome', 'line', 'price'];
  await query(`INSERT INTO odds.price_history (match_key, book, match_start, ${cols.join(', ')})
    SELECT $1, $2, $3, * FROM jsonb_to_recordset($4::jsonb) AS x(market_key text, market text, outcome_id text, outcome text, line float, price float)`,
  [matchKey, book, start, JSON.stringify(changed.map(r => Object.fromEntries(cols.map(c => [c, r[c] ?? null]))))]);
}

// Histórico de un partido, del más antiguo al más nuevo: un tramo por cuota y casa
async function priceHistory(m) {
  const key = keyOf(m);
  const start = m.start || (await query('SELECT start FROM odds.matches WHERE key = $1', [key])).rows[0]?.start || null;
  const { rows } = await query(`SELECT book, market_key, market, outcome_id, outcome, line, price, ts, last_seen FROM odds.price_history
    WHERE ${sameMatch} AND match_key = $2 ORDER BY ts, id`, [start, key]);
  return rows.map(r => ({ ...r, ts: ms(r.ts), last_seen: ms(r.last_seen) }));
}

// Fotos de las páginas de las casas (para ajustar los lectores): ficheros captura-<casa>-<nombre>.json
function saveSnapshot(s) {
  if (!CAPTURAS || !BOOKS.includes(s?.book)) return;
  const nombre = /^[a-z0-9-]{1,20}$/.test(s.nombre || '') ? s.nombre : 'marcador';
  fs.mkdirSync(CAPTURAS, { recursive: true });
  fs.writeFileSync(path.join(CAPTURAS, `captura-${s.book}-${nombre}.json`), JSON.stringify({ ...s, fecha: new Date().toISOString() }));
}

// ---------- Trabajos de la extensión ----------
function toJob(r) {
  if (!r) return null;
  return {
    id: r.id, match: r.match, books: r.books, source: r.source, steps: r.steps,
    created: ms(r.created), picked: !!r.picked_at, done: !!r.done_at, ...(r.error ? { error: r.error } : {})
  };
}

const getJob = async id => toJob((await query('SELECT * FROM odds.jobs WHERE id = $1', [String(id || '')])).rows[0]);

async function newJob(match, source = 'manual') {
  const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const steps = Object.fromEntries(BOOKS.map(b => [b, { estado: 'esperando', msg: '' }]));
  const team = t => ({ name: t.name, code: t.code || '', ...(Array.isArray(t.alt) && t.alt.length ? { alt: t.alt.map(String).slice(0, 4) } : {}) });
  // sport: 'lol' (por defecto), 'basket', 'tennis' o 'football'; el lector busca el partido en esa sección de cada casa
  const m = { a: team(match.a), b: team(match.b), ...(['basket', 'tennis', 'football'].includes(match.sport) ? { sport: match.sport, league: String(match.league || '') } : {}) };
  const { rows } = await query(`INSERT INTO odds.jobs (id, match_key, match, source, books, steps, start) VALUES ($1, $2, $3::jsonb, $4, $5, $6::jsonb, $7) RETURNING *`,
    [id, keyOf(m), JSON.stringify(m), source, BOOKS, JSON.stringify(steps), match.start || null]);
  const job = toJob(rows[0]);
  // Si la extensión no lo recoge, lo damos por perdido
  if (source === 'manual') setTimeout(() => finish(id, 'ningún lector lo ha cogido (¿está en marcha el contenedor lector?)', true).catch(() => {}), MANUAL_WAIT);
  notify('odds:auto', job);
  return job;
}

// Cierra el trabajo con error. onlyUnpicked: sólo si nadie lo ha cogido todavía
async function finish(id, error, onlyUnpicked) {
  const { rows } = await query(`UPDATE odds.jobs SET done_at = now(), error = $2 WHERE id = $1 AND done_at IS NULL
    ${onlyUnpicked ? 'AND picked_at IS NULL' : ''} RETURNING *`, [id, error]);
  if (rows[0]) notify('odds:auto', toJob(rows[0]));
}

async function jobProgress({ id, book, estado, msg }) {
  const { rows } = await query(`UPDATE odds.jobs SET
      steps = CASE WHEN $2::text IS NOT NULL AND steps ? $2 THEN jsonb_set(steps, ARRAY[$2], $3::jsonb) ELSE steps END,
      done_at = CASE WHEN $4 = 'fin' THEN COALESCE(done_at, now()) ELSE done_at END
    WHERE id = $1 RETURNING *`, [String(id || ''), book || null, JSON.stringify({ estado, msg: msg || '' }), estado]);
  if (!rows[0]) throw Object.assign(new Error('Trabajo desconocido'), { status: 404 });
  notify('odds:auto', toJob(rows[0]));
  return { ok: true };
}

const urlsFor = async key => Object.fromEntries((await query('SELECT book, url FROM odds.book_urls WHERE match_key = $1', [key])).rows.map(r => [r.book, r.url]));

// La extensión recoge el trabajo (lo marca como cogido) con las direcciones conocidas del partido
async function pickJob(id) {
  const { rows } = await query(`UPDATE odds.jobs SET picked_at = COALESCE(picked_at, now()) WHERE id = $1 AND done_at IS NULL
    RETURNING *`, [String(id || '')]);
  const r = rows[0];
  if (!r) return null;
  const job = toJob(r);
  notify('odds:auto', job);
  return { ...job, urls: await urlsFor(r.match_key) };
}

// El lector pregunta cada poco si hay algo que hacer: primero los manuales, luego los programados que empiezan antes
let lastPoll = null;
async function nextJob() {
  lastPoll = Date.now();
  const { rows } = await query(`UPDATE odds.jobs SET picked_at = now() WHERE id = (
      SELECT id FROM odds.jobs WHERE done_at IS NULL AND picked_at IS NULL
      ORDER BY (source = 'manual') DESC, start NULLS LAST, created LIMIT 1 FOR UPDATE SKIP LOCKED
    ) RETURNING *`);
  if (!rows[0]) return null;
  const job = toJob(rows[0]);
  notify('odds:auto', job);
  return { ...job, urls: await urlsFor(rows[0].match_key) };
}

// Limpieza periódica: importaciones caducadas, histórico antiguo, trabajos viejos y programados que nadie ha cogido
async function cleanup() {
  await query(`DELETE FROM odds.imports WHERE ts < now() - ${TTL_SQL}`);
  await query(`DELETE FROM odds.price_history WHERE ts < now() - interval '${HISTORY_DAYS} days'`);
  await query(`DELETE FROM odds.jobs WHERE created < now() - interval '2 days'`);
  const { rows } = await query(`UPDATE odds.jobs SET done_at = now(), error = 'ningún lector lo ha cogido'
    WHERE done_at IS NULL AND picked_at IS NULL AND source = 'auto' AND created < now() - interval '${AUTO_WAIT_MIN} minutes' RETURNING *`);
  // Un trabajo cogido que lleva más de 15 min sin acabar: la extensión se ha quedado a medias
  const stuck = await query(`UPDATE odds.jobs SET done_at = now(), error = 'la extensión no ha terminado'
    WHERE done_at IS NULL AND picked_at < now() - interval '15 minutes' RETURNING *`);
  for (const r of [...rows, ...stuck.rows]) notify('odds:auto', toJob(r));
}

async function importUrls(urls) {
  let n = 0;
  for (const [key, books] of Object.entries(urls || {})) {
    for (const [book, url] of Object.entries(books || {})) {
      if (!BOOKS.includes(book) || !url) continue;
      await query(`INSERT INTO odds.book_urls (match_key, book, url) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`, [key, book, String(url)]);
      n++;
    }
  }
  return n;
}

module.exports = {
  BOOKS, keyOf, noteMatch, add, forMatch, setMoneyline, moneylines, recordPrices, priceHistory, saveSnapshot,
  newJob, getJob, pickJob, nextJob, jobProgress, cleanup, importUrls, lastPoll: () => lastPoll
};
