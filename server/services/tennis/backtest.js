'use strict';
// Comprobación del modelo con partidos pasados: para cada partido predice sólo con lo que se sabía ese día y lo compara con lo
// que pasó. No es parte del servicio: se lanza a mano y no guarda nada en el repo.
//   node server/services/tennis/backtest.js <carpeta con los CSV de TennisMyLife> [atp|wta] [desde AAAAMMDD]
// No hay cuotas históricas gratuitas que se puedan usar, así que dice si las probabilidades son correctas, no si se gana dinero.
const fs = require('fs');
const path = require('path');
const M = require('./model');

const { num, norm, logit, clamp } = M;

function parseCsv(text) {
  const lines = text.split(/\r?\n/).filter(Boolean);
  const head = lines[0].split(',');
  return lines.slice(1).map(l => {
    const out = {}; let cur = '', q = false, i = 0;
    for (const c of `${l},`) {
      if (c === '"') q = !q;
      else if (c === ',' && !q) { out[head[i++]] = cur; cur = ''; } else cur += c;
    }
    return out;
  });
}

function load(dir, tour) {
  const files = fs.readdirSync(dir).filter(f => (tour === 'wta' ? /^\d{4}_wta\.csv$/ : /^\d{4}\.csv$/).test(f)).sort();
  return files.flatMap(f => parseCsv(fs.readFileSync(path.join(dir, f), 'utf8')));
}

// Resultado real del partido a partir del marcador, siempre desde el punto de vista del ganador
function parseScore(score) {
  const sets = [];
  for (const s of String(score).trim().split(/\s+/)) {
    const x = s.match(/^(\d+)-(\d+)(?:\(\d+\))?$/);
    if (!x) return null;
    sets.push([+x[1], +x[2]]);
  }
  return sets.length >= 2 ? sets : null;
}

// Tabla de calibración: lo que el modelo decía frente a lo que pasó
class Calib {
  constructor(name) { this.name = name; this.b = Array.from({ length: 10 }, () => ({ n: 0, p: 0, y: 0 })); this.ll = 0; this.br = 0; this.n = 0; }
  add(p, y) {
    const q = clamp(p, 0.001, 0.999), bin = this.b[Math.min(9, Math.floor(q * 10))];
    bin.n++; bin.p += q; bin.y += y; this.n++; this.br += (q - y) ** 2; this.ll -= y * Math.log(q) + (1 - y) * Math.log(1 - q);
  }
  summary() { return `${this.name}: n=${this.n} brier=${(this.br / this.n).toFixed(4)} logloss=${(this.ll / this.n).toFixed(4)}`; }
  table() {
    return this.b.filter(x => x.n >= 15).map(x => `  ${((x.p / x.n) * 100).toFixed(1).padStart(5)}% → ${((x.y / x.n) * 100).toFixed(1).padStart(5)}%  (${x.n})`).join('\n');
  }
}

function run(rows, from, params, opts = {}, until = '99999999') {
  const P = { ...M.PARAMS, ...params };
  const r = {
    elo: new Calib('Elo'), stats: new Calib('Estadísticas'), model: new Calib('Modelo'), rank: new Calib('Ranking'), fives: new Calib('Modelo a 5 sets'),
    total: new Calib('Total de juegos (más de)'), hcap: new Calib('Hándicap de juegos'), straight: new Calib('Ganar en dos/tres sets'), anySet: new Calib('Gana al menos un set'),
    tb: new Calib('Hay tie-break'), set1: new Calib('Primer set'), playerG: new Calib('Juegos de un jugador (más de)'),
    bagel: new Calib('Algún set a cero'), odd: new Calib('Total de juegos impar'),
    acesP: new Calib('Aces de un jugador (k o más)'), acesT: new Calib('Aces entre los dos (k o más)'), xs: []
  };
  let sumT = 0, sumTm = 0, nT = 0, sumA = 0, sumAm = 0, nA = 0;
  M.replay(rows, (m, w, l, s, day, avg) => {
    if (String(m.tourney_date) < from || String(m.tourney_date) > until || !M.finishedClean(m) || (w.n < 5 && l.n < 5)) return;
    const bo = num(m.best_of) === 5 ? 5 : 3;
    // Se mira siempre desde el orden alfabético, para que el ganador no esté siempre al mismo lado
    const flip = norm(m.winner_name) > norm(m.loser_name);
    const [a, b] = flip ? [l, w] : [w, l], y = flip ? 0 : 1;
    const f = M.predict(a, b, s, day, avg, bo, P);
    r.elo.add(f.pElo, y); r.stats.add(f.pStats, y); r.model.add(f.pModel, y);
    if (bo === 5) r.fives.add(f.pModel, y);
    const ra = num(flip ? m.loser_rank : m.winner_rank), rb = num(flip ? m.winner_rank : m.loser_rank);
    if (ra && rb) r.rank.add(1 / (1 + (ra / rb) ** 0.8), y);
    r.xs.push({ le: M.logit(clamp(f.pElo, 0.01, 0.99)), ls: M.logit(clamp(f.pStats, 0.01, 0.99)), y, bo });
    if (opts.fast) return;
    const sets = parseScore(m.score);
    if (!sets) return;
    const dist = M.matchDistMix(f.serveA, f.serveB, bo, P);
    const gw = sets.reduce((t, x) => t + x[0], 0), gl = sets.reduce((t, x) => t + x[1], 0);
    const ga = flip ? gl : gw, gb = flip ? gw : gl, tot = ga + gb;
    const exp = dist.reduce((t, x) => t + x.p * (x.ga + x.gb), 0);
    sumT += tot; sumTm += exp; nT++;
    const prob = fn => dist.reduce((t, x) => t + (fn(x) ? x.p : 0), 0);
    // Total: líneas fijas, las que suelen dar las casas. Si dependieran del modelo no se podrían comparar dos ajustes
    for (const line of bo === 5 ? [32.5, 35.5, 38.5, 41.5] : [19.5, 20.5, 21.5, 22.5, 23.5, 24.5, 25.5]) {
      r.total.add(prob(x => x.ga + x.gb > line), tot > line ? 1 : 0);
    }
    // Hándicap del favorito del modelo
    const favA = f.pModel >= 0.5;
    for (const h of [-1.5, -3.5, -5.5]) {
      const pr = prob(x => (favA ? x.ga - x.gb : x.gb - x.ga) + h > 0);
      r.hcap.add(pr, ((favA ? ga - gb : gb - ga) + h > 0) ? 1 : 0);
    }
    const setsA = sets.filter(x => x[0] > x[1]).length, setsB = sets.length - setsA;
    const need = bo === 5 ? 3 : 2;
    // Sin perder set, para el favorito
    r.straight.add(prob(x => (favA ? x.x === need && x.y === 0 : x.y === need && x.x === 0)), setsB === 0 && (favA ? y === 1 : y === 0) ? 1 : 0);
    // El no favorito gana al menos un set
    const dogSets = favA ? (y === 1 ? setsB : setsA) : (y === 1 ? setsA : setsB);
    r.anySet.add(prob(x => (favA ? x.y >= 1 : x.x >= 1)), dogSets >= 1 ? 1 : 0);
    const anyTb = sets.some(x => Math.max(x[0], x[1]) === 7 && Math.min(x[0], x[1]) === 6);
    r.tb.add(prob(x => x.tb === 1), anyTb ? 1 : 0);
    const s1 = M.firstSetDist(f.serveA, f.serveB, P).reduce((t, o) => t + (o.a > o.b ? o.p : 0), 0);
    const first = sets[0][0] > sets[0][1]; // true si el primer set lo ganó el ganador del partido
    r.set1.add(s1, (y === 1) === first ? 1 : 0);
    for (const line of bo === 5 ? [13.5, 16.5, 19.5] : [9.5, 11.5, 13.5]) {
      const me = favA ? ga : gb;
      r.playerG.add(prob(x => (favA ? x.ga : x.gb) > line), me > line ? 1 : 0);
    }
    r.bagel.add(prob(x => x.z === 1), sets.some(x => x[0] === 0 || x[1] === 0) ? 1 : 0);
    r.odd.add(prob(x => (x.ga + x.gb) % 2 === 1), tot % 2);
    if (m.w_ace !== '' && m.l_ace !== '' && m.w_ace != null && m.l_ace != null) {
      const acA = num(flip ? m.l_ace : m.w_ace), acB = num(flip ? m.w_ace : m.l_ace);
      const tail = who => M.acesTail(dist, f.serveA, f.serveB, f.aces.a, f.aces.b, who, P);
      const ta = tail('a'), tb = tail('b'), tt = tail('both');
      for (const k of bo === 5 ? [5, 10, 15, 20] : [3, 5, 8, 10, 15]) { r.acesP.add(ta[k], acA >= k ? 1 : 0); r.acesP.add(tb[k], acB >= k ? 1 : 0); }
      for (const k of bo === 5 ? [15, 20, 25, 30, 40] : [6, 8, 12, 16, 20, 25]) r.acesT.add(tt[k], acA + acB >= k ? 1 : 0);
      sumA += acA + acB; sumAm += [ta, tb].reduce((t, x) => t + x.slice(1).reduce((s, v) => s + v, 0), 0); nA++;
    }
  }, P);
  r.meanTotal = nT ? { real: sumT / nT, model: sumTm / nT } : null;
  r.meanAces = nA ? { real: sumA / nA, model: sumAm / nA } : null;
  return r;
}

// Regresión logística con los dos logits: qué pesos dan mejores probabilidades
function fit(xs) {
  let a = 1, b = 0, c = 0;
  for (let it = 0; it < 300; it++) {
    let ga = 0, gb = 0, gc = 0;
    for (const x of xs) {
      const p = M.sigmoid(a * x.le + b * x.ls + c), e = x.y - p;
      ga += e * x.le; gb += e * x.ls; gc += e;
    }
    const lr = 0.8 / xs.length;
    a += lr * ga; b += lr * gb; c += lr * gc;
  }
  return { wElo: +a.toFixed(3), wStats: +b.toFixed(3), intercept: +c.toFixed(3) };
}

if (require.main === module) {
  const [dir, tour = 'atp', from = '20250101'] = process.argv.slice(2);
  if (!dir) { console.error('Falta la carpeta con los CSV'); process.exit(1); }
  const rows = load(dir, tour);
  console.log(`${tour.toUpperCase()}: ${rows.length} partidos en los CSV, se predice desde ${from}`);
  const train = run(rows, '20240101', {}, { fast: true }, '20241231'); // sólo datos anteriores a lo que se va a evaluar
  const part = train.xs;
  console.log('Pesos ajustados con 2024:', fit(part));
  const r = run(rows, from, M.paramsOf(tour));
  for (const k of ['rank', 'elo', 'stats', 'model', 'fives']) console.log(r[k].summary());
  console.log('\nModelo (predicho → real):\n' + r.model.table());
  for (const k of ['total', 'hcap', 'straight', 'anySet', 'tb', 'set1', 'playerG', 'bagel', 'odd', 'acesP', 'acesT']) console.log(`\n${r[k].summary()}\n${r[k].table()}`);
  if (r.meanTotal) console.log(`\nJuegos por partido: real ${r.meanTotal.real.toFixed(2)}, modelo ${r.meanTotal.model.toFixed(2)}`);
  if (r.meanAces) console.log(`Aces por partido: real ${r.meanAces.real.toFixed(2)}, modelo ${r.meanAces.model.toFixed(2)}`);
}

module.exports = { run, load, fit, Calib };
