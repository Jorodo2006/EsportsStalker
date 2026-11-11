'use strict';
// Recomendaciones de un partido de fútbol: cruza el modelo de goles (model.js) con las cuotas de las casas, como las de
// tenis (server/services/tennis/picks.js). Para cada mercado que sale de un marcador (1X2, doble oportunidad, empate no
// válido, ambos marcan, goles, goles de un equipo y hándicap asiático, del partido y de la 1.ª parte) estima la
// probabilidad, la mezcla con la de las casas sin su margen y separa la más fiable, las fáciles y las difíciles.
// Es una estimación: no hay cuotas históricas gratuitas con las que comprobar si a la larga se gana dinero.
const client = require('../../shared/client');
const H = require('./history');
const M = require('./model');

const { clamp } = M;
const logit = p => Math.log(p / (1 - p));
const sigmoid = x => 1 / (1 + Math.exp(-x));
const W_MODEL = 0.25; // las casas aciertan más que el modelo (en la comprobación, 1,007 de log-loss frente a ~0,97 de las casas)
const W_THIN = 0.1; // con pocos partidos de alguno de los dos, todavía menos
const THIN_GAMES = 8; // partidos ponderados (los recientes pesan más)
const ASSUMED_MARGIN = 0.07;
const STALE_MS = 6 * 3600e3;
const MAX_DISAGREE = 0.15; // tanta diferencia con la casa suele ser que falta algo (rotaciones, bajas)
const MIN_PRICE = 1.15;
const MAX_PRICE_HARD = 12;
const REFIT_MS = 3 * 3600e3;

// ---------- Estado del modelo por grupo (hombres, mujeres, selecciones): se reajusta cada pocas horas ----------
const states = new Map();
function stateOf(pool) {
  const cur = states.get(pool);
  if (cur && Date.now() - cur.t < REFIT_MS) return cur.p;
  const p = H.results(pool).then(rows => M.fit(rows, M.PARAMS[pool]));
  states.set(pool, { t: Date.now(), p });
  // Si falla, que lo intente la próxima vez y no se quede con el error tres horas
  p.catch(() => states.delete(pool));
  return p;
}

// ---------- Qué dice cada selección ----------
const dec = v => String(v).replace('.', ',');
const signed = v => (v > 0 ? `+${dec(v)}` : `−${dec(Math.abs(v))}`);
const HALF_PRE = { 0: '', 1: '1.ª parte: ' };
const HALF_FAM = { 0: '', 1: '1.ª parte · ' };

// { family, side, title, test(i, j) | p(P) } o null si el modelo no sabe calcularlo. i: goles del local (a), j: del visitante (b)
function rule(line, o, m) {
  const [type, per, who] = line.key.split('|');
  const period = Number(per);
  if (period !== 0 && period !== 1) return null;
  const L = line.line;
  const half = L != null && Math.abs(L * 2 % 2) === 1; // sólo x,5: las enteras y las de cuarto pueden devolverse
  const pre = HALF_PRE[period], fam = HALF_FAM[period];
  const name = s => (s === 'a' ? m.home.name : m.away.name);
  if (type === 'moneyline') {
    const t = { a: (i, j) => i > j, x: (i, j) => i === j, b: (i, j) => i < j }[o.id];
    return t && { period, family: `${fam}Resultado`, side: o.id === 'x' ? null : o.id, title: o.id === 'x' ? `${pre}Empate` : `${pre}Gana ${name(o.id)}`, test: t };
  }
  if (type === 'double') {
    const t = { '1x': (i, j) => i >= j, 12: (i, j) => i !== j, x2: (i, j) => i <= j }[o.id];
    const title = { '1x': `${m.home.name} o empate`, 12: `${m.home.name} o ${m.away.name}`, x2: `Empate o ${m.away.name}` }[o.id];
    return t && { period, family: `${fam}Doble oportunidad`, side: o.id === '1x' ? 'a' : o.id === 'x2' ? 'b' : null, title: `${pre}${title}`, test: t };
  }
  // Empate no válido: si empatan se devuelve, así que la probabilidad es la de ganar entre los partidos que no acaban en empate
  if (type === 'dnb' && (o.id === 'a' || o.id === 'b')) {
    const win = o.id === 'a' ? (i, j) => i > j : (i, j) => i < j;
    return { period, family: `${fam}Empate no válido`, side: o.id, title: `${pre}${name(o.id)} (empate no válido)`, p: P => M.prob(P, win) / Math.max(1e-6, 1 - M.prob(P, (i, j) => i === j)) };
  }
  if (type === 'btts' && (o.id === 'yes' || o.id === 'no')) {
    const yes = o.id === 'yes';
    return { period, family: `${fam}Ambos marcan`, side: null, title: `${pre}${yes ? 'Marcan los dos' : 'No marcan los dos'}`, test: (i, j) => (i > 0 && j > 0) === yes };
  }
  if (type === 'total' && half) {
    const over = o.id === 'over';
    return { period, family: `${fam}Total de goles`, side: null, title: `${pre}${over ? 'Más' : 'Menos'} de ${dec(L)} goles`, test: (i, j) => (over ? i + j > L : i + j < L) };
  }
  if (type === 'team_total' && half && (who === 'a' || who === 'b')) {
    const over = o.id === 'over', g = (i, j) => (who === 'a' ? i : j);
    return { period, family: `${fam}Goles de ${name(who)}`, side: over ? who : null, title: `${pre}${name(who)}: ${over ? 'más' : 'menos'} de ${dec(L)} goles`, test: (i, j) => (over ? g(i, j) > L : g(i, j) < L) };
  }
  // Hándicap asiático: la línea es la del local
  if (type === 'spread' && half && (o.id === 'a' || o.id === 'b')) {
    const h = o.id === 'a' ? L : -L;
    return { period, family: `${fam}Hándicap asiático`, side: o.id, title: `${pre}${name(o.id)} ${signed(h)}`, test: o.id === 'a' ? (i, j) => i - j + L > 0 : (i, j) => j - i - L > 0 };
  }
  return null;
}

// Probabilidad de la casa sin margen: la media de cada casa que da la línea completa
function marketProb(line, outcome) {
  const books = Object.keys(outcome.prices).filter(bk => outcome.prices[bk] > 1);
  if (!books.length) return null;
  const fair = books.map(bk => {
    const prices = line.outcomes.map(o => o.prices[bk]);
    const inv = 1 / outcome.prices[bk];
    return prices.every(v => v > 1) ? inv / prices.reduce((t, p) => t + 1 / p, 0) : inv / (1 + ASSUMED_MARGIN);
  });
  return fair.reduce((t, x) => t + x, 0) / fair.length;
}

const blend = (model, market, w) => sigmoid(w * logit(clamp(model, 0.002, 0.998)) + (1 - w) * logit(clamp(market, 0.002, 0.998)));

// Lo bien que salió cada mercado en la comprobación con partidos pasados (el 1X2 calibrado; los goles, algo peor)
const trustOf = f => (/^1\.ª parte/.test(f) ? 0.5 : /Resultado|Doble oportunidad|Empate no válido|Hándicap/.test(f) ? 1 : /Total de goles/.test(f) ? 0.7 : 0.6);

function reliabilityOf({ family, pModel, pMarket, gap, minGames, books, age }) {
  const factors = [
    { label: 'Datos de los equipos', max: 30, score: 30 * clamp(minGames / 20, 0, 1), note: `${Math.round(minGames)} partidos recientes (ponderados) el que menos` },
    // gap: la discrepancia en el 1X2, que el modelo calcula sin mirar a la casa. Si ahí no coinciden, nada de lo demás es fiable
    { label: 'Modelo y casa de acuerdo', max: 35, score: 35 * clamp(1 - (Math.max(gap, Math.abs(pModel - pMarket)) - 0.03) / 0.12, 0, 1), note: `modelo ${Math.round(pModel * 100)} %, casa ${Math.round(pMarket * 100)} %` },
    { label: 'Mercado', max: 20, score: 20 * trustOf(family), note: 'qué tal se calcula este mercado' },
    { label: 'Cuotas', max: 15, score: 15 * (books > 1 ? 1 : 0.6) * (age > STALE_MS ? 0.4 : 1), note: `${books} ${books > 1 ? 'casas' : 'casa'}` }
  ];
  const score = Math.round(clamp(factors.reduce((t, f) => t + f.score, 0), 0, 100));
  return { score, label: score >= 70 ? 'Alta' : score >= 50 ? 'Media' : 'Baja', factors, warnings: [] };
}

function reason(p, c) {
  const es = v => v.toFixed(1).replace('.', ',');
  const k = /^1\.ª parte/.test(p.family) ? M.HALF : 1;
  const [eh, ea] = [c.lh * k, c.la * k];
  if (/Total de goles|Ambos marcan/.test(p.family)) return `Se esperan ${es(eh)} goles de ${c.m.home.name} y ${es(ea)} de ${c.m.away.name}`;
  if (/Goles de/.test(p.family)) return `Se esperan ${es(p.who === 'a' ? eh : ea)} goles de ${p.who === 'a' ? c.m.home.name : c.m.away.name}`;
  const x = c.x;
  return `Modelo: ${c.m.home.name} ${Math.round(x.h * 100)} %, empate ${Math.round(x.d * 100)} %, ${c.m.away.name} ${Math.round(x.a * 100)} %`;
}

function pickDistinct(list, n, used = new Set()) {
  const out = [];
  for (const x of list) {
    if (out.length >= n) break;
    if (used.has(x.family)) continue;
    used.add(x.family); out.push(x);
  }
  return out;
}

// match: el de la lista de partidos (index.js, matchOf); espn: el id de su liga en ESPN
async function picksFor(match, espn, opts = {}) {
  const m = match;
  if (m.off) return { ready: false, reason: 'finished' };
  if (m.state !== 'pre') return { ready: false, reason: m.state === 'in' ? 'started' : 'finished' };
  const pool = H.poolOf(espn);
  if (!pool) return { ready: false, reason: 'nomodel' };
  const ref = t => ({ name: t.name, code: '', alt: [...new Set([...(/\sII$/.test(t.name) ? [t.name.replace(/\sII$/, ' B')] : []), ...(t.alts || []).filter(x => x && x !== t.name && x !== t.abbr)])] });
  const odds = await client.call('odds', 'POST', '/api/odds/match', { match: { a: ref(m.home), b: ref(m.away), start: m.date, sport: 'football', league: m.league }, quiet: true });
  if (!odds?.markets?.length) return { ready: false, reason: 'noodds' };

  const st = await stateOf(pool);
  const e = M.expected(st, m.home.id, m.away.id, espn, !!m.neutral);
  const P = M.grid(e.lh, e.la, st.rho), P1 = M.grid(e.lh * M.HALF, e.la * M.HALF, st.rho);
  const x = M.oneXtwo(P);
  const minGames = Math.min(e.games.h, e.games.a);

  const ml = odds.markets.find(l => l.key === 'moneyline|0||');
  const oa = ml?.outcomes.find(o => o.id === 'a');
  const pMarketHome = oa ? marketProb(ml, oa) : null;
  // Cuanto más se aleja el modelo de la casa, más probable es que le falte algo: pesa menos
  const gap = pMarketHome == null ? 0.1 : Math.abs(x.h - pMarketHome);
  const w = (minGames < THIN_GAMES ? W_THIN : W_MODEL) * clamp(1 - (gap - 0.04) / 0.16, 0.2, 1);
  const age = Math.max(0, Date.now() - Math.max(0, ...Object.values(odds.sources || {}).map(s => s.ts || 0)));

  const picks = [];
  for (const line of odds.markets) {
    for (const o of line.outcomes) {
      const books = Object.entries(o.prices).filter(([, v]) => v > 1);
      if (!books.length) continue;
      const r = rule(line, o, m);
      if (!r) continue;
      const G = r.period === 1 ? P1 : P;
      const pModel = r.p ? r.p(G) : M.prob(G, r.test);
      const pMarket = marketProb(line, o);
      if (pModel <= 0.001 || pMarket == null) continue;
      const p = blend(pModel, pMarket, w);
      const [book, price] = books.sort((a, b) => b[1] - a[1])[0];
      const who = line.key.split('|')[2];
      picks.push({
        id: `${line.key}#${o.id}`, title: r.title, market: line.group, selection: o.label, family: r.family, side: r.side, who: who === 'a' || who === 'b' ? who : r.side,
        book, price, prices: o.prices, p, pModel, pMarket, fair: 1 / p, ev: p * price - 1,
        rel: reliabilityOf({ family: r.family, pModel, pMarket, gap, minGames, books: books.length, age })
      });
    }
  }

  const pFav = Math.max(x.h, x.a), fav = x.h >= x.a ? 'a' : 'b';
  const sane = q => Math.abs(q.pModel - q.pMarket) <= MAX_DISAGREE;
  const decent = q => sane(q) && q.ev >= -0.1 && q.rel.score >= 40;
  // La primera parte cuenta menos: más azar y más margen de la casa
  const score = q => q.p + q.ev + 0.05 * (q.rel.score / 100) - (/^1\.ª parte/.test(q.family) ? 0.04 : 0);
  const easyPool = picks.filter(q => q.p >= 0.6 && q.price >= MIN_PRICE && decent(q)).sort((a, b) => score(b) - score(a));
  const top = easyPool.find(q => q.rel.score >= 50 && q.ev >= -0.07) ?? null;
  const used = new Set(top ? [top.family] : []);
  const easy = pickDistinct(easyPool.filter(q => q !== top).sort((a, b) => b.ev - a.ev), 3, used);
  const hardPool = picks.filter(q => sane(q) && q.p >= 0.15 && q.p <= 0.45 && q.price >= 2.2 && q.price <= MAX_PRICE_HARD && q.ev >= -0.12 && q.rel.score >= 35 && (!q.side || q.side === fav || q.ev >= 0.03))
    .sort((a, b) => b.ev - a.ev);
  const hard = pickDistinct(hardPool, 3);

  const warnings = [];
  if (e.games.h < THIN_GAMES) warnings.push(`Pocos partidos recientes de ${m.home.name}: pesa casi todo la casa`);
  if (e.games.a < THIN_GAMES) warnings.push(`Pocos partidos recientes de ${m.away.name}: pesa casi todo la casa`);
  if (pool === 'national') warnings.push('Selecciones: juegan poco y rotan mucho; el modelo se fía menos');
  if (age > STALE_MS) warnings.push(`Cuotas de hace ${Math.round(age / 3600e3)} h: actualízalas antes de apostar`);
  const ctx = { m, lh: e.lh, la: e.la, x };
  const withWhy = q => q && ({ ...q, why: reason(q, ctx) });
  return {
    ready: true, oddsAge: age,
    match: { home: x.h, draw: x.d, away: x.a, pMarketHome, goalsHome: e.lh, goalsAway: e.la, weight: w, fav, pFav },
    top: withWhy(top), easy: easy.map(withWhy), hard: hard.map(withWhy), considered: picks.length, warnings,
    ...(opts.all ? { all: picks.map(withWhy) } : {})
  };
}

module.exports = { picksFor, stateOf };
