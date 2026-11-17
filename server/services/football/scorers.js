'use strict';
// Modelo del goleador ("Goleador" de Winamax: marca en algún momento del partido). Cada jugador tiene un ritmo de goles por 90 minutos
// sacado de los últimos partidos de su equipo (ESPN: goles de la ficha y minutos de las alineaciones y los cambios), tirado hacia el de su
// posición cuando tiene pocos minutos. Los goles que se esperan del equipo en este partido (el modelo de goles, model.js) se reparten
// entre sus jugadores según ritmo × minutos esperados, y P(marca) = 1 − exp(−goles esperados del jugador). Cifras de la comprobación en
// docs/specs/11-futbol.md; la lanza backtest-goleador.js.
const { cachedJSON } = require('../../shared/cached');

const getJSON = cachedJSON({ table: 'football.cache', saveEvery: 60e3 });
const summaryUrl = (espn, ev) => `https://site.api.espn.com/apis/site/v2/sports/soccer/${espn}/summary?event=${ev}`;
const norm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z ]+/g, ' ').replace(/\s+/g, ' ').trim();

// Goles por 90 minutos de un jugador de campo medio, según su posición, y cuántos "90" de peso tiene ese punto de partida
const POS_RATE = { F: 0.32, M: 0.1, D: 0.035, G: 0 };
const PRIOR_90S = 8; // elegido con backtest-goleador.js (LaLiga): el mejor log-loss de las dos mitades, entre 6 y 10
const NINETY = 90;
const WINDOW = 10; // partidos del equipo que se miran
const MIN_MATCHES = 4;
const OWN_GOAL_SHARE = 0.97; // los goles que marca un jugador de campo del propio equipo (el resto son en propia puerta de los rivales)

// Estadísticas por jugador que da la ficha (rosters[].stats) y los mercados de Winamax que salen de ellas
const COUNT_STATS = { shots: 'totalShots', sot: 'shotsOnTarget', saves: 'saves', fouls: 'foulsCommitted', suffered: 'foulsSuffered' };
const group = p => { const c = String(p || '').toUpperCase(); return c === 'G' || c === 'GK' ? 'G' : /^(CF|F|ST|LW|RW|SS|LF|RF)/.test(c) || c === 'FW' ? 'F' : /^(D|CB|LB|RB|SW|WB|LWB|RWB)/.test(c) ? 'D' : 'M'; };
const minuteOf = e => { const n = parseInt(e.clock?.displayValue, 10); return Number.isFinite(n) ? n : null; };

// De la ficha de un partido: por equipo, cada jugador con sus minutos y sus goles. Sin alineaciones (partido sin ficha), null
function playersOfSummary(j) {
  if (!j?.rosters?.length || !j.header?.competitions?.[0]) return null;
  const events = j.keyEvents || [];
  const kind = k => String(k.type?.type || '');
  const names = k => (k.participants || []).map(p => p.athlete?.displayName).filter(Boolean);
  const out = {};
  for (const r of j.rosters) {
    const team = String(r.team?.id || '');
    const subs = events.filter(k => kind(k) === 'substitution' && String(k.team?.id || '') === team);
    const goals = events.filter(k => String(k.team?.id || '') === team && (/^goal/.test(kind(k)) || (/penalty/.test(kind(k)) && !/miss|saved/.test(kind(k)))) && !/own-goal/.test(kind(k)) && !/own goal/i.test(k.type?.text || ''));
    out[team] = (r.roster || []).flatMap(p => {
      const name = p.athlete?.displayName || '';
      if (!name || (!p.starter && !p.subbedIn)) return [];
      const inAt = !p.starter ? minuteOf(subs.find(k => names(k)[0] === name) || {}) : 0;
      const outAt = p.subbedOut ? minuteOf(subs.find(k => names(k)[1] === name) || {}) : null;
      const from = p.starter ? 0 : (inAt ?? 60), to = outAt ?? NINETY;
      const st = Object.fromEntries((p.stats || []).map(x => [x.name, Number(x.value) || 0]));
      const stats = Object.fromEntries(Object.entries(COUNT_STATS).map(([k, espn]) => [k, st[espn] || 0]));
      return [{ name, key: norm(name), pos: group(p.position?.abbreviation), min: Math.max(1, Math.min(NINETY, to) - from), goals: goals.filter(k => names(k)[0] === name).length, stats }];
    });
  }
  return out;
}

async function matchPlayers(row, ttl = 365 * 864e5) {
  try { return playersOfSummary(await getJSON(summaryUrl(row.lg, row.id), ttl)); } catch { return null; }
}

// De los últimos partidos de un equipo ({ id, lg, date }, el más reciente primero): por jugador, sus minutos y goles en esos partidos,
// y en cuántos partidos del equipo hay datos
async function teamRecent(teamId, rows, fetchRow = matchPlayers) {
  const sample = rows.slice(0, WINDOW);
  const agg = new Map();
  let n = 0;
  // De cinco en cinco: ESPN no tiene por qué aguantar diez peticiones a la vez por equipo
  const fichas = [];
  for (let i = 0; i < sample.length; i += 5) fichas.push(...await Promise.all(sample.slice(i, i + 5).map(fetchRow)));
  for (const ficha of fichas) {
    const p = ficha?.[teamId];
    if (!p) continue;
    n++;
    for (const x of p) {
      const a = agg.get(x.key) || { name: x.name, key: x.key, pos: x.pos, min: 0, goals: 0, apps: 0, stats: {} };
      a.min += x.min; a.goals += x.goals; a.apps++; a.pos = x.pos;
      for (const k of Object.keys(COUNT_STATS)) a.stats[k] = (a.stats[k] || 0) + (x.stats?.[k] || 0);
      agg.set(x.key, a);
    }
  }
  return { n, players: [...agg.values()] };
}

// Goles esperados de cada jugador de un equipo en este partido: lambda es lo que se espera del equipo (model.js). Sin base (menos de
// MIN_MATCHES partidos con datos), nada
function scorerProbs(recent, lambda, prior90s = PRIOR_90S) {
  if (!recent || recent.n < MIN_MATCHES || !(lambda > 0)) return null;
  const raw = recent.players.map(pl => {
    const rate = (pl.goals + POS_RATE[pl.pos] * prior90s) / (pl.min / NINETY + prior90s); // goles por 90
    return { ...pl, rate, exp: rate * (pl.min / recent.n) / NINETY }; // × minutos esperados (con la probabilidad de no jugar)
  });
  const total = raw.reduce((t, x) => t + x.exp, 0);
  if (!(total > 0)) return null;
  const k = lambda * OWN_GOAL_SHARE / total;
  return new Map(raw.map(x => [x.key, { name: x.name, pos: x.pos, lambda: x.exp * k, raw: x.exp, n: recent.n, p: 1 - Math.exp(-x.exp * k), rate90: x.rate, minutes: x.min / recent.n }]));
}

// Remates, remates a puerta, paradas y faltas: cuántas veces hace algo un jugador, como Poisson con su ritmo por 90 (tirado hacia el de su
// posición, prior: { pos: ritmo }) y sus minutos por partido que juega; la probabilidad de hacerlo N veces o más es la de jugar × la cola de
// la Poisson. scale: lo que cambia el partido sobre lo habitual del equipo (goles esperados / goles de media)
// Ritmos por 90 de cada posición (medidos con LaLiga 2025-26, backtest-jugador.js) y el peso de ese punto de partida frente a lo que
// ha hecho el jugador: con remates y faltas recibidas manda el jugador (3), con faltas cometidas algo menos (8) y con las paradas casi
// sólo el prior (30: el ritmo individual no mejoró nada al prior en la comprobación)
const COUNT_PRIOR = {
  shots: { G: 0.002, M: 1.2, D: 0.554, F: 2.467 }, sot: { G: 0, M: 0.397, D: 0.141, F: 1.021 }, saves: { G: 3.014, M: 0, D: 0, F: 0 },
  fouls: { G: 0.014, M: 1.275, D: 1.183, F: 1.205 }, suffered: { G: 0.121, M: 1.174, D: 0.937, F: 1.453 }
};
const COUNT_K = { shots: 3, sot: 3, saves: 30, fouls: 8, suffered: 3 };
const poissonAtLeast = (mu, n) => { let cdf = 0, t = Math.exp(-mu); for (let k = 0; k < n; k++) { cdf += t; t *= mu / (k + 1); } return Math.max(0, 1 - cdf); };
function countModel(recent, stat, prior, { scale = 1, prior90s = PRIOR_90S } = {}) {
  if (!recent || recent.n < MIN_MATCHES) return null;
  const out = new Map();
  for (const pl of recent.players) {
    if (!pl.apps) continue;
    const rate = ((pl.stats?.[stat] || 0) + (prior[pl.pos] || 0) * prior90s) / (pl.min / NINETY + prior90s);
    const mu = rate * (pl.min / pl.apps) / NINETY * scale, q = pl.apps / recent.n;
    out.set(pl.key, { name: pl.name, pos: pl.pos, q, mu, rate90: rate, atLeast: n => q * poissonAtLeast(mu, n), n: recent.n });
  }
  return out;
}

// Lo de un equipo para un partido, con un cuarto de hora de memoria (los partidos pasados no cambian)
const recentMem = new Map();
async function teamRecentCached(teamId, rows) {
  const hit = recentMem.get(teamId);
  if (hit && Date.now() - hit.t < 15 * 60e3 && hit.last === rows[0]?.id) return hit.v;
  const v = await teamRecent(teamId, rows);
  recentMem.set(teamId, { t: Date.now(), last: rows[0]?.id, v });
  return v;
}

module.exports = { COUNT_PRIOR, COUNT_K, countModel, poissonAtLeast, COUNT_STATS, teamRecentCached, playersOfSummary, matchPlayers, teamRecent, scorerProbs, norm, WINDOW, MIN_MATCHES, POS_RATE, PRIOR_90S };
