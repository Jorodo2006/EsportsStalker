// Modelo de tenis: Elo (general + por superficie) y saque y resto, juntados y calibrados.
//
// Base: el Elo que popularizaron FiveThirtyEight y Tennis Abstract.
//  - K decreciente con la experiencia del jugador: K = kBase / (n + kOffset)^kShape
//  - Rating por superficie aparte, y la predicción mezcla general y superficie.
//  - Los jugadores con pocos partidos se marcan como poco fiables.
// Desde noviembre de 2026, además, los puntos ganados al saque y al resto (src/stats.js), y la probabilidad final es
//   z = wElo · logit(p del Elo) + wStats · logit(p de saque y resto), con la cola de z aplanada (tail)
// Pesos y cola ajustados con los Challengers de 2023 y comprobados con los de 2024-2026 (fitWeights en evaluate.js; cifras en
// el README). Desde la fase 2, a z se le suman la actividad y el factor local de cada uno (src/form.js), con su peso.
// Se sigue llamando EloModel porque así lo usan el escáner, el servicio y los model.json guardados.

import { ServeReturn, STATS_DEFAULTS, roundRatings } from './stats.js';
import { activity, countryOf, dayNum, homeOf, mondayOf, recordTour, retirementRisk } from './form.js';

export const DEFAULTS = {
  initial: 1500,
  kBase: 250,
  kOffset: 5,
  kShape: 0.4,
  // 0 = solo general, 1 = solo superficie. 0.3 fue el mejor ajustando con los Challengers de 2023 (con 0.2 y 0.5 la
  // log-loss empeora); kBase 200-300 y kShape 0.4-0.5 salen casi iguales, por eso se quedan como estaban.
  surfaceWeight: 0.3,
  // Pesos de la mezcla, ajustados con los Challengers de 2023 (fitWeights) junto con los de la actividad y el factor local. En
  // los 28.117 de 2024 a noviembre de 2026: log-loss 0,6184 (Elo solo) → 0,6157 (fase 1, con saque y resto: wElo 0,691,
  // wStats 0,28, tailSlope 0,916) → 0,6134 (fase 2), y Brier 0,2152 → 0,2141 → 0,2131. Cifras de cada pieza en el README
  wElo: 0.69,
  wStats: 0.294,
  // Cola: por encima de |z| = tailFrom (logit 1,1 ≈ 75 %), z crece sólo tailSlope por cada unidad, para no pasarse de confiado
  // con los favoritos claros. Con el Elo solo no cambiaba nada (0,6184 igual); con saque y resto quita 0,0004
  tailFrom: 1.1,
  tailSlope: 0.875,
  // Actividad y factor local (fase 2, src/form.js): lo que suma a z cada unidad de diferencia entre los dos.
  //  - bWeeks: torneos en las 5 semanas anteriores (0 a 4). Es lo que más aporta: 0,6157 → 0,6138 por sí sola, en los dos
  //    tramos (Sackmann hasta mayo de 2026 y TennisMyLife desde junio). Uno que ha jugado 4 frente a uno que ha jugado 1: +7 pts
  //    a igualdad de lo demás.
  //  - bHome: jugar en su país: 0,6157 → 0,6153 por sí sola; con la actividad, 0,6134. Unos 2,7 pts.
  //  - bLastWeek: partidos de la semana anterior. Por sí sola casi nada (0,6155) y con la actividad nada (0,6139 frente a
  //    0,6138): no entra (0).
  bWeeks: 0.101,
  bLastWeek: 0,
  bHome: 0.107,
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

/**
 * La probabilidad final con los pesos y la cola de unas opciones: la usan predict y el ajuste de fitWeights.
 * d: diferencias entre A y B { weeks, lastWeek, home } (diffsOf), o null si no se saben.
 */
export function combine(pElo, pStats, o, d = null) {
  let z = o.wElo * logit(clampP(pElo)) + o.wStats * logit(clampP(pStats));
  const a = Math.abs(z);
  if (a > o.tailFrom) z = Math.sign(z) * (o.tailFrom + o.tailSlope * (a - o.tailFrom));
  if (d) z += (o.bWeeks || 0) * d.weeks + (o.bLastWeek || 0) * d.lastWeek + (o.bHome || 0) * d.home;
  return 1 / (1 + Math.exp(-z));
}

/** De los factores de predict, la diferencia entre A y B de cada uno (sin país del torneo, el factor local es 0). */
export function diffsOf(f) {
  if (!f) return null;
  return { weeks: f.weeks5[0] - f.weeks5[1], lastWeek: f.lastWeek[0] - f.lastWeek[1], home: (f.home[0] ?? 0) - (f.home[1] ?? 0) };
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
   * último que jugó cada uno al saque y al resto. ctx.tournament: el nombre del torneo, para la actividad y el factor local
   * (sin él no cuentan).
   * Devuelve { pA, pElo, pStats, ratingA, ratingB, nA, nB, lowData, factors }
   */
  predict(idA, idB, surface, date = null, ctx = {}) {
    const none = { overall: this.o.initial, surface: {}, n: 0, nSurface: {} };
    const a = this.players.get(idA) ?? none;
    const b = this.players.get(idB) ?? none;
    const ra = this.ratingOn(a, surface);
    const rb = this.ratingOn(b, surface);
    const pElo = expected(ra, rb);
    const day = (date ? Date.parse(date) : Date.now()) / 86400000;
    // Sin peso para las estadísticas no se calculan (es lo caro): así se predice igual que antes
    const pStats = this.o.wStats ? this.sr.predict(a, b, surface, day).p : 0.5;
    const factors = this.factors(a, b, date, ctx);
    return {
      pA: combine(pElo, pStats, this.o, diffsOf(factors)),
      pElo,
      pStats,
      ratingA: ra,
      ratingB: rb,
      nA: a.n,
      nB: b.n,
      lowData: a.n < this.o.minMatches || b.n < this.o.minMatches,
      factors,
    };
  }

  /**
   * Actividad, factor local y riesgo de retirada de A y B antes del partido: { weeks5: [a, b], lastWeek: [a, b], home: [a, b], venue,
   * stale, retire: [a, b], recentRet: [a, b], pr: [a, b] } (ctx.entryA y entryB: cómo entró cada uno al cuadro, 'PR'…).
   * Al entrenar (ctx.training) se cuentan desde el día de inicio del torneo y sin él (ctx.key); en directo, desde el lunes de la
   * semana del partido. Si el modelo no llega a la semana anterior (TennisMyLife va con días de retraso), no se sabe qué jugó
   * cada uno: la actividad se queda en 0 para los dos y stale lo dice. null sin fecha o sin torneo.
   */
  factors(a, b, date, { tournament = null, key = null, iocA = null, iocB = null, entryA = null, entryB = null, training = false } = {}) {
    if (!date || !tournament) return null;
    const ref = training ? dayNum(date) : mondayOf(date);
    const stale = !training && (!this.lastDate || dayNum(this.lastDate) < ref - 7);
    const zero = { weeks5: 0, lastWeek: 0 };
    const xa = stale ? zero : activity(a, ref, key), xb = stale ? zero : activity(b, ref, key);
    const venue = this.venueCountry(tournament);
    const ra = retirementRisk(a, ref, entryA), rb = retirementRisk(b, ref, entryB);
    return {
      weeks5: [xa.weeks5, xb.weeks5], lastWeek: [xa.lastWeek, xb.lastWeek],
      home: [homeOf(iocA || a.ioc, venue), homeOf(iocB || b.ioc, venue)], venue, stale,
      retire: [ra.r, rb.r], recentRet: [ra.recent, rb.recent], pr: [ra.pr, rb.pr],
    };
  }

  /** País del torneo por la tabla de ciudades o el nombre de LiveScore (countryOf), recordado por nombre. */
  venueCountry(name) {
    if (this._venueOf !== this.venues) { this._venueOf = this.venues; this._venueIoc = new Map(); }
    if (!this._venueIoc.has(name)) this._venueIoc.set(name, countryOf(this.venues, name));
    return this._venueIoc.get(name);
  }

  /**
   * Actualiza los ratings con un resultado. Devuelve la predicción previa (útil para validar); con { predict: false } no la
   * calcula, que al entrenar con los 320.000 partidos del histórico es lo que más tarda.
   */
  update(m, { predict = true } = {}) {
    const w = this.player(m.winnerId, m.winnerName);
    const l = this.player(m.loserId, m.loserName);
    // Cada torneo, por su identificador (o, en el formato propio, por nombre y fecha)
    const key = m.tourneyId || `${m.tourney}|${m.date}`;
    const pred = predict
      ? this.predict(w.id, l.id, m.surface, m.date, { tournament: m.tourney, key, iocA: m.winnerIoc, iocB: m.loserIoc, entryA: m.winnerEntry, entryB: m.loserEntry, training: true })
      : null;

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
    // Actividad y país (form.js)
    const day = dayNum(m.date);
    recordTour(w, key, day); recordTour(l, key, day);
    if (m.winnerIoc) w.ioc = m.winnerIoc;
    if (m.loserIoc) l.ioc = m.loserIoc;
    if (m.retired) l.lastRet = m.date; // riesgo de retirada (form.js)
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
    // De los torneos de cada uno sólo hace falta lo de las últimas semanas (la ventana es de 5): el resto no se guarda
    const cut = this.lastDate ? dayNum(this.lastDate) - 60 : -Infinity;
    const out = (p) => {
      if (!p.sr && !p.tours) return p;
      const q = { ...p };
      if (p.sr) q.sr = roundRatings(p.sr);
      const tours = (p.tours ?? []).filter((t) => t[1] >= cut);
      if (tours.length) q.tours = tours; else delete q.tours;
      return q;
    };
    return {
      options: this.o, lastDate: this.lastDate, venues: this.venues ?? {}, statsTotals: this.sr.totals,
      players: [...this.players.values()].map(out),
    };
  }

  static fromJSON(obj) {
    const o = { ...obj.options };
    // Un modelo guardado antes de las estadísticas: su rebaja de confianza es el peso del Elo y no hay más (predice igual
    // que cuando se guardó hasta que el servicio lo vuelva a entrenar)
    if (o.wElo == null) Object.assign(o, { wElo: o.confidence ?? 1, wStats: 0, tailSlope: 1 });
    delete o.confidence;
    // Uno de antes de la actividad y el factor local: no cuentan, para que prediga igual que cuando se guardó
    for (const k of ['bWeeks', 'bLastWeek', 'bHome']) o[k] ??= 0;
    const m = new EloModel(o, obj.statsTotals ?? {});
    m.lastDate = obj.lastDate;
    m.venues = obj.venues ?? {}; // superficie del último Challenger de cada ciudad (venueSurfaces en data.js)
    for (const p of obj.players) m.players.set(p.id, p);
    return m;
  }
}
