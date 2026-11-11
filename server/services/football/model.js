'use strict';
// Modelo de goles: cada equipo tiene un ataque y una defensa, y los goles de cada uno en un partido son de Poisson con
//   goles del local     = exp(liga + casa + ataque local + defensa visitante)
//   goles del visitante = exp(liga + ataque visitante + defensa local)
// (defensa alta = encaja mucho). Se ajusta por máxima verosimilitud con los partidos pasados, pesando más los recientes
// (vida media `halfLife` días) y tirando de cada equipo hacia su punto de partida (`reg`) para que con pocos partidos no
// salgan cifras locas. Encima, la corrección de Dixon y Coles (`rho`): los 0-0, 1-0, 0-1 y 1-1 no son del todo
// independientes. Los parámetros se eligieron con backtest.js (cifras en docs/specs/11-futbol.md).
const { CUPS, FRIENDLY } = require('./history');

const PARAMS = {
  men: { halfLife: 300, reg: 8, rho: -0.06 },
  women: { halfLife: 300, reg: 8, rho: -0.06 },
  national: { halfLife: 365, reg: 8, rho: -0.06 }
};
const COMMON = { cupWeight: 0.7, friendlyWeight: 0.5, priorCup: { att: -0.45, def: 0.35 } };
// Parte de los goles que llegan en la primera mitad (en las grandes ligas, entre el 44 y el 46 %)
const HALF = 0.45;
const MAX_GOALS = 10;

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

// rows: [{ date, lg, h, a, hg, ag, n }] (history.js). asOf: sólo cuenta lo de antes (para la comprobación)
function fit(rows, opts = {}) {
  const o = { ...COMMON, ...opts };
  const asOf = o.asOf ?? Date.now();
  const k = Math.LN2 / o.halfLife;
  const idx = new Map(), lidx = new Map();
  const id = (map, v) => { if (!map.has(v)) map.set(v, map.size); return map.get(v); };
  const ms = [];
  const where = new Map(); // en qué competiciones juega cada equipo
  for (const r of rows) {
    const t = +new Date(r.date);
    if (!(t < asOf)) continue;
    let w = Math.exp(-k * (asOf - t) / 864e5);
    if (CUPS.has(r.lg)) w *= o.cupWeight;
    if (FRIENDLY.has(r.lg)) w *= o.friendlyWeight;
    if (w < 1e-3) continue;
    for (const team of [r.h, r.a]) { if (!where.has(team)) where.set(team, new Set()); where.get(team).add(r.lg); }
    ms.push({ h: id(idx, r.h), a: id(idx, r.a), l: id(lidx, r.lg), hg: r.hg, ag: r.ag, n: r.n ? 1 : 0, w });
  }
  const T = idx.size, L = lidx.size;
  // Punto de partida: la media, salvo los que sólo salen en la copa (equipos de categorías que no se siguen), que son peores
  const pAtt = new Float64Array(T), pDef = new Float64Array(T);
  for (const [team, i] of idx) {
    if ([...where.get(team)].every(lg => CUPS.has(lg))) { pAtt[i] = o.priorCup.att; pDef[i] = o.priorCup.def; }
  }
  const att = Float64Array.from(pAtt), def = Float64Array.from(pDef), mu = new Float64Array(L).fill(0.3);
  let home = 0.25;
  const games = new Float64Array(T);
  for (const m of ms) { games[m.h] += m.w; games[m.a] += m.w; }

  const g = new Float64Array(Math.max(T, L)), H = new Float64Array(Math.max(T, L));
  const lam = m => [Math.exp(mu[m.l] + home * (1 - m.n) + att[m.h] + def[m.a]), Math.exp(mu[m.l] + att[m.a] + def[m.h])];
  // Por bloques: dentro de cada uno (ataques, defensas, ligas) cada parámetro es independiente de los demás, así que el
  // paso de Newton de cada uno es exacto
  const step = (n, accumulate, apply) => {
    g.fill(0, 0, n); H.fill(0, 0, n);
    for (const m of ms) accumulate(m, ...lam(m));
    let move = 0;
    for (let i = 0; i < n; i++) move = Math.max(move, Math.abs(apply(i)));
    return move;
  };
  for (let it = 0; it < 80; it++) {
    let move = 0;
    move = Math.max(move, step(T, (m, lh, la) => { g[m.h] += m.w * (m.hg - lh); H[m.h] += m.w * lh; g[m.a] += m.w * (m.ag - la); H[m.a] += m.w * la; },
      i => { const d = clamp((g[i] - o.reg * (att[i] - pAtt[i])) / (H[i] + o.reg), -1, 1); att[i] += d; return d; }));
    move = Math.max(move, step(T, (m, lh, la) => { g[m.a] += m.w * (m.hg - lh); H[m.a] += m.w * lh; g[m.h] += m.w * (m.ag - la); H[m.h] += m.w * la; },
      i => { const d = clamp((g[i] - o.reg * (def[i] - pDef[i])) / (H[i] + o.reg), -1, 1); def[i] += d; return d; }));
    move = Math.max(move, step(L, (m, lh, la) => { g[m.l] += m.w * (m.hg - lh + m.ag - la); H[m.l] += m.w * (lh + la); },
      i => { const d = H[i] ? clamp(g[i] / H[i], -1, 1) : 0; mu[i] += d; return d; }));
    let gh = 0, hh = 0;
    for (const m of ms) { if (m.n) continue; const [lh] = lam(m); gh += m.w * (m.hg - lh); hh += m.w * lh; }
    const dh = hh ? clamp(gh / hh, -0.5, 0.5) : 0;
    home += dh;
    if (Math.max(move, Math.abs(dh)) < 1e-5) break;
  }
  const team = new Map([...idx].map(([t, i]) => [t, { att: att[i], def: def[i], games: games[i] }]));
  const league = new Map([...lidx].map(([l, i]) => [l, mu[i]]));
  const muAll = L ? mu.reduce((s, v) => s + v, 0) / L : 0.3;
  return { team, league, muAll, home, rho: o.rho ?? -0.06, asOf, matches: ms.length };
}

// Goles esperados de un partido. Un equipo sin partidos parte de la media (o de lo de la copa, si se pide)
function expected(st, hId, aId, lg, neutral = false) {
  const z = { att: 0, def: 0, games: 0 };
  const h = st.team.get(String(hId)) || z, a = st.team.get(String(aId)) || z;
  const mu = st.league.get(lg) ?? st.muAll;
  return {
    lh: Math.exp(mu + (neutral ? 0 : st.home) + h.att + a.def), la: Math.exp(mu + a.att + h.def),
    games: { h: h.games, a: a.games }, rating: { h, a }
  };
}

function poisson(lambda, max) {
  const p = [Math.exp(-lambda)];
  for (let k = 1; k <= max; k++) p.push(p[k - 1] * lambda / k);
  return p;
}

// Probabilidad de cada marcador: P[i][j] = local i, visitante j
function grid(lh, la, rho, max = MAX_GOALS) {
  const ph = poisson(lh, max), pa = poisson(la, max);
  const tau = (i, j) => (i === 0 && j === 0 ? 1 - lh * la * rho : i === 0 && j === 1 ? 1 + lh * rho : i === 1 && j === 0 ? 1 + la * rho : i === 1 && j === 1 ? 1 - rho : 1);
  const P = [];
  let s = 0;
  for (let i = 0; i <= max; i++) {
    P.push([]);
    for (let j = 0; j <= max; j++) { const v = Math.max(0, ph[i] * pa[j] * tau(i, j)); P[i].push(v); s += v; }
  }
  for (const row of P) for (let j = 0; j < row.length; j++) row[j] /= s;
  return P;
}

// Suma de las casillas que cumplen test(i, j)
const prob = (P, test) => { let s = 0; for (let i = 0; i < P.length; i++) for (let j = 0; j < P[i].length; j++) if (test(i, j)) s += P[i][j]; return s; };
const oneXtwo = P => ({ h: prob(P, (i, j) => i > j), d: prob(P, (i, j) => i === j), a: prob(P, (i, j) => i < j) });

module.exports = { PARAMS, COMMON, HALF, fit, expected, grid, prob, oneXtwo, clamp };
