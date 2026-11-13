'use strict';
// Historial de combates terminados para el Elo y las fichas. ESPN se pide por trimestres (un mes entero pesa 300-400 KB) y se
// guarda reducido en mma.cache con clave "hist:" (esas filas no se borran con la limpieza: el pasado no cambia). Los de WOW
// salen de wowmma.com. Si una fuente falla se sigue con lo que haya: un Elo con menos datos es peor, no inútil.
const { query } = require('../../shared/db');
const { normalizeEvent, ORGS } = require('./espn');
const wow = require('./wow');
const M = require('./model');

const START = '2016-01-01'; // desde aquí se cuenta el Elo: con tres años salían pocos combates por luchador y el modelo apenas discriminaba
const SITE = org => `https://site.api.espn.com/apis/site/v2/sports/mma/${org}/scoreboard`;
const ymd = d => d.toISOString().slice(0, 10);

function quarters(now = new Date()) {
  const out = [];
  for (let y = +START.slice(0, 4); y <= now.getUTCFullYear(); y++) {
    for (let q = 0; q < 4; q++) {
      const from = new Date(Date.UTC(y, q * 3, 1)), to = new Date(Date.UTC(y, q * 3 + 3, 0));
      if (from > now) return out;
      out.push({ from: ymd(from), to: ymd(to) });
    }
  }
  return out;
}

// Sólo lo que hace falta del combate terminado
const compact = f => ({
  id: f.id, org: f.org, date: f.date, state: f.state, rounds: f.rounds, weightClass: f.weightClass, event: f.event,
  a: { id: f.a.id, name: f.a.name, record: f.a.record, age: f.a.age }, b: { id: f.b.id, name: f.b.name, record: f.b.record, age: f.b.age },
  result: f.result
});

async function stored(key) { return (await query('SELECT value FROM mma.cache WHERE key = $1', [key]).catch(() => ({ rows: [] }))).rows[0]?.value; }
const save = (key, v) => query(`INSERT INTO mma.cache (key, value, t) VALUES ($1, $2::jsonb, now()) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, t = EXCLUDED.t`, [key, JSON.stringify(v)]).catch(e => console.error('mma.cache:', e.message));

async function espnQuarter(org, q, now) {
  const key = `hist:${org}:${q.from}`;
  // Un trimestre ya cerrado hace más de 10 días no cambia; el actual y el anterior se renuevan cada 6 h
  const closed = new Date(q.to).getTime() < now - 10 * 864e5;
  const row = await query('SELECT value, t FROM mma.cache WHERE key = $1', [key]).then(r => r.rows[0]).catch(() => null);
  if (row && (closed || now - new Date(row.t).getTime() < 6 * 3600e3)) return row.value;
  try {
    const res = await fetch(`${SITE(org)}?dates=${q.from.replace(/-/g, '')}-${q.to.replace(/-/g, '')}`, { signal: AbortSignal.timeout(30000) });
    if (!res.ok) throw new Error(`respondió ${res.status}`);
    const j = await res.json();
    const list = (j.events || []).flatMap(e => normalizeEvent(e, org)).filter(f => f.state === 'post' && f.result).map(compact);
    // Un 200 sin combates (ESPN a medias) no se guarda: un trimestre cerrado se daría por vacío para siempre
    if (list.length) await save(key, list);
    return list;
  } catch (e) {
    console.error(`[mma] historial ${org} ${q.from}:`, e.message);
    return row?.value || [];
  }
}

let cache = null, pending = null;
async function all() {
  if (cache && Date.now() - cache.t < 6 * 3600e3) return cache;
  if (pending) return pending;
  pending = (async () => {
    const now = Date.now();
    const out = [];
    for (const org of Object.keys(ORGS)) for (const q of quarters(new Date(now))) out.push(...await espnQuarter(org, q, now));
    // WOW: todos sus eventos (unos 20, cada página se pide una vez al día)
    out.push(...(await wow.recent(60).catch(e => { console.error('[mma] historial WOW:', e.message); return []; })).filter(f => f.state === 'post' && f.result).map(compact));
    out.sort((x, y) => String(x.date).localeCompare(String(y.date)));
    cache = { t: Date.now(), fights: out, ratings: M.buildRatings(out) };
    return cache;
  })().finally(() => { pending = null; });
  return pending;
}

// Lo que necesita model.predict de un luchador: su Elo, combates, récord actual, edad (sólo WOW la da) y días sin pelear
function fighterCtx(ratings, fighter, atMs = Date.now()) {
  const r = ratings.get(fighter.id);
  return {
    elo: r?.elo ?? 1500, fights: r?.fights ?? 0, record: fighter.record || '', ageYears: fighter.age || undefined,
    daysSinceLast: r?.lastDate ? Math.max(0, (atMs - new Date(r.lastDate).getTime()) / 864e5) : undefined
  };
}

// Ficha de un luchador a partir de su historial
async function fighterCard(id) {
  const { fights, ratings } = await all();
  const mine = fights.filter(f => f.a.id === id || f.b.id === id);
  if (!mine.length && !ratings.has(id)) return null;
  const rows = mine.slice().reverse().map(f => {
    const me = f.a.id === id ? 'a' : 'b', opp = me === 'a' ? f.b : f.a;
    const w = f.result.winner;
    return { id: f.id, date: f.date, org: f.org, event: f.event, opponent: { id: opp.id, name: opp.name }, result: w ? (w === me ? 'G' : 'P') : f.result.draw ? 'E' : 'N', method: f.result.method, round: f.result.round, time: f.result.time };
  });
  const decided = rows.filter(r => r.result === 'G' || r.result === 'P');
  let streak = 0;
  for (const r of decided) { if (!streak || (r.result === 'G') === (streak > 0)) streak += r.result === 'G' ? 1 : -1; else break; }
  const methods = { ko: 0, sub: 0, dec: 0 };
  for (const r of rows) if (r.result === 'G' && methods[r.method] != null) methods[r.method]++;
  const last = mine[mine.length - 1];
  const me = last ? (last.a.id === id ? last.a : last.b) : { id, name: '' };
  return {
    id, name: me.name, record: me.record || '', rating: ratings.get(id) || null,
    stats: { fights: rows.length, wins: decided.filter(r => r.result === 'G').length, losses: decided.filter(r => r.result === 'P').length, streak,
      // El marcador de ESPN no trae el método: sólo se conoce en los de WOW. Sin datos, null (no un 0 que engañe)
      methods: methods.ko + methods.sub + methods.dec ? methods : null },
    history: rows.slice(0, 15)
  };
}

// Ranking por Elo de los luchadores activos (sin pelear hace más de `maxIdleDays`, fuera) y con al menos `minFights` combates
function rankingOf(fights, ratings, now = Date.now(), { minFights = 5, maxIdleDays = 540, limit = 300 } = {}) {
  const last = new Map();
  for (const f of fights) for (const x of [f.a, f.b]) last.set(x.id, { name: x.name, record: x.record || '', org: f.org });
  return [...ratings.entries()]
    .filter(([id, r]) => last.has(id) && r.fights >= minFights && r.lastDate && now - new Date(r.lastDate).getTime() <= maxIdleDays * 864e5)
    .sort((x, y) => y[1].elo - x[1].elo)
    .slice(0, limit)
    .map(([id, r], i) => ({ id, rank: i + 1, name: last.get(id).name, record: last.get(id).record, org: last.get(id).org, elo: r.elo, fights: r.fights, lastDate: r.lastDate }));
}

const ranking = async () => { const { fights, ratings } = await all(); return rankingOf(fights, ratings); };

module.exports = { all, fighterCtx, fighterCard, quarters, compact, rankingOf, ranking };
