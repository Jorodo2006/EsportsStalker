'use strict';
// ¿Los días de descanso mueven los goles más allá de lo que ya dice el modelo? Cada semana se ajusta el modelo con lo que se sabía y,
// para cada equipo de los partidos de esa semana, se compara lo que marcó y encajó con lo que esperaba el modelo, según los días que
// llevaba sin jugar (los de su último partido en cualquiera de las competiciones del grupo). Cociente reales/esperados: 1 = el
// descanso no cambia nada. No es parte del servicio: se lanza a mano dentro del contenedor.
//   docker compose exec football node services/football/backtest-contexto.js [men|women|national] [desde] [hasta]
const H = require('./history');
const M = require('./model');

const [pool = 'men', from = '2025-08-01', to = new Date().toISOString().slice(0, 10)] = process.argv.slice(2);
const BINS = [['≤3 días', d => d <= 3], ['4-5 días', d => d >= 4 && d <= 5], ['6-7 días', d => d >= 6 && d <= 7], ['8 o más', d => d >= 8]];

function run(rows, a, b) {
  const start = +new Date(a), end = +new Date(b);
  const last = new Map(); // equipo → fecha de su último partido, a medida que se avanza
  const sorted = rows.slice().sort((x, y) => +new Date(x.date) - +new Date(y.date));
  const restAt = new Map(); // id del partido → [descanso local, descanso visitante] (días; null si no se sabe)
  for (const r of sorted) {
    const t = +new Date(r.date);
    const rest = team => (last.has(team) ? (t - last.get(team)) / 864e5 : null);
    restAt.set(r.id, [rest(r.h), rest(r.a)]);
    last.set(r.h, t); last.set(r.a, t);
  }
  const acc = BINS.map(() => ({ n: 0, gf: 0, ef: 0, ga: 0, ea: 0 }));
  const diff = { rested: { n: 0, d: 0, e: 0 }, tired: { n: 0, d: 0, e: 0 } }; // diferencia de goles (local − visitante)
  for (let t = start; t < end; t += 7 * 864e5) {
    const st = M.fit(rows, { ...M.PARAMS[pool], asOf: t });
    for (const r of rows) {
      const tt = +new Date(r.date);
      if (tt < t || tt >= Math.min(t + 7 * 864e5, end)) continue;
      const e = M.expected(st, r.h, r.a, r.lg, !!r.n);
      if (e.games.h < 3 || e.games.a < 3) continue;
      const [rh, ra] = restAt.get(r.id) || [];
      for (const [side, rest, gf, ga, ef, ea] of [['h', rh, r.hg, r.ag, e.lh, e.la], ['a', ra, r.ag, r.hg, e.la, e.lh]]) {
        if (rest == null || rest > 30) continue;
        const i = BINS.findIndex(([, f]) => f(rest));
        if (i < 0) continue;
        const c = acc[i]; c.n++; c.gf += gf; c.ef += ef; c.ga += ga; c.ea += ea;
      }
      // Uno con mucho más descanso que el otro (3 días o más de diferencia)
      if (rh != null && ra != null && rh <= 30 && ra <= 30 && Math.abs(rh - ra) >= 3) {
        const k = rh > ra ? 'rested' : 'tired';
        diff[k].n++; diff[k].d += r.hg - r.ag; diff[k].e += e.lh - e.la;
      }
    }
  }
  return { acc, diff };
}

const f2 = v => v.toFixed(2);
function report(label, { acc, diff }) {
  console.log(`\n${label}`);
  console.log('  descanso del equipo → goles marcados reales/esperados · encajados reales/esperados (equipos-partido)');
  BINS.forEach(([name], i) => { const c = acc[i]; if (c.n) console.log(`    ${name.padEnd(9)} ${f2(c.gf / c.ef)} · ${f2(c.ga / c.ea)}   (${c.n})`); });
  const d = diff;
  console.log(`  con 3+ días más de descanso el local: diferencia de goles real ${f2(d.rested.d / d.rested.n)} vs esperada ${f2(d.rested.e / d.rested.n)} (${d.rested.n})`);
  console.log(`  con 3+ días menos de descanso el local: real ${f2(d.tired.d / d.tired.n)} vs esperada ${f2(d.tired.e / d.tired.n)} (${d.tired.n})`);
}

(async () => {
  const rows = await H.results(pool, 30);
  console.log(`${rows.length} partidos de ${pool}`);
  const mid = new Date((+new Date(from) + +new Date(to)) / 2).toISOString().slice(0, 10);
  report(`Primera mitad (${from} a ${mid})`, run(rows, from, mid));
  report(`Segunda mitad (${mid} a ${to})`, run(rows, mid, to));
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
