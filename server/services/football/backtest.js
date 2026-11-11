'use strict';
// Comprobación del modelo de goles con partidos pasados: cada semana se ajusta sólo con lo que se sabía ese día y se predicen
// los partidos de esa semana. No es parte del servicio: se lanza a mano dentro del contenedor y no guarda nada en el repo.
//   docker compose exec football node services/football/backtest.js [men|women|national] [desde AAAA-MM-DD] [hasta AAAA-MM-DD] [rejilla]
// Con "rejilla" prueba varias combinaciones de parámetros (ajústalas con un periodo y compruébalas con otro).
// No hay cuotas históricas gratuitas: dice si las probabilidades son correctas, no si se gana dinero.
const H = require('./history');
const M = require('./model');

const [pool = 'men', from = '2025-08-01', to = new Date().toISOString().slice(0, 10), mode] = process.argv.slice(2);

const ll = p => -Math.log(Math.max(1e-9, p));
function evaluate(rows, params) {
  const start = +new Date(from), end = +new Date(to);
  const s = { n: 0, ll: 0, llBase: 0, brier: 0, ou: 0, btts: 0, goals: 0, goalsPred: 0, draws: 0, drawsPred: 0, cal: {}, calOu: {} };
  // Base: las frecuencias de 1, X y 2 de lo anterior (lo que diría alguien sin mirar los equipos)
  for (let t = start; t < end; t += 7 * 864e5) {
    const st = M.fit(rows, { ...params, asOf: t });
    const before = rows.filter(r => +new Date(r.date) < t).slice(-3000);
    const base = { h: 0, d: 0, a: 0 };
    for (const r of before) base[r.hg > r.ag ? 'h' : r.hg < r.ag ? 'a' : 'd']++;
    const nb = before.length || 1;
    for (const r of rows) {
      const tt = +new Date(r.date);
      if (tt < t || tt >= Math.min(t + 7 * 864e5, end)) continue;
      const e = M.expected(st, r.h, r.a, r.lg, !!r.n);
      // Los dos con algún partido: un equipo recién llegado no dice nada del modelo
      if (e.games.h < 3 || e.games.a < 3) continue;
      const P = M.grid(e.lh, e.la, params.rho);
      const x = M.oneXtwo(P);
      const res = r.hg > r.ag ? 'h' : r.hg < r.ag ? 'a' : 'd';
      s.n++;
      s.ll += ll(x[res]); s.llBase += ll(base[res] / nb);
      s.brier += ['h', 'd', 'a'].reduce((q, k) => q + (x[k] - (k === res ? 1 : 0)) ** 2, 0);
      const pOver = M.prob(P, (i, j) => i + j > 2.5), over = r.hg + r.ag > 2.5;
      s.ou += ll(over ? pOver : 1 - pOver);
      const pB = M.prob(P, (i, j) => i > 0 && j > 0);
      s.btts += ll(r.hg > 0 && r.ag > 0 ? pB : 1 - pB);
      s.goals += r.hg + r.ag; s.goalsPred += e.lh + e.la; s.draws += res === 'd'; s.drawsPred += x.d;
      const bin = Math.min(9, Math.floor(x.h * 10));
      (s.cal[bin] ||= { n: 0, p: 0, hit: 0 }); s.cal[bin].n++; s.cal[bin].p += x.h; s.cal[bin].hit += res === 'h';
      const bo = Math.min(9, Math.floor(pOver * 10));
      (s.calOu[bo] ||= { n: 0, p: 0, hit: 0 }); s.calOu[bo].n++; s.calOu[bo].p += pOver; s.calOu[bo].hit += over;
    }
  }
  return s;
}

const f3 = v => v.toFixed(4);
function report(s, label) {
  console.log(`\n${label}: ${s.n} partidos`);
  console.log(`  1X2  log-loss ${f3(s.ll / s.n)} (sin mirar equipos ${f3(s.llBase / s.n)})  Brier ${f3(s.brier / s.n)}`);
  console.log(`  más/menos 2,5  log-loss ${f3(s.ou / s.n)} (al azar 0.6931)   ambos marcan ${f3(s.btts / s.n)}`);
  console.log(`  goles por partido: reales ${(s.goals / s.n).toFixed(2)}, esperados ${(s.goalsPred / s.n).toFixed(2)};  empates: reales ${(100 * s.draws / s.n).toFixed(1)} %, esperados ${(100 * s.drawsPred / s.n).toFixed(1)} %`);
  const table = (cal, what) => {
    console.log(`  calibración (${what}): prob. media → se cumplió`);
    for (const [, c] of Object.entries(cal).sort((a, b) => a[0] - b[0])) if (c.n >= 20) console.log(`    ${(100 * c.p / c.n).toFixed(0).padStart(3)} % → ${(100 * c.hit / c.n).toFixed(0).padStart(3)} %  (${c.n})`);
  };
  table(s.cal, 'gana el local'); table(s.calOu, 'más de 2,5');
}

(async () => {
  const rows = await H.results(pool, 30);
  console.log(`${rows.length} partidos de ${pool} desde ${rows[0]?.date.slice(0, 10)}; se evalúa de ${from} a ${to}`);
  if (mode === 'rejilla') {
    const out = [];
    for (const halfLife of [150, 300, 500]) for (const reg of [3, 8, 15]) {
      for (const rho of [-0.06]) {
        const s = evaluate(rows, { halfLife, reg, rho });
        out.push({ halfLife, reg, rho, ll: s.ll / s.n, ou: s.ou / s.n, n: s.n });
        console.log(`halfLife ${halfLife} reg ${reg} rho ${rho}: 1X2 ${f3(s.ll / s.n)}  2,5 ${f3(s.ou / s.n)}  (${s.n})`);
      }
    }
    out.sort((a, b) => a.ll - b.ll);
    console.log('\nMejor:', out[0]);
  } else {
    report(evaluate(rows, M.PARAMS[pool]), `Parámetros de model.js (${JSON.stringify(M.PARAMS[pool])})`);
  }
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
