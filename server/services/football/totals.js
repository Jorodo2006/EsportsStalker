'use strict';
// Córneres y tarjetas del partido («Número total córneres», «Número total de tarjetas» de Winamax; claves corners|0||<línea> y
// cards|0||<línea>). Con las estadísticas de la temporada (season.js): lo que cada equipo suele sacar (córneres a favor, tarjetas
// suyas) y lo que suele provocar al rival (córneres en contra, tarjetas del rival), tirado hacia la media de la liga con un peso de
// K partidos. Lo esperado de cada equipo = lo suyo × lo que concede el rival / la media. El total es una binomial negativa con
// dispersión R (los córneres y las tarjetas varían más que una Poisson). K y R, con backtest-totales.js (cifras en
// docs/specs/11-futbol.md). Las tarjetas cuentan amarillas + rojas, como settle.js. Todo puro.

// Lo que se mira de cada partido (compactMatch de season.js: [id, nombre, escudo, córneres, remates, a puerta, amarillas, rojas, faltas])
const STATS = {
  corners: x => x[3],
  cards: x => x[6] + x[7]
};
// Córneres: ajustado con la temporada 2025-26 entera de las ligas de hombres y la A-League (2.507 partidos) y probado con la 2026-27
// (632): log-loss 0,6437 frente a 0,6486 con la media de la liga, y calibrado (más de 9,5: decía 47,5 %, fue 49,2 %). Tarjetas: saber
// los equipos casi no mejora la media (0,5476 frente a 0,5488) y se queda corto en todas las líneas (las decide el árbitro): no se
// recomiendan; sus parámetros son los del mejor ajuste, sólo para backtest-totales.js
const PARAMS = {
  corners: { k: 20, r: 25 },
  cards: { k: 20, r: Infinity }
};
const MIN_GAMES = 3;

// Sumas de cada equipo y de la liga con los partidos dados (los anteriores al que se quiere calcular)
function ratesOf(matches, stat) {
  const of = STATS[stat];
  const teams = new Map();
  let sum = 0, n = 0;
  for (const m of matches) {
    if (m.t?.length !== 2) continue;
    m.t.forEach((x, i) => {
      const o = m.t[1 - i];
      const r = teams.get(x[0]) || { for: 0, against: 0, n: 0 };
      r.for += of(x); r.against += of(o); r.n++;
      teams.set(x[0], r);
      sum += of(x); n++;
    });
  }
  return { teams, avg: n ? sum / n : 0, n };
}

// Lo esperado en el partido: { mu (total), a, b (cada equipo), games (los partidos del que menos tiene) } o null si falta algo
function expected(rates, homeId, awayId, { k } = {}) {
  const A = rates.teams.get(String(homeId)), B = rates.teams.get(String(awayId)), avg = rates.avg;
  if (!A || !B || !(avg > 0)) return null;
  const shrink = (v, n) => (v + k * avg) / (n + k);
  const a = shrink(A.for, A.n) * shrink(B.against, B.n) / avg;
  const b = shrink(B.for, B.n) * shrink(A.against, A.n) / avg;
  return { mu: a + b, a, b, games: Math.min(A.n, B.n) };
}

// P(X = 0..max) de una binomial negativa con media mu y dispersión r (varianza mu + mu²/r); r = Infinity es una Poisson
function pmf(mu, r, max = 40) {
  const out = [];
  if (!Number.isFinite(r)) {
    let p = Math.exp(-mu);
    for (let x = 0; x <= max; x++) { out.push(p); p *= mu / (x + 1); }
    return out;
  }
  const q = r / (r + mu);
  let p = Math.pow(q, r);
  for (let x = 0; x <= max; x++) { out.push(p); p *= ((x + r) / (x + 1)) * (1 - q); }
  return out;
}
// P(total > line) y P(total < line) con línea x,5
function overUnder(mu, r, line) {
  const P = pmf(mu, r);
  const over = P.reduce((s, p, x) => s + (x > line ? p : 0), 0);
  return { over, under: 1 - over };
}

module.exports = { STATS, PARAMS, MIN_GAMES, ratesOf, expected, pmf, overUnder };
