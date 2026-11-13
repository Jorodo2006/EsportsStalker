// mma-svc: MMA (UFC y PFL de ESPN; WOW de wowmma.com): carteleras, combates en hora de España, directo, ficha y buscador.
// Caché en memoria y en mma.cache (por si la fuente no responde).
const path = require('path');
const { start, fail } = require('../../shared/service');
const { migrate, query } = require('../../shared/db');
const { cachedJSON, warmEvery } = require('../../shared/cached');
const { hits, queryOf } = require('../../shared/search');
const { dayStart, madridDay, addDays, compact } = require('./dates');
const espn = require('./espn');
const wow = require('./wow');
const hist = require('./history');
const { picksFor } = require('./picks');

const getJSON = cachedJSON({ table: 'mma.cache', saveEvery: 60e3 });

const valid = d => { if (!/^\d{4}-\d{2}-\d{2}$/.test(d || '')) throw fail('Fecha no válida (AAAA-MM-DD)'); return d; };

// Organizaciones: para añadir otra de ESPN basta una línea en espn.ORGS
const LEAGUES = {
  ...Object.fromEntries(Object.entries(espn.ORGS).map(([id, o]) => [id, { id, name: o.name, logo: o.logo, source: 'espn' }])),
  wow: { id: 'wow', name: 'WOW', logo: '', source: 'wow' }
};
const leagues = () => Object.values(LEAGUES);

// Combates de las organizaciones entre dos días de Madrid. ESPN trae el evento por fecha UTC, así que se pide un día de más
// por cada lado y se filtra por el día de España de cada combate
async function between(from, to, opts = {}) {
  const a = dayStart(from), b = dayStart(addDays(to, 1));
  // WOW no tiene API y puede ir lento: va a la vez que ESPN y con un tope de 4 s (si falla, salen UFC y PFL igualmente)
  const [espnLists, wowList] = await Promise.all([
    Promise.all(Object.keys(espn.ORGS).map(org =>
      espn.fights(getJSON, org, compact(addDays(from, -1)), compact(addDays(to, 1)), opts.ttl, opts.results)
        .catch(e => { console.error(`[mma] ${org}:`, e.message); return []; }))),
    wow.recentWithin(4000)
  ]);
  const lists = [...espnLists, wowList];
  const seen = new Set();
  return lists.flat().filter(f => {
    const t = new Date(f.date).getTime();
    if (seen.has(f.id) || !Number.isFinite(t) || t < a || t >= b) return false;
    seen.add(f.id);
    return true;
  }).sort((x, y) => new Date(x.date) - new Date(y.date) || y.cardPos - x.cardPos);
}

const live = async () => {
  const t = madridDay(Date.now());
  return (await between(addDays(t, -1), t)).filter(f => f.state === 'in');
};

// Un combate por id ("ufc:401928118"). Con su día (la apuesta lo sabe) se mira ese día y los dos de al lado; sin él, dos meses a
// cada lado. El resultado sólo se pide de ese combate
async function detail(id, date) {
  const [org, comp] = String(id || '').split(':');
  if (!LEAGUES[org] || !comp) throw fail('Combate desconocido');
  const t = madridDay(Date.now());
  const near = date && /^\d{4}-\d{2}-\d{2}$/.test(date);
  const f = org === 'wow' ? (await wow.event(comp).catch(() => [])).find(x => x.id === id)
    : (await (near ? between(addDays(date, -1), addDays(date, 1), { results: false }) : between(addDays(t, -60), addDays(t, 60), { results: false, ttl: 10 * 60e3 }))).find(x => x.id === id);
  if (!f) throw fail('Combate no encontrado', 404);
  if (f.state === 'post' && org !== 'wow') await espn.withResult(getJSON, f);
  return { fight: f };
}

// Buscador: combates de ayer a dentro de una semana y organizaciones (shared/search.js)
async function search(raw) {
  const q = queryOf(raw);
  if (!q) return { matches: [], competitions: [] };
  const t = madridDay(Date.now());
  const list = await between(addDays(t, -1), addDays(t, 7));
  const side = x => [x.name, x.short, ...x.alt];
  const matches = list.filter(f => hits(q, [...side(f.a), ...side(f.b), f.event]) || hits(q, [f.orgName])).map(f => ({
    sport: 'mma', id: f.id, home: f.a.name, away: f.b.name, league: f.orgName, stage: f.event, date: f.date, state: f.state, status: f.status,
    score: null, team: hits(q, [...side(f.a), ...side(f.b)])
  }));
  const competitions = leagues().filter(l => hits(q, [l.name])).map(l => ({
    sport: 'mma', id: l.id, name: l.name, sub: 'MMA', next: list.filter(f => f.org === l.id && f.state !== 'post')[0]?.date || null
  }));
  return { matches, competitions };
}

// Elo y datos de los dos luchadores para el modelo, a la fecha del combate
async function ctxFor(f) {
  const { ratings } = await hist.all();
  const at = new Date(f.date).getTime();
  return { a: hist.fighterCtx(ratings, f.a, at), b: hist.fighterCtx(ratings, f.b, at) };
}
const fightOf = async (date, id) => {
  const f = (await between(valid(date), valid(date))).find(x => x.id === id);
  if (!f) throw fail('Combate no encontrado', 404);
  return f;
};
const dayPicks = new Map();

const routes = [
  ['GET', '/api/mma/search', ({ query: q }) => search(q.q)],
  ['GET', '/api/mma/leagues', () => leagues()],
  ['GET', '/api/mma/games', ({ query: q }) => between(valid(q.date), valid(q.date))],
  ['GET', '/api/mma/days', async ({ query: q }) => {
    const from = valid(q.from), n = Math.min(21, Math.max(1, Number(q.n) || 7));
    const list = await between(from, addDays(from, n - 1));
    const out = {};
    for (let i = 0; i < n; i++) out[addDays(from, i)] = { total: 0, live: 0 };
    for (const f of list) { const d = out[madridDay(new Date(f.date).getTime())]; if (d) { d.total++; if (f.state === 'in') d.live++; } }
    return out;
  }],
  ['GET', '/api/mma/live', () => live()],
  ['GET', '/api/mma/match', ({ query: q }) => detail(q.id, q.date)],
  ['GET', '/api/mma/ranking', () => hist.ranking()],
  // Edad, altura, alcance, KO y sumisiones de un luchador de ESPN (los de WOW traen sus datos en el propio combate)
  ['GET', '/api/mma/profile', async ({ query: q }) => {
    if (!/^\d{1,12}$/.test(String(q.id || ''))) throw fail('Luchador desconocido');
    return espn.profile(getJSON, q.id).catch(e => { throw fail(`Sin ficha de ESPN (${e.message})`, 404); });
  }],
  ['GET', '/api/mma/fighter', async ({ query: q }) => {
    if (!/^[A-Za-z0-9:-]{1,80}$/.test(String(q.id || ''))) throw fail('Luchador desconocido');
    const card = await hist.fighterCard(q.id);
    if (!card) throw fail('Luchador no encontrado', 404);
    return card;
  }],
  // Recomendaciones de un combate (modelo + cuotas), o las mejores de un día entre los combates con cuotas leídas
  ['GET', '/api/mma/picks', async ({ query: q }) => { const f = await fightOf(q.date, q.id); return picksFor(f, await ctxFor(f)); }],
  ['GET', '/api/mma/picks/day', async ({ query: q }) => {
    const date = valid(q.date);
    const hit = dayPicks.get(date);
    if (hit && Date.now() - hit.t < 60e3) return hit.v;
    const list = (await between(date, date)).filter(f => f.state === 'pre' && !f.cancelled);
    const out = [];
    for (const f of list) {
      const r = await picksFor(f, await ctxFor(f)).catch(e => { console.error('[mma] recomendaciones:', f.id, e.message); return null; });
      if (r?.ready && r.top) out.push({ id: f.id, org: f.org, orgName: f.orgName, date: f.date, a: f.a, b: f.b, top: r.top, hard: r.hard[0] ?? null });
    }
    out.sort((x, y) => y.top.p - x.top.p);
    if (dayPicks.size > 30) dayPicks.clear();
    dayPicks.set(date, { t: Date.now(), v: out });
    return out;
  }]
];

// Combates de ayer a mañana y directos siempre preparados: el primero que entra no espera a ESPN
warmEvery('mma', 4 * 60e3, () => { const t = madridDay(Date.now()); return Promise.all([between(addDays(t, -1), addDays(t, 1)), live()]); });

// El historial (Elo) se prepara al arrancar: la primera vez son unas 30 peticiones a ESPN
warmEvery('mma-historial', 5 * 3600e3, () => hist.all(), 15000);

migrate('mma', path.join(__dirname, 'migrations'))
  .then(() => query(`DELETE FROM mma.cache WHERE key NOT LIKE 'hist:%' AND t < now() - interval '30 days'`))
  .then(() => start({ name: 'mma', port: Number(process.env.PORT) || 4007, routes, health: async () => (await query('SELECT 1'), true) }))
  .catch(e => { console.error(e); process.exit(1); });
