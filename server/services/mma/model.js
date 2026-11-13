'use strict';
// Modelo de MMA: Elo propio calculado con los combates pasados (ESPN y WOW), más pequeños ajustes (récord cuando hay poco
// historial, edad, inactividad). Da la probabilidad de victoria, la del método (KO/TKO, sumisión, decisión) y la de duración.
// Los parámetros están medidos con backtest.js (ajuste con un periodo y comprobación con otro); si se toca algo, repetirlo.

const PARAMS = {
  SCALE: 300, // Elo: diferencia que da 10 a 1 (elegido en el ajuste de backtest.js: 400 daba favoritos algo tímidos)
  K0: 32, K1: 56, // K = K0 + K1/(1+combates): el que debuta se mueve mucho, el veterano poco
  PRIOR_POW: 1.5, // el récord pesa 1/(1+combates)^PRIOR_POW
  RECORD_SPAN: 800, // el récord (ganados suavizados) vale hasta ±RECORD_SPAN/2 puntos de Elo
  AGE_FROM: 35, AGE_PER_YEAR: 4, // desde los 35, 4 puntos por año
  IDLE_FROM: 540, IDLE_DAYS_PER_POINT: 12, IDLE_MAX: 80, // más de 18 meses sin pelear
  // A priori (no medidos con método: ESPN no lo da en el marcador): cuántos combates acaban por cada vía
  BASE: {
    ufc: { ko: 0.37, sub: 0.14, dec: 0.49 },
    pfl: { ko: 0.34, sub: 0.17, dec: 0.49 },
    wow: { ko: 0.4, sub: 0.2, dec: 0.4 }
  },
  LOPSIDED_DEC: 0.5, // un favorito muy claro baja la decisión hasta esa fracción
  FIVE_ROUND_DEC: 0.8, // a cinco asaltos se llega menos a la decisión
  FINISH_ROUND: [0.38, 0.27, 0.19, 0.1, 0.06] // cuándo acaban los que no llegan a decisión (más pronto que tarde)
};

const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const expected = (ea, eb, S = PARAMS.SCALE) => 1 / (1 + Math.pow(10, (eb - ea) / S));

// Récord "12-3-0" → Elo a priori: 1500 ± según el porcentaje de victorias suavizado. Sin récord, neutral
function recordElo(record, P = PARAMS) {
  const m = /^(\d+)-(\d+)(?:-(\d+))?/.exec(String(record || '').trim());
  if (!m) return 1500;
  const w = +m[1], l = +m[2];
  return 1500 + P.RECORD_SPAN * ((w + 2) / (w + l + 4) - 0.5);
}

// ¿Mueve este combate el Elo? Sólo los terminados con ganador: empates, anulados y pendientes no
const counts = f => f.state === 'post' && f.result && (f.result.winner === 'a' || f.result.winner === 'b');

// Aplica un combate a los ratings (Map id → { elo, fights, lastDate })
function applyFight(r, f, P = PARAMS) {
  const get = id => { if (!r.has(id)) r.set(id, { elo: 1500, fights: 0, lastDate: '' }); return r.get(id); };
  const a = get(f.a.id), b = get(f.b.id);
  const ea = expected(a.elo, b.elo, P.SCALE);
  const sa = f.result.winner === 'a' ? 1 : 0;
  const ka = P.K0 + P.K1 / (1 + a.fights), kb = P.K0 + P.K1 / (1 + b.fights);
  a.elo += ka * (sa - ea);
  b.elo += kb * ((1 - sa) - (1 - ea));
  a.fights++; b.fights++;
  a.lastDate = b.lastDate = f.date;
}

// Reconstruye el Elo recorriendo los combates por fecha. Un luchador sustituido (otro id) empieza en 1500 con 0 combates
function buildRatings(fights, P = PARAMS) {
  const r = new Map();
  fights.filter(counts).sort((x, y) => String(x.date).localeCompare(String(y.date))).forEach(f => applyFight(r, f, P));
  return r;
}

// Elo efectivo del luchador para este combate: el suyo, con el récord si tiene poco historial, y restando edad e inactividad
function effective(c, P = PARAMS) {
  const w = 1 / Math.pow(1 + (c.fights || 0), P.PRIOR_POW);
  let e = c.elo + w * (recordElo(c.record, P) - c.elo);
  if (c.ageYears > P.AGE_FROM) e -= (c.ageYears - P.AGE_FROM) * P.AGE_PER_YEAR;
  if (c.daysSinceLast > P.IDLE_FROM) e -= Math.min(P.IDLE_MAX, (c.daysSinceLast - P.IDLE_FROM) / P.IDLE_DAYS_PER_POINT);
  return e;
}

// a, b: { elo, fights, record, ageYears?, daysSinceLast? }; opts: { org, rounds, weightClass }
function predict(a, b, opts = {}, P = PARAMS) {
  const org = P.BASE[opts.org] ? opts.org : 'ufc';
  const rounds = opts.rounds || 3;
  const pA = clamp(expected(effective(a, P), effective(b, P), P.SCALE), 0.02, 0.98);
  const base = P.BASE[org];
  // Duración: la decisión baja con el favoritismo y con los cinco asaltos; el resto se reparte entre KO y sumisión como a priori
  const lop = Math.abs(2 * pA - 1);
  let dec = base.dec * (1 - (1 - P.LOPSIDED_DEC) * lop) * (rounds >= 5 ? P.FIVE_ROUND_DEC : 1);
  dec = clamp(dec, 0.05, 0.9);
  const fin = 1 - dec, koShare = base.ko / (base.ko + base.sub);
  const method = { ko: fin * koShare, sub: fin * (1 - koShare), dec };
  const joint = {
    a: { ko: pA * method.ko, sub: pA * method.sub, dec: pA * method.dec },
    b: { ko: (1 - pA) * method.ko, sub: (1 - pA) * method.sub, dec: (1 - pA) * method.dec }
  };
  const n = Math.min(a.fights || 0, b.fights || 0);
  let reliability = n < 3 ? 'baja' : n < 8 ? 'media' : 'alta';
  if (org === 'wow' && reliability === 'alta') reliability = 'media';
  return { pA, pB: 1 - pA, method, joint, goesDistance: dec, reliability };
}

// Probabilidad de que el combate dure más de `minutes` minutos (asaltos de 5): la decisión dura todo; el que acaba antes, un
// momento uniforme de su asalto
function pOver(p, rounds, minutes, P = PARAMS) {
  const R = clamp(rounds | 0, 1, 5);
  const w = P.FINISH_ROUND.slice(0, R), tot = w.reduce((t, x) => t + x, 0);
  let out = minutes < R * 5 ? p.goesDistance : 0;
  for (let r = 1; r <= R; r++) out += (1 - p.goesDistance) * (w[r - 1] / tot) * clamp((r * 5 - minutes) / 5, 0, 1);
  return clamp(out, 0, 1);
}

module.exports = { PARAMS, counts, applyFight, buildRatings, predict, pOver, recordElo, expected, effective, clamp };
