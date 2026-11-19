// Saque y resto de cada jugador, y de ahí la probabilidad de ganar el partido punto a punto.
//
// Es la idea de server/services/tennis/model.js (el modelo de ATP y WTA), copiada aquí porque el motor es un paquete aparte
// (su package.json y su línea de órdenes) y no puede depender del servicio de tenis:
//  - De cada partido con estadísticas se guarda lo que cada uno ganó al saque y al resto POR ENCIMA de lo esperado ante ESE
//    rival en ESA superficie (sacar contra un gran restador vale más), con los partidos recientes pesando más.
//  - Con poca muestra tira hacia la media (priorPts) y, en una superficie, hacia lo general del jugador (surfacePts). Los ITF
//    no traen estadísticas: sus jugadores se quedan en la media y manda el Elo.
//  - Con el porcentaje de puntos al saque de cada uno en este partido sale, exacto, el de ganar el juego, el set y el partido.
// Los ratings se guardan ya descontados a la fecha de su último partido ([día, ...sumas]): se actualizan en un paso, sin
// guardar la lista de partidos, para que el modelo siga cabiendo en los 256 MB con los que se entrena.

// Elegidos por la log-loss de los Challengers de 2023 entre halfLife 120/200/365, priorPts 150/350/700 y surfacePts
// 250/500/1000 (los del modelo de ATP y WTA son 200, 350 y 500). En los Challengers lo reciente pesa más, hace falta menos
// muestra y la superficie cuenta menos que en el circuito principal. La diferencia entre todos es pequeña (0,6190 a 0,6196)
export const STATS_DEFAULTS = {
  halfLife: 120, // días hasta que un partido pesa la mitad
  priorPts: 150, // puntos ficticios en la media: con poca muestra manda la media
  surfacePts: 1000, // ídem, de la superficie hacia lo general del jugador
};
const AVG_SERVE = 0.635; // puntos ganados al saque en el circuito, hasta tener 2.000 puntos de una superficie
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const dayOf = (date) => Date.parse(date) / 86400000;

// ---------- Punto a punto (como model.js) ----------
/** Probabilidad de ganar un juego al saque si se gana cada punto con probabilidad p. */
export function holdProb(p) {
  const q = 1 - p;
  return p ** 4 * (1 + 4 * q + 10 * q * q) + 20 * p ** 3 * q ** 3 * ((p * p) / (p * p + q * q));
}

// Tie-break a 7. a: A gana el punto cuando saca A; b: B gana el punto cuando saca B. firstA: saca primero A
function tiebreakA(a, b, firstA) {
  const ra = 1 - b;
  const memo = new Map();
  const go = (x, y) => {
    if (x === 7 && y <= 5) return 1;
    if (y === 7 && x <= 5) return 0;
    if (x === 6 && y === 6) return (a * ra) / (a * ra + (1 - a) * (1 - ra)); // de dos en dos
    const k = x * 8 + y;
    if (memo.has(k)) return memo.get(k);
    const n = x + y; // saca el primero el punto 0 y luego cada dos
    const aServes = (n === 0 || (n - 1) % 4 >= 2) === firstA;
    const pa = aServes ? a : ra;
    const v = pa * go(x + 1, y) + (1 - pa) * go(x, y + 1);
    memo.set(k, v);
    return v;
  };
  return go(0, 0);
}

// Un set: probabilidad de que lo gane A y de que el siguiente lo empiece sacando el mismo (número de juegos par)
function setProbs(pa, pb, firstA) {
  const ha = holdProb(pa), hb = holdProb(pb);
  const grid = Array.from({ length: 8 }, () => new Array(8).fill(0));
  grid[0][0] = 1;
  const r = { wKeep: 0, wSwap: 0, lKeep: 0, lSwap: 0 };
  const end = (aWon, games, p) => { r[(aWon ? 'w' : 'l') + (games % 2 === 0 ? 'Keep' : 'Swap')] += p; };
  for (let n = 0; n <= 12; n++) {
    for (let i = Math.max(0, n - 7); i <= Math.min(7, n); i++) {
      const j = n - i, p = grid[i]?.[j];
      if (!p) continue;
      if ((i === 6 && j <= 4) || (i === 7 && j === 5)) { end(true, n, p); continue; }
      if ((j === 6 && i <= 4) || (j === 7 && i === 5)) { end(false, n, p); continue; }
      if (i === 6 && j === 6) { const t = tiebreakA(pa, pb, firstA); end(true, 13, p * t); end(false, 13, p * (1 - t)); continue; }
      const w = (n % 2 === 0) === firstA ? ha : 1 - hb; // A gana el juego
      grid[i + 1][j] += p * w;
      grid[i][j + 1] += p * (1 - w);
    }
  }
  return r;
}

/** Probabilidad de que A gane el partido (al mejor de 3 o de 5); no se sabe quién saca primero: mitad y mitad. */
export function matchWin(pa, pb, bestOf = 3) {
  const need = bestOf === 5 ? 3 : 2;
  const sets = { true: setProbs(pa, pb, true), false: setProbs(pa, pb, false) };
  const memo = new Map();
  const go = (x, y, firstA) => {
    if (x === need) return 1;
    if (y === need) return 0;
    const k = `${x}|${y}|${firstA}`;
    if (memo.has(k)) return memo.get(k);
    const s = sets[firstA];
    const v = s.wKeep * go(x + 1, y, firstA) + s.wSwap * go(x + 1, y, !firstA) + s.lKeep * go(x, y + 1, firstA) + s.lSwap * go(x, y + 1, !firstA);
    memo.set(k, v);
    return v;
  };
  return (go(0, 0, true) + go(0, 0, false)) / 2;
}

// ---------- Ratings de saque y resto ----------
export class ServeReturn {
  constructor(opts = {}, totals = {}) {
    this.o = { ...STATS_DEFAULTS, ...opts };
    this.totals = totals; // puntos al saque jugados y ganados por superficie y en total: la media del circuito
  }

  /** Media de puntos ganados al saque en la superficie (o en general, si de esa todavía hay poco). */
  avg(surface) {
    const t = this.totals[surface]?.pts > 2000 ? this.totals[surface] : this.totals.all;
    return t?.pts > 2000 ? t.won / t.pts : AVG_SERVE;
  }

  /** Lo que gana el jugador al saque (sv) y al resto (ret) por encima de la media, en esa superficie y ese día. */
  rates(p, surface, day) {
    const read = (x) => {
      if (!x) return [0, 0, 0, 0];
      const f = 0.5 ** (Math.max(0, day - x[0]) / this.o.halfLife);
      return [x[1] * f, x[2] * f, x[3] * f, x[4] * f];
    };
    const [sw, st, rw, rt] = read(p?.sr?.all), [sws, sts, rws, rts] = read(p?.sr?.[surface]);
    const sv = sw / (st + this.o.priorPts), ret = rw / (rt + this.o.priorPts);
    const k = this.o.surfacePts;
    return { sv: (sws + k * sv) / (sts + k), ret: (rws + k * ret) / (rts + k), points: st + rt };
  }

  /** Probabilidad de que A gane a B por saque y resto, y el porcentaje de puntos al saque de cada uno en este partido. */
  predict(a, b, surface, day, bestOf = 3) {
    const avg = this.avg(surface), ra = this.rates(a, surface, day), rb = this.rates(b, surface, day);
    const sa = clamp(avg + ra.sv - rb.ret, 0.35, 0.9), sb = clamp(avg + rb.sv - ra.ret, 0.35, 0.9);
    return { p: matchWin(sa, sb, bestOf), sa, sb, points: Math.min(ra.points, rb.points) };
  }

  /** Cuenta un partido: serve = [puntos al saque del ganador, ganados, del perdedor, ganados] (data.js). */
  update(w, l, surface, date, serve) {
    if (!serve) return;
    const [wp, ws, lp, ls] = serve, day = dayOf(date), avg = this.avg(surface);
    const rw = this.rates(w, surface, day), rl = this.rates(l, surface, day);
    // Ganado por encima de lo esperado ante ese rival: al saque, la media menos lo que resta él; al resto, lo contrario
    this.add(w, surface, day, ws - wp * (avg - rl.ret), wp, lp - ls - lp * (1 - avg - rl.sv), lp);
    this.add(l, surface, day, ls - lp * (avg - rw.ret), lp, wp - ws - wp * (1 - avg - rw.sv), wp);
    for (const k of [surface, 'all']) {
      const t = (this.totals[k] ??= { won: 0, pts: 0 });
      t.won += ws + ls; t.pts += wp + lp;
    }
  }

  add(p, surface, day, sw, st, rw, rt) {
    p.sr ??= {};
    for (const k of ['all', surface]) {
      const x = p.sr[k];
      const f = x ? 0.5 ** (Math.max(0, day - x[0]) / this.o.halfLife) : 0;
      p.sr[k] = x ? [Math.max(day, x[0]), x[1] * f + sw, x[2] * f + st, x[3] * f + rw, x[4] * f + rt] : [day, sw, st, rw, rt];
    }
  }
}

/** Para guardar el modelo: sumas con cuatro decimales (el fichero pesa la mitad y no cambia ninguna predicción). */
export function roundRatings(sr) {
  if (!sr) return sr;
  const out = {};
  for (const [k, x] of Object.entries(sr)) out[k] = x.map((v, i) => (i === 0 ? v : Math.round(v * 1e4) / 1e4));
  return out;
}
