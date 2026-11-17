'use strict';
// ¿El cansancio mueve el resultado más allá de lo que ya dice el modelo? Para cada partido se mira cuánto había jugado cada uno
// (minutos de sus rondas anteriores en el mismo torneo, y de los partidos del torneo anterior, de menos de 14 días antes) y se compara
// lo que pasó con lo que el modelo daba al primero (orden alfabético, como en backtest.js). Residuo medio = reales − esperadas; si el
// cansancio importara, saldría negativo para el que más ha jugado. No es parte del servicio: se lanza a mano dentro del contenedor.
//   docker compose exec tennis node services/tennis/backtest-contexto.js [atp|wta] [desde AAAAMMDD]
const T = require('./tml');
const M = require('./model');

const { num, norm } = M;
const [tour = 'atp', from = '20240601'] = process.argv.slice(2);
const dayOf = d => { const s = String(d); return Date.UTC(+s.slice(0, 4), +s.slice(4, 6) - 1, +s.slice(6, 8)) / 864e5; };
const BINS = [['−3 h o menos', d => d <= -3], ['−3 a −1,5', d => d > -3 && d <= -1.5], ['−1,5 a −0,5', d => d > -1.5 && d <= -0.5], ['−0,5 a 0,5', d => d > -0.5 && d < 0.5],
  ['0,5 a 1,5', d => d >= 0.5 && d < 1.5], ['1,5 a 3', d => d >= 1.5 && d < 3], ['3 h o más', d => d >= 3]];

function measure(rows, P, a, b) {
  const hist = new Map(); // jugador → [{ tid, day, min }]
  const out = { cur: BINS.map(() => ({ n: 0, r: 0, r2: 0 })), prev: BINS.map(() => ({ n: 0, r: 0, r2: 0 })), rec: [] };
  M.replay(rows, (m, w, l, s, day, avg) => {
    const get = n => { const k = norm(n); if (!hist.has(k)) hist.set(k, []); return hist.get(k); };
    const hw = get(m.winner_name), hl = get(m.loser_name);
    const load = h => {
      let cur = 0, prev = 0;
      for (const x of h) { if (x.tid === m.tourney_id) cur += x.min; else if (day - x.day > 0 && day - x.day < 14) prev += x.min; }
      return [cur / 60, prev / 60];
    };
    const d = String(m.tourney_date);
    if (d >= a && d < b && M.finishedClean(m) && (w.n >= 5 || l.n >= 5)) {
      const bo = num(m.best_of) === 5 ? 5 : 3;
      const flip = norm(m.winner_name) > norm(m.loser_name);
      const [pa, pb] = flip ? [l, w] : [w, l], y = flip ? 0 : 1;
      const f = M.predict(pa, pb, s, day, avg, bo, P);
      const [la, lb] = flip ? [load(hl), load(hw)] : [load(hw), load(hl)];
      const res = y - f.pModel;
      out.rec.push({ lp: M.logit(M.clamp(f.pModel, 0.01, 0.99)), y, x: Math.max(-1.5, Math.min(1.5, (la[1] - lb[1]) / 3)) });
      for (const [k, i] of [['cur', 0], ['prev', 1]]) {
        const diff = la[i] - lb[i];
        const bi = BINS.findIndex(([, fn]) => fn(diff));
        if (bi >= 0) { const c = out[k][bi]; c.n++; c.r += res; c.r2 += res * res; }
      }
    }
    const min = num(m.minutes);
    if (min > 0 && min < 500) { hw.push({ tid: m.tourney_id, day, min }); hl.push({ tid: m.tourney_id, day, min }); }
  }, P);
  return out;
}

function report(label, r) {
  console.log(`\n${label}`);
  for (const [k, what] of [['cur', 'minutos ya jugados en este torneo (primero − segundo, en horas)'], ['prev', 'minutos del torneo anterior, de menos de 14 días (primero − segundo, en horas)']]) {
    console.log(`  ${what}\n  diferencia → residuo medio del primero (reales − esperadas) ± error · partidos`);
    BINS.forEach(([name], i) => {
      const c = r[k][i]; if (c.n < 30) return;
      const mean = c.r / c.n, sd = Math.sqrt(Math.max(0, c.r2 / c.n - mean * mean)) / Math.sqrt(c.n);
      console.log(`    ${name.padEnd(13)} ${(mean >= 0 ? '+' : '') + (100 * mean).toFixed(1).padStart(5)} % ± ${(100 * sd).toFixed(1)}   (${c.n})`);
    });
  }
}

// ¿Sumar β·x al logit del modelo mejora las probabilidades? β se ajusta con un periodo y se comprueba con el otro
const ll = (rec, b) => rec.reduce((t, r) => { const p = M.sigmoid(r.lp + b * r.x); return t - (r.y ? Math.log(p) : Math.log(1 - p)); }, 0) / rec.length;
function fitBeta(rec) {
  let b = 0;
  for (let it = 0; it < 30; it++) {
    let g = 0, h = 0;
    for (const r of rec) { const p = M.sigmoid(r.lp + b * r.x); g += (r.y - p) * r.x; h += p * (1 - p) * r.x * r.x; }
    b += g / Math.max(h, 1e-9);
  }
  return b;
}

(async () => {
  const { rows } = await T.dataset(tour);
  console.log(`${tour.toUpperCase()}: ${rows.length} partidos`);
  const P = M.paramsOf(tour);
  const last = rows.reduce((mx, m) => (String(m.tourney_date) > mx ? String(m.tourney_date) : mx), '0');
  const mid = (() => { const x = (dayOf(from) + dayOf(last)) / 2, dt = new Date(x * 864e5); return `${dt.getUTCFullYear()}${String(dt.getUTCMonth() + 1).padStart(2, '0')}${String(dt.getUTCDate()).padStart(2, '0')}`; })();
  const r1 = measure(rows, P, from, mid), r2 = measure(rows, P, mid, '99999999');
  report(`Primera mitad (${from} a ${mid})`, r1);
  report(`Segunda mitad (${mid} en adelante)`, r2);
  const b1 = fitBeta(r1.rec), b2 = fitBeta(r2.rec);
  console.log(`
Peso de la actividad reciente (x = diferencia de horas del torneo anterior / 3, entre −1,5 y 1,5) en el logit:`);
  console.log(`  ajustado con la 1.ª mitad: β = ${b1.toFixed(3)} → log-loss de la 2.ª ${ll(r2.rec, 0).toFixed(4)} → ${ll(r2.rec, b1).toFixed(4)}`);
  console.log(`  ajustado con la 2.ª mitad: β = ${b2.toFixed(3)} → log-loss de la 1.ª ${ll(r1.rec, 0).toFixed(4)} → ${ll(r1.rec, b2).toFixed(4)}`);
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
