// Modelo de tenis: Elo (general + por superficie) y saque y resto, juntados y calibrados.
//
// Base: el Elo que popularizaron FiveThirtyEight y Tennis Abstract.
//  - K decreciente con la experiencia del jugador: K = kBase / (n + kOffset)^kShape
//  - Rating por superficie aparte, y la predicción mezcla general y superficie.
//  - Los jugadores con pocos partidos se marcan como poco fiables.
// Desde noviembre de 2026, además, los puntos ganados al saque y al resto (src/stats.js), y la probabilidad final es
//   z = wElo · logit(p del Elo) + wStats · logit(p de saque y resto), con la cola de z aplanada (tail)
// Pesos y cola ajustados con los Challengers de 2023 y comprobados con los de 2024-2026 (fitWeights en evaluate.js; cifras en
// el README). Se sigue llamando EloModel porque así lo usan el escáner, el servicio y los model.json guardados.

import { ServeReturn, STATS_DEFAULTS, roundRatings } from './stats.js';

export const DEFAULTS = {
  initial: 1500,
  kBase: 250,
  kOffset: 5,
  kShape: 0.4,
  // 0 = solo general, 1 = solo superficie. 0.3 fue el mejor ajustando con los Challengers de 2023 (con 0.2 y 0.5 la
  // log-loss empeora); kBase 200-300 y kShape 0.4-0.5 salen casi iguales, por eso se quedan como estaban.
  surfaceWeight: 0.3,
  // Pesos de la mezcla, ajustados con los Challengers de 2023 (fitWeights). En los 28.117 de 2024 a noviembre de 2026: log-loss
  // 0,6184 → 0,6157 y Brier 0,2152 → 0,2141 frente al Elo solo (wElo 0.91, wStats 0, que es lo que da un model.json de
  // antes), y la mejora es la misma antes y después de junio de 2026 (0,6149 → 0,6122 y 0,6400 → 0,6373)
  wElo: 0.691,
  wStats: 0.28,
  // Cola: por encima de |z| = tailFrom (logit 1,1 ≈ 75 %), z crece sólo tailSlope por cada unidad, para no pasarse de confiado
  // con los favoritos claros. Con el Elo solo no cambiaba nada (0,6184 igual); con saque y resto quita 0,0004
  tailFrom: 1.1,
  tailSlope: 0.916,
  stats: STATS_DEFAULTS,
  minMatches: 10, // por debajo, la predicción se marca como "poca info"
  inactivityDays: 120, // tras este parón, el K vuelve a subir un poco (vuelta de lesión)
};

export function expected(ra, rb) {
  return 1 / (1 + Math.pow(10, (rb - ra) / 400));
}

const logit = (p) => Math.log(p / (1 - p));
const clampP = (p) => Math.min(0.995, Math.max(0.005, p));

function daysBetween(a, b) {
  return Math.round((Date.parse(b) - Date.parse(a)) / 86400000);
}

/** La probabilidad final con los pesos y la cola de unas opciones: la usan predict y el ajuste de fitWeights. */
export function combine(pElo, pStats, o) {
  let z = o.wElo * logit(clampP(pElo)) + o.wStats * logit(clampP(pStats));
  const a = Math.abs(z);
  if (a > o.tailFrom) z = Math.sign(z) * (o.tailFrom + o.tailSlope * (a - o.tailFrom));
  return 1 / (1 + Math.exp(-z));
}

export class EloModel {
  constructor(opts = {}, statsTotals = {}) {
    this.o = { ...DEFAULTS, ...opts, stats: { ...STATS_DEFAULTS, ...(opts.stats ?? {}) } };
    this.players = new Map();
    this.lastDate = null;
    this.sr = new ServeReturn(this.o.stats, statsTotals);
  }

  player(id, name) {
    let p = this.players.get(id);
    if (!p) {
      p = { id, name, overall: this.o.initial, surface: {}, n: 0, nSurface: {}, last: null };
      this.players.set(id, p);
    } else if (name && !p.name) p.name = name;
    return p;
  }

  k(n, lastDate, date) {
    let k = this.o.kBase / Math.pow(n + this.o.kOffset, this.o.kShape);
    if (lastDate && date && daysBetween(lastDate, date) > this.o.inactivityDays) k *= 1.5;
    return k;
  }

  ratingOn(p, surface) {
    const s = p.surface[surface] ?? this.o.initial;
    const w = this.o.surfaceWeight;
    return (1 - w) * p.overall + w * s;
  }

  /**
   * Probabilidad de que A gane a B en esa superficie. date: el día del partido (por defecto hoy), para saber cuánto pesa lo
   * último que jugó cada uno al saque y al resto.
   * Devuelve { pA, pElo, pStats, ratingA, ratingB, nA, nB, lowData }
   */
  predict(idA, idB, surface, date = null) {
    const none = { overall: this.o.initial, surface: {}, n: 0, nSurface: {} };
    const a = this.players.get(idA) ?? none;
    const b = this.players.get(idB) ?? none;
    const ra = this.ratingOn(a, surface);
    const rb = this.ratingOn(b, surface);
    const pElo = expected(ra, rb);
    const day = (date ? Date.parse(date) : Date.now()) / 86400000;
    // Sin peso para las estadísticas no se calculan (es lo caro): así se predice igual que antes
    const pStats = this.o.wStats ? this.sr.predict(a, b, surface, day).p : 0.5;
    return {
      pA: combine(pElo, pStats, this.o),
      pElo,
      pStats,
      ratingA: ra,
      ratingB: rb,
      nA: a.n,
      nB: b.n,
      lowData: a.n < this.o.minMatches || b.n < this.o.minMatches,
    };
  }

  /**
   * Actualiza los ratings con un resultado. Devuelve la predicción previa (útil para validar); con { predict: false } no la
   * calcula, que al entrenar con los 320.000 partidos del histórico es lo que más tarda.
   */
  update(m, { predict = true } = {}) {
    const w = this.player(m.winnerId, m.winnerName);
    const l = this.player(m.loserId, m.loserName);
    const pred = predict ? this.predict(w.id, l.id, m.surface, m.date) : null;

    // General
    const eo = expected(w.overall, l.overall);
    const kw = this.k(w.n, w.last, m.date);
    const kl = this.k(l.n, l.last, m.date);
    w.overall += kw * (1 - eo);
    l.overall -= kl * (1 - eo);

    // Superficie
    const ws = w.surface[m.surface] ?? this.o.initial;
    const ls = l.surface[m.surface] ?? this.o.initial;
    const es = expected(ws, ls);
    const kws = this.k(w.nSurface[m.surface] ?? 0, null, null);
    const kls = this.k(l.nSurface[m.surface] ?? 0, null, null);
    w.surface[m.surface] = ws + kws * (1 - es);
    l.surface[m.surface] = ls - kls * (1 - es);

    // Saque y resto, si el partido trae estadísticas (los ITF no)
    this.sr.update(w, l, m.surface, m.date, m.serve);

    w.n++; l.n++;
    w.nSurface[m.surface] = (w.nSurface[m.surface] ?? 0) + 1;
    l.nSurface[m.surface] = (l.nSurface[m.surface] ?? 0) + 1;
    w.last = m.date; l.last = m.date;
    this.lastDate = m.date;
    return pred;
  }

  fit(matches) {
    for (const m of matches) this.update(m, { predict: false });
    return this;
  }

  top(n = 20, surface = null) {
    return [...this.players.values()]
      .filter((p) => p.n >= this.o.minMatches)
      .map((p) => ({ name: p.name, rating: surface ? this.ratingOn(p, surface) : p.overall, matches: p.n, last: p.last }))
      .sort((a, b) => b.rating - a.rating)
      .slice(0, n);
  }

  toJSON() {
    return {
      options: this.o, lastDate: this.lastDate, venues: this.venues ?? {}, statsTotals: this.sr.totals,
      players: [...this.players.values()].map((p) => (p.sr ? { ...p, sr: roundRatings(p.sr) } : p)),
    };
  }

  static fromJSON(obj) {
    const o = { ...obj.options };
    // Un modelo guardado antes de las estadísticas: su rebaja de confianza es el peso del Elo y no hay más (predice igual
    // que cuando se guardó hasta que el servicio lo vuelva a entrenar)
    if (o.wElo == null) Object.assign(o, { wElo: o.confidence ?? 1, wStats: 0, tailSlope: 1 });
    delete o.confidence;
    const m = new EloModel(o, obj.statsTotals ?? {});
    m.lastDate = obj.lastDate;
    m.venues = obj.venues ?? {}; // superficie del último Challenger de cada ciudad (venueSurfaces en data.js)
    for (const p of obj.players) m.players.set(p.id, p);
    return m;
  }
}
