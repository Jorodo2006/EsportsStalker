// Modelo Elo para tenis con rating general + rating por superficie.
//
// Base: el Elo que popularizaron FiveThirtyEight y Tennis Abstract.
//  - K decreciente con la experiencia del jugador: K = kBase / (n + kOffset)^kShape
//  - Rating por superficie aparte, y la predicción mezcla general y superficie.
//  - Los jugadores con pocos partidos se marcan como poco fiables.

export const DEFAULTS = {
  initial: 1500,
  kBase: 250,
  kOffset: 5,
  kShape: 0.4,
  // 0 = solo general, 1 = solo superficie. 0.3 fue el mejor ajustando con los Challengers de 2023 (con 0.2 y 0.5 la
  // log-loss empeora); kBase 200-300 y kShape 0.4-0.5 salen casi iguales, por eso se quedan como estaban.
  surfaceWeight: 0.3,
  // La predicción es sigmoid(confidence · logit(p del Elo)). En el cuadro final de los Challengers (lo que dan las casas)
  // el Elo se pasa de confiado: decía 87 % y ganaba el 82 %. 0.91 se ajustó con 2023 y en 2024-2026 lo deja en 85 %
  // (log-loss 0,6318 → 0,6308; jun-nov 2026: 0,6383 → 0,6361). En las previas no cambia nada. No toca los ratings.
  confidence: 0.91,
  minMatches: 10, // por debajo, la predicción se marca como "poca info"
  inactivityDays: 120, // tras este parón, el K vuelve a subir un poco (vuelta de lesión)
};

export function expected(ra, rb) {
  return 1 / (1 + Math.pow(10, (rb - ra) / 400));
}

function daysBetween(a, b) {
  return Math.round((Date.parse(b) - Date.parse(a)) / 86400000);
}

export class EloModel {
  constructor(opts = {}) {
    this.o = { ...DEFAULTS, ...opts };
    this.players = new Map();
    this.lastDate = null;
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
   * Probabilidad de que A gane a B en esa superficie.
   * Devuelve { pA, ratingA, ratingB, nA, nB, lowData }
   */
  predict(idA, idB, surface) {
    const a = this.players.get(idA) ?? { overall: this.o.initial, surface: {}, n: 0, nSurface: {} };
    const b = this.players.get(idB) ?? { overall: this.o.initial, surface: {}, n: 0, nSurface: {} };
    const ra = this.ratingOn(a, surface);
    const rb = this.ratingOn(b, surface);
    const p = expected(ra, rb);
    const c = this.o.confidence ?? 1;
    return {
      pA: c === 1 ? p : 1 / (1 + ((1 - p) / p) ** c),
      ratingA: ra,
      ratingB: rb,
      nA: a.n,
      nB: b.n,
      lowData: a.n < this.o.minMatches || b.n < this.o.minMatches,
    };
  }

  /** Actualiza los ratings con un resultado. Devuelve la predicción previa (útil para validar). */
  update(m) {
    const w = this.player(m.winnerId, m.winnerName);
    const l = this.player(m.loserId, m.loserName);
    const pred = this.predict(w.id, l.id, m.surface);

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

    w.n++; l.n++;
    w.nSurface[m.surface] = (w.nSurface[m.surface] ?? 0) + 1;
    l.nSurface[m.surface] = (l.nSurface[m.surface] ?? 0) + 1;
    w.last = m.date; l.last = m.date;
    this.lastDate = m.date;
    return pred;
  }

  fit(matches) {
    for (const m of matches) this.update(m);
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
    return { options: this.o, lastDate: this.lastDate, venues: this.venues ?? {}, players: [...this.players.values()] };
  }

  static fromJSON(obj) {
    const m = new EloModel(obj.options);
    m.lastDate = obj.lastDate;
    m.venues = obj.venues ?? {}; // superficie del último Challenger de cada ciudad (venueSurfaces en data.js)
    for (const p of obj.players) m.players.set(p.id, p);
    return m;
  }
}
