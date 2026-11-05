'use strict';
// Modelo de un partido de tenis. Dos ideas conocidas: la fuerza de cada jugador sale de un Elo (general y por superficie) y
// el estilo, de sus puntos ganados al saque y al resto. Con eso se calcula punto a punto, sin azar ni simulación, la
// probabilidad exacta de cada resultado (juego → set → partido), de donde salen todos los mercados.
// Funciones puras, sin red ni base de datos: las usan el servicio y la comprobación con partidos pasados (backtest.js).

const SURFACES = ['Hard', 'Clay', 'Grass'];
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const logit = p => Math.log(p / (1 - p));
const sigmoid = x => 1 / (1 + Math.exp(-x));
const num = v => { const n = parseFloat(v); return Number.isFinite(n) ? n : 0; };
const norm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z ]+/g, ' ').replace(/\s+/g, ' ').trim();

// Pesos ajustados con la comprobación de partidos pasados (backtest.js); ver docs/specs/09-tenis.md
const PARAMS = {
  halfLife: 200, // días hasta que un partido pesa la mitad en saque y resto
  priorPts: 350, // puntos ficticios en la media del circuito: con poca muestra manda la media
  surfacePts: 500, // ídem, de la superficie hacia lo general del jugador
  eloSurface: 0.5, // parte del Elo que es de la superficie
  wElo: 0.37, wStats: 0.62, // de logit(Elo) y logit(estadísticas) a la probabilidad del modelo
  formSd: 0.04, // lo que varía de un día a otro la diferencia en puntos entre los dos: un jugador no rinde siempre igual
  serveShift: 0 // corrección del nivel de saque: los puntos no son independientes y sin esto salen juegos de más
};

// Los pesos se aprendieron con 2024 y se evaluaron con 2025 y 2026, por separado en cada circuito
const paramsOf = tour => (tour === 'wta' ? { ...PARAMS, wElo: 0.33, wStats: 0.73 } : PARAMS);

// Cuadratura de Gauss-Hermite: promedia sobre el estado de forma del día con cinco valores en vez de simular
const FORM = [[0, 0.5333], [0.9586, 0.2221], [-0.9586, 0.2221], [2.0202, 0.01126], [-2.0202, 0.01126]];
const forms = (pa, pb, P = PARAMS) => FORM.map(([x, w]) => {
  const d = P.formSd * Math.SQRT2 * x;
  return [clamp(pa + d, 0.25, 0.95), clamp(pb - d, 0.25, 0.95), w];
});

// ---------- Punto a punto ----------
// Probabilidad de ganar un juego al saque si se gana cada punto con probabilidad p
function holdProb(p) {
  const q = 1 - p;
  return p ** 4 * (1 + 4 * q + 10 * q * q) + 20 * p ** 3 * q ** 3 * (p * p / (p * p + q * q));
}

// Tie-break a 7. a: A gana el punto cuando saca A; b: B gana el punto cuando saca B. firstA: saca primero A
function tiebreakA(a, b, firstA) {
  const ra = 1 - b; // A gana el punto cuando saca B
  const memo = new Map();
  const go = (x, y) => {
    if (x === 7 && y <= 5) return 1;
    if (y === 7 && x <= 5) return 0;
    if (x === 6 && y === 6) return (a * ra) / (a * ra + (1 - a) * (1 - ra)); // a partir de ahí, de dos en dos
    const k = x * 8 + y;
    if (memo.has(k)) return memo.get(k);
    const n = x + y; // saca el primero el punto 0 y luego cada dos: 0 | 1 2 | 3 4 | 5 6 | 7 8…
    const firstServes = n === 0 || (n - 1) % 4 >= 2;
    const aServes = firstServes === firstA;
    const pa = aServes ? a : ra;
    const v = pa * go(x + 1, y) + (1 - pa) * go(x, y + 1);
    memo.set(k, v);
    return v;
  };
  return go(0, 0);
}

// Resultados posibles de un set: [{ a, b, p, tb }] con los juegos de cada uno. firstA: saca primero A
function setOutcomes(pa, pb, firstA) {
  const ha = holdProb(pa), hb = holdProb(pb);
  const grid = Array.from({ length: 8 }, () => new Array(8).fill(0));
  grid[0][0] = 1;
  const out = [];
  for (let n = 0; n <= 12; n++) {
    for (let i = Math.max(0, n - 7); i <= Math.min(7, n); i++) {
      const j = n - i, p = grid[i]?.[j];
      if (!p) continue;
      if ((i === 6 && j <= 4) || (j === 6 && i <= 4) || (i === 7 && j === 5) || (j === 7 && i === 5)) { out.push({ a: i, b: j, p, tb: false }); continue; }
      if (i === 6 && j === 6) {
        const t = tiebreakA(pa, pb, firstA);
        out.push({ a: 7, b: 6, p: p * t, tb: true }, { a: 6, b: 7, p: p * (1 - t), tb: true });
        continue;
      }
      const aServes = (n % 2 === 0) === firstA;
      const w = aServes ? ha : 1 - hb; // A gana el juego
      grid[i + 1][j] += p * w;
      grid[i][j + 1] += p * (1 - w);
    }
  }
  return out;
}

// Probabilidad de ganar el partido, sin llevar la cuenta de los juegos: es lo que se repite al buscar el ajuste
function matchWin(pa, pb, bestOf) {
  const need = bestOf === 5 ? 3 : 2;
  const sets = [true, false].map(firstA => {
    const o = setOutcomes(pa, pb, firstA);
    const f = (win, keep) => o.filter(x => (x.a > x.b) === win && ((x.a + x.b) % 2 === 0) === keep).reduce((s, x) => s + x.p, 0);
    return { first: firstA, wKeep: f(true, true), wSwap: f(true, false), lKeep: f(false, true), lSwap: f(false, false) };
  });
  const memo = new Map();
  const go = (x, y, firstA) => {
    if (x === need) return 1;
    if (y === need) return 0;
    const k = `${x}|${y}|${firstA}`;
    if (memo.has(k)) return memo.get(k);
    const s = sets[firstA ? 0 : 1];
    const v = s.wKeep * go(x + 1, y, firstA) + s.wSwap * go(x + 1, y, !firstA) + s.lKeep * go(x, y + 1, firstA) + s.lSwap * go(x, y + 1, !firstA);
    memo.set(k, v);
    return v;
  };
  return (go(0, 0, true) + go(0, 0, false)) / 2;
}

// Distribución completa del partido: todos los marcadores finales posibles con sus juegos. No se sabe quién saca primero: 50 %
function matchDist(pa, pb, bestOf) {
  const need = bestOf === 5 ? 3 : 2;
  const so = { true: setOutcomes(pa, pb, true), false: setOutcomes(pa, pb, false) };
  // Estado: sets, quién saca primero el siguiente, juegos, si hubo tie-break, quién ganó el primer set
  let live = new Map([['0|0|1|0|0|0|-', { x: 0, y: 0, f: true, ga: 0, gb: 0, tb: 0, s1: null, p: 0.5 }], ['0|0|0|0|0|0|-', { x: 0, y: 0, f: false, ga: 0, gb: 0, tb: 0, s1: null, p: 0.5 }]]);
  const final = [];
  while (live.size) {
    const next = new Map();
    for (const st of live.values()) {
      for (const o of so[st.f]) {
        const win = o.a > o.b;
        const x = st.x + (win ? 1 : 0), y = st.y + (win ? 0 : 1);
        const f = (o.a + o.b) % 2 === 0 ? st.f : !st.f;
        const ga = st.ga + o.a, gb = st.gb + o.b, tb = st.tb || (o.tb ? 1 : 0), s1 = st.s1 ?? (win ? 'a' : 'b');
        const p = st.p * o.p;
        if (x === need || y === need) { final.push({ x, y, ga, gb, tb, s1, p }); continue; }
        const k = `${x}|${y}|${f ? 1 : 0}|${ga}|${gb}|${tb}|${s1}`;
        const cur = next.get(k);
        if (cur) cur.p += p; else next.set(k, { x, y, f, ga, gb, tb, s1, p });
      }
    }
    live = next;
  }
  return final;
}

// Lo mismo promediando sobre la forma del día
const matchWinMix = (pa, pb, bestOf, P = PARAMS) => forms(pa, pb, P).reduce((t, [x, y, w]) => t + w * matchWin(x, y, bestOf), 0);
const matchDistMix = (pa, pb, bestOf, P = PARAMS) => forms(pa, pb, P).flatMap(([x, y, w]) => matchDist(x, y, bestOf).map(o => ({ ...o, p: o.p * w })));

// Un set cualquiera, sin saber quién saca primero: el modelo no distingue entre el primero y los demás
function firstSetDist(pa, pb, P = PARAMS) {
  return forms(pa, pb, P).flatMap(([x, y, w]) => [...setOutcomes(x, y, true), ...setOutcomes(x, y, false)].map(o => ({ ...o, p: (o.p * w) / 2 })));
}

// Mueve la ventaja al saque hasta que el modelo de puntos da la probabilidad objetivo: el estilo (cuánto se rompe el saque)
// sale de las estadísticas y quién es mejor, de la probabilidad. Así los totales y hándicaps cuadran con el ganador.
function anchor(pa, pb, target, bestOf, P = PARAMS) {
  let lo = -0.3, hi = 0.3;
  const t = clamp(target, 0.005, 0.995);
  const at = d => [clamp(pa + d, 0.3, 0.92), clamp(pb - d, 0.3, 0.92)];
  for (let i = 0; i < 16; i++) {
    const mid = (lo + hi) / 2, [x, y] = at(mid);
    if (matchWinMix(x, y, bestOf, P) < t) lo = mid; else hi = mid;
  }
  return at((lo + hi) / 2);
}

// ---------- Histórico: Elo, saque y resto de cada jugador ----------
const ROUND = { R128: 1, R64: 2, R32: 3, R16: 4, QF: 5, SF: 6, BR: 6.5, F: 7, RR: 3, ER: 0, Q1: -3, Q2: -2, Q3: -1 };
const played = m => !/W\/?O|DEF|^\s*$/i.test(m.score);
const finishedClean = m => !/RET|W\/?O|DEF|ABD|Walkover/i.test(m.score) && String(m.score).trim() !== '';
const daysOf = d => { const s = String(d); return Date.UTC(+s.slice(0, 4), +s.slice(4, 6) - 1, +s.slice(6, 8)) / 864e5; };
const eloExpect = (a, b) => 1 / (1 + 10 ** ((b - a) / 400));
const eloK = n => 250 / (n + 5) ** 0.4;
const startElo = rank => (rank > 0 ? clamp(2400 - 190 * Math.log(rank), 1150, 2300) : 1300);

const newPlayer = rank => ({ elo: startElo(rank), n: 0, surf: {}, hist: [], last: null });
const surfElo = (pl, s) => (pl.surf[s] ??= { elo: pl.elo, n: 0 });

// Lo que un jugador gana al saque y al resto POR ENCIMA de la media de cada condición, en una fecha: con los partidos recientes
// pesando más y la muestra pequeña tirando hacia cero. En relación con la media porque el nivel lo pone la pista: si se mezclaran
// porcentajes de tierra y de hierba, en hierba saldrían menos juegos de los reales (y bajo techo, igual).
function rates(pl, surface, day, P = PARAMS) {
  let sw = 0, st = 0, rw = 0, rt = 0, sws = 0, sts = 0, rws = 0, rts = 0, games = 0, recent = 0;
  for (const h of pl.hist) {
    const age = day - h.day;
    if (age < 0) continue;
    const w = 0.5 ** (age / P.halfLife);
    sw += w * h.sw; st += w * h.st; rw += w * h.rw; rt += w * h.rt;
    if (h.surface === surface) { sws += w * h.sw; sts += w * h.st; rws += w * h.rw; rts += w * h.rt; games++; }
    if (age <= 90) recent++;
  }
  const sv = sw / (st + P.priorPts), ret = rw / (rt + P.priorPts);
  return {
    sv: (sws + P.surfacePts * sv) / (sts + P.surfacePts), ret: (rws + P.surfacePts * ret) / (rts + P.surfacePts),
    points: st + rt, surfacePoints: sts + rts, surfaceMatches: games, recent
  };
}

// Condición de juego: el saque rinde distinto en cada una, y la pista dura bajo techo no es la de fuera
const conditionOf = (surface, indoor) => (surface === 'Hard' && String(indoor).toUpperCase() === 'I' ? 'HardI' : surface);

// Reproduce los partidos en orden, sin mirar nunca al futuro. onMatch recibe cada partido justo antes de contarlo:
// así la comprobación con partidos pasados usa lo mismo que se sabría ese día.
function replay(rows, onMatch, P = PARAMS) {
  const players = new Map();
  const totals = {}; // media del circuito por superficie, también acumulada
  const avgOf = c => { const t = totals[c]?.pts > 2000 ? totals[c] : totals.all; return t && t.pts > 2000 ? { sv: t.won / t.pts } : { sv: 0.635 }; };
  const list = rows.filter(played).slice().sort((x, y) => String(x.tourney_date).localeCompare(String(y.tourney_date)) || (ROUND[x.round] ?? 3) - (ROUND[y.round] ?? 3) || num(x.match_num) - num(y.match_num));
  const get = (name, rank) => { const k = norm(name); if (!players.has(k)) players.set(k, newPlayer(rank)); return players.get(k); };
  for (const m of list) {
    const w = get(m.winner_name, num(m.winner_rank)), l = get(m.loser_name, num(m.loser_rank));
    const s = SURFACES.includes(m.surface) ? m.surface : 'Hard', day = daysOf(m.tourney_date), cond = conditionOf(s, m.indoor);
    if (onMatch) onMatch(m, w, l, s, day, avgOf(cond));
    const clean = finishedClean(m);
    // Una retirada no dice quién era mejor
    if (clean) {
      const update = (ra, rb, nw, nl, setA, setB, part) => {
        const e = eloExpect(ra, rb);
        setA(ra + eloK(nw) * (1 - e) * part);
        setB(rb - eloK(nl) * (1 - e) * part);
      };
      const sw_ = surfElo(w, s), sl_ = surfElo(l, s);
      const ow = w.elo, ol = l.elo;
      update(ow, ol, w.n, l.n, v => { w.elo = v; }, v => { l.elo = v; }, 1);
      update(sw_.elo, sl_.elo, sw_.n, sl_.n, v => { sw_.elo = v; }, v => { sl_.elo = v; }, 1);
      w.n++; l.n++; sw_.n++; sl_.n++;
    }
    if (num(m.w_svpt) && num(m.l_svpt)) {
      const avg = avgOf(cond);
      const ws = num(m.w_1stWon) + num(m.w_2ndWon), wp = num(m.w_svpt), ls = num(m.l_1stWon) + num(m.l_2ndWon), lp = num(m.l_svpt);
      // Se guarda lo ganado por encima de lo esperado ante ESE rival en ESA pista: sacar contra un gran restador vale más
      const rw = rates(w, s, day, P), rl = rates(l, s, day, P);
      const add = (me, opp, sWon, sPts, rWon, rPts) => me.hist.push({
        day, surface: s, st: sPts, rt: rPts,
        sw: sWon - sPts * (avg.sv - opp.ret), rw: rWon - rPts * (1 - avg.sv - opp.sv)
      });
      add(w, rl, ws, wp, lp - ls, lp);
      add(l, rw, ls, lp, wp - ws, wp);
      for (const key of [cond, 'all']) { const t = (totals[key] ??= { won: 0, pts: 0 }); t.won += ws + ls; t.pts += wp + lp; }
    }
    w.last = l.last = day;
  }
  return { players, avgOf };
}

// Probabilidad y estilo de un partido, con lo que se sabe de los dos jugadores ese día
function predict(a, b, surface, day, avg, bestOf = 3, P = PARAMS) {
  const ea = a.elo * (1 - P.eloSurface) + surfElo(a, surface).elo * P.eloSurface;
  const eb = b.elo * (1 - P.eloSurface) + surfElo(b, surface).elo * P.eloSurface;
  const pElo = eloExpect(ea, eb);
  const ra = rates(a, surface, day, P), rb = rates(b, surface, day, P);
  const sa = clamp(avg.sv + ra.sv - rb.ret + P.serveShift, 0.35, 0.9);
  const sb = clamp(avg.sv + rb.sv - ra.ret + P.serveShift, 0.35, 0.9);
  const pStats = matchWinMix(sa, sb, 3, P);
  // El Elo y las estadísticas se aprenden casi siempre a tres sets: se traducen a puntos y de ahí al formato del partido
  const p3 = sigmoid(P.wElo * logit(clamp(pElo, 0.005, 0.995)) + P.wStats * logit(clamp(pStats, 0.005, 0.995)));
  const [xa, xb] = anchor(sa, sb, p3, 3, P);
  const pModel = bestOf === 3 ? p3 : matchWinMix(xa, xb, bestOf, P);
  return { pElo, pStats, pModel, sa, sb, serveA: xa, serveB: xb, ra, rb, ea, eb, bestOf };
}

module.exports = { PARAMS, paramsOf, conditionOf, holdProb, tiebreakA, setOutcomes, matchWin, matchWinMix, matchDist, matchDistMix, firstSetDist, anchor, replay, predict, rates, clamp, logit, sigmoid, norm, num, finishedClean };
