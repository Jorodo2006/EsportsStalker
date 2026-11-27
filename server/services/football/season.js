'use strict';
// Estadísticas de la temporada de cada competición: por jugador (tiros, a puerta, goles, faltas, tarjetas) y por equipo (córneres a
// favor y en contra, tiros, tarjetas). ESPN no las da sumadas: se suman las de cada partido terminado (el resumen del partido).
// Un partido terminado no cambia, así que lo suyo se guarda para siempre en football.cache ("pst:<liga>:<partido>", unos KB) y
// sólo se le pide a ESPN una vez. Los córneres por jugador no existen en ESPN: sólo por equipo.
const { query } = require('../../shared/db');
const H = require('./history');

const site = espn => `https://site.api.espn.com/apis/site/v2/sports/soccer/${espn}`;
const num = v => (v == null || v === '' || Number.isNaN(Number(v)) ? 0 : Number(v));
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function fetchJSON(u) {
  const res = await fetch(u, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error(`ESPN respondió ${res.status}`);
  return res.json();
}

// Lo que se guarda de un partido: por equipo [id, nombre, escudo, córneres, tiros, a puerta, amarillas, rojas, faltas] y por
// jugador [id, nombre, equipo, titular, tiros, a puerta, goles, asistencias, faltas hechas, faltas recibidas, amarillas, rojas].
// Sólo los que jugaron (appearances). Pura (pruebas en server/test/temporada.test.js)
function compactMatch(j) {
  const t = (j.boxscore?.teams || []).map(x => {
    const s = Object.fromEntries((x.statistics || []).map(v => [v.name, num(v.displayValue)]));
    return [String(x.team?.id || ''), x.team?.displayName || '', x.team?.logo || '', s.wonCorners, s.totalShots, s.shotsOnTarget, s.yellowCards, s.redCards, s.foulsCommitted];
  }).filter(x => x[0]);
  const p = (j.rosters || []).flatMap(r => (r.roster || []).flatMap(x => {
    const s = Object.fromEntries((x.stats || []).map(v => [v.name, num(v.value)]));
    if (!s.appearances || !x.athlete?.id) return [];
    return [[String(x.athlete.id), x.athlete.displayName || '', String(r.team?.id || ''), x.starter ? 1 : 0, s.totalShots, s.shotsOnTarget, s.totalGoals,
      s.goalAssists, s.foulsCommitted, s.foulsSuffered, s.yellowCards, s.redCards]];
  }));
  return { t, p };
}

// Suma de los partidos de una temporada. Pura
function aggregate(list) {
  const teams = new Map(), players = new Map();
  for (const m of list) {
    if (m.t.length !== 2) continue;
    m.t.forEach((x, i) => {
      const o = m.t[1 - i];
      const r = teams.get(x[0]) || { id: x[0], name: x[1], logo: x[2], games: 0, cornersFor: 0, cornersAgainst: 0, shots: 0, shotsOnTarget: 0, shotsAgainst: 0, yellow: 0, yellowAgainst: 0, red: 0, fouls: 0 };
      r.name = x[1] || r.name; r.logo = x[2] || r.logo;
      r.games++; r.cornersFor += x[3]; r.cornersAgainst += o[3]; r.shots += x[4]; r.shotsOnTarget += x[5]; r.shotsAgainst += o[4];
      r.yellow += x[6]; r.yellowAgainst += o[6]; r.red += x[7]; r.fouls += x[8];
      teams.set(x[0], r);
    });
    for (const x of m.p) {
      const key = `${x[0]}|${x[2]}`; // un jugador traspasado cuenta aparte en cada equipo
      const r = players.get(key) || { id: x[0], name: x[1], team: x[2], games: 0, starts: 0, shots: 0, shotsOnTarget: 0, goals: 0, assists: 0, fouls: 0, fouled: 0, yellow: 0, red: 0 };
      r.games++; r.starts += x[3]; r.shots += x[4]; r.shotsOnTarget += x[5]; r.goals += x[6]; r.assists += x[7]; r.fouls += x[8]; r.fouled += x[9]; r.yellow += x[10]; r.red += x[11];
      players.set(key, r);
    }
  }
  return { teams: [...teams.values()], players: [...players.values()] };
}

// La temporada en curso de la competición (ESPN la da en el calendario de la liga). Fuera de temporada, si la nueva aún no ha
// empezado, la anterior. Medio día en memoria
const seasons = new Map();
async function seasonOf(espn) {
  const hit = seasons.get(espn);
  if (hit && Date.now() - hit.t < 12 * 3600e3) return hit.v;
  const s = (await fetchJSON(`${site(espn)}/scoreboard`)).leagues?.[0]?.season || {};
  const v = { year: s.year || null, name: s.displayName || '', from: s.startDate ? new Date(s.startDate).toISOString() : null };
  seasons.set(espn, { t: Date.now(), v });
  return v;
}

// Los partidos terminados de la temporada (del histórico de resultados, history.js, que ya los tiene mes a mes)
async function gamesOf(espn) {
  const season = await seasonOf(espn);
  const from = season.from ? new Date(season.from) : new Date(Date.now() - 300 * 864e5);
  const months = Math.min(14, (new Date().getUTCFullYear() - from.getUTCFullYear()) * 12 + new Date().getUTCMonth() - from.getUTCMonth() + 1);
  const cur = H.monthsBack(1)[0];
  const all = (await Promise.all(H.monthsBack(months).map(ym => H.month(espn, ym, ym >= cur).catch(() => [])))).flat();
  let games = all.filter(g => g.date >= from.toISOString());
  let label = season.name;
  // La nueva temporada aún sin partidos (el verano en Europa): la anterior entera
  if (!games.length && season.from) {
    const prev = new Date(from); prev.setUTCFullYear(prev.getUTCFullYear() - 1);
    const old = (await Promise.all(H.monthsBack(13, from).map(ym => H.month(espn, ym, false).catch(() => [])))).flat();
    games = old.filter(g => g.date >= prev.toISOString() && g.date < from.toISOString());
    label = 'Temporada anterior';
  }
  const seen = new Set();
  return { label, games: games.filter(g => !seen.has(g.id) && seen.add(g.id)) };
}

const key = (espn, id) => `pst:${espn}:${id}`;
async function cached(espn, ids) {
  if (!ids.length) return new Map();
  const { rows } = await query('SELECT key, value FROM football.cache WHERE key = ANY($1)', [ids.map(id => key(espn, id))]);
  return new Map(rows.map(r => [r.key.split(':').pop(), r.value]));
}
async function fetchMatch(espn, id) {
  const v = compactMatch(await fetchJSON(`${site(espn)}/summary?event=${id}`));
  await query(`INSERT INTO football.cache (key, value, t) VALUES ($1, $2::jsonb, now()) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, t = EXCLUDED.t`,
    [key(espn, id), JSON.stringify(v)]);
  return v;
}

// Lo de una competición con lo que ya está guardado. Si faltan partidos, se piden unos pocos ahora (la primera visita ya enseña
// algo) y el resto los trae fill() en segundo plano. Diez minutos en memoria
const ON_REQUEST = 12, BUDGET_MS = 3000;
const memo = new Map();
async function seasonStats(espn) {
  const hit = memo.get(espn);
  if (hit && Date.now() - hit.t < 10 * 60e3 && !hit.v.missing) return hit.v;
  const { label, games } = await gamesOf(espn);
  const have = await cached(espn, games.map(g => g.id));
  const missing = games.filter(g => !have.has(g.id)).sort((a, b) => b.date.localeCompare(a.date));
  // De 4 en 4 y sin empezar más pasados 3 s: la respuesta no puede tardar (el resto, fill)
  const t0 = Date.now(), queue = missing.slice(0, ON_REQUEST);
  await Promise.all([0, 1, 2, 3].map(async () => {
    for (let g; (g = queue.shift()) && Date.now() - t0 < BUDGET_MS;) {
      try { have.set(g.id, await fetchMatch(espn, g.id)); } catch (e) { console.warn('[football] temporada', espn, g.id, e.message); }
    }
  }));
  const { teams, players } = aggregate([...have.values()]);
  const v = { season: label, games: have.size, missing: games.length - have.size, teams, players };
  memo.set(espn, { t: Date.now(), v });
  return v;
}

// En segundo plano: los partidos que falten de todas las competiciones, de uno en uno y con pausa para no cargar a ESPN.
// La primera vez son unos cientos por liga; luego, los de cada jornada
let filling = false;
async function fill(leagues, { pause = 1500, max = 400 } = {}) {
  if (filling) return;
  filling = true;
  let n = 0;
  try {
    for (const lg of leagues) {
      const { games } = await gamesOf(lg.espn).catch(() => ({ games: [] }));
      const have = await cached(lg.espn, games.map(g => g.id));
      for (const g of games.filter(x => !have.has(x.id))) {
        if (n++ >= max) return;
        await fetchMatch(lg.espn, g.id).catch(e => console.warn('[football] temporada', lg.espn, g.id, e.message));
        memo.delete(lg.espn);
        await sleep(pause);
      }
    }
  } finally { filling = false; }
}

module.exports = { seasonStats, fill, compactMatch, aggregate };
