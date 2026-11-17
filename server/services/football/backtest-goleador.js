'use strict';
// Comprueba el modelo del goleador (scorers.js) con partidos pasados de una liga: para cada partido, con sólo lo que se sabía antes
// (los últimos partidos del equipo y los goles esperados del modelo de goles ajustado esa semana), da a cada jugador de su plantilla
// reciente la probabilidad de marcar y se compara con quién marcó de verdad. Los que no juegan cuentan como que no marcan, igual que
// una cuota previa a las alineaciones. No guarda nada: se lanza a mano dentro del contenedor y baja una ficha de ESPN por partido
// (se guardan en football.cache, así que la segunda vez no pide nada).
//   docker compose exec football node services/football/backtest-goleador.js [liga ESPN, esp.1] [desde AAAA-MM-DD] [hasta AAAA-MM-DD]
const H = require('./history');
const M = require('./model');
const S = require('./scorers');

const [lgArg = 'esp.1', from = '2026-01-01', to = new Date().toISOString().slice(0, 10)] = process.argv.slice(2);
const SEASON_FROM = '2025-08-01';

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const ll = (p, y) => -(y ? Math.log(clamp(p, 1e-6, 1 - 1e-6)) : Math.log(clamp(1 - p, 1e-6, 1 - 1e-6)));

async function pool(items, n, fn) {
  let i = 0, done = 0;
  await Promise.all(Array.from({ length: n }, async () => {
    for (;;) { const k = i++; if (k >= items.length) return; await fn(items[k]); if (++done % 50 === 0) console.log(`  ${done}/${items.length} fichas`); }
  }));
}

(async () => {
  const all = await H.results('men', 30);
  const rows = all.filter(r => r.lg === lgArg && r.date.slice(0, 10) >= SEASON_FROM).sort((x, y) => +new Date(y.date) - +new Date(x.date)); // más reciente primero
  console.log(`${rows.length} partidos de ${lgArg} desde ${SEASON_FROM}; se evalúa de ${from} a ${to}`);
  console.log('Bajando las fichas…');
  await pool(rows, 6, r => S.matchPlayers(r));

  const models = new Map(); // semana → modelo de goles
  const fitFor = t => { const w = Math.floor(t / (7 * 864e5)); if (!models.has(w)) models.set(w, M.fit(all, { ...M.PARAMS.men, asOf: w * 7 * 864e5 })); return models.get(w); };
  let matches = 0;
  const items = []; // { recent, lambda, scored, half }
  for (const r of rows) {
    const d = r.date.slice(0, 10);
    if (d < from || d >= to) continue;
    const actual = await S.matchPlayers(r);
    if (!actual) continue;
    const st = fitFor(+new Date(r.date));
    const e = M.expected(st, r.h, r.a, r.lg, !!r.n);
    matches++;
    for (const [team, lambda] of [[r.h, e.lh], [r.a, e.la]]) {
      const prior = rows.filter(x => (x.h === team || x.a === team) && +new Date(x.date) < +new Date(r.date)); // ya más reciente primero
      const recent = await S.teamRecent(team, prior);
      if (S.scorerProbs(recent, lambda)) items.push({ recent, lambda, scored: new Map((actual[team] || []).map(x => [x.key, x.goals])), t: +new Date(r.date) });
    }
  }
  items.sort((x, y) => x.t - y.t);
  const mid = items[Math.floor(items.length / 2)].t;
  const score = (list, prior) => {
    const a = { n: 0, ll: 0, p: 0, y: 0 };
    for (const it of list) for (const [key, pl] of S.scorerProbs(it.recent, it.lambda, prior)) {
      const y = (it.scored.get(key) || 0) >= 1 ? 1 : 0;
      a.n++; a.ll += ll(pl.p, y); a.p += pl.p; a.y += y;
    }
    return a;
  };
  const first = items.filter(x => x.t < mid), second = items.filter(x => x.t >= mid);
  console.log(`
${matches} partidos; peso del punto de partida (en "90" de la posición) → log-loss de cada mitad`);
  for (const prior of [1, 3, 6, 10, 15, 25, 40]) {
    const a = score(first, prior), b = score(second, prior);
    console.log(`  ${String(prior).padStart(3)}  1.ª ${(a.ll / a.n).toFixed(4)}  2.ª ${(b.ll / b.n).toFixed(4)}   (prob. media ${(b.p / b.n).toFixed(4)}, marcaron ${(b.y / b.n).toFixed(4)})`);
  }
  const want = Number(process.env.PRIOR) || S.PRIOR_90S;
  const acc = { n: 0, full: 0, raw: 0, y: 0, p: 0, pr: 0 }, cal = {}, calReg = {};
  const add = (bins, p, y) => { const b = Math.min(9, Math.floor(p * 20)); (bins[b] ||= { n: 0, p: 0, y: 0 }); bins[b].n++; bins[b].p += p; bins[b].y += y; };
  for (const it of second) for (const [key, pl] of S.scorerProbs(it.recent, it.lambda, want)) {
    const y = (it.scored.get(key) || 0) >= 1 ? 1 : 0;
    acc.n++; acc.full += ll(pl.p, y); acc.raw += ll(1 - Math.exp(-pl.raw), y); acc.y += y; acc.p += pl.p; acc.pr += 1 - Math.exp(-pl.raw);
    add(cal, pl.p, y); if (pl.minutes >= 30) add(calReg, pl.p, y);
  }
  console.log(`
Segunda mitad con peso ${want}: ${acc.n} jugadores-partido`);
  const f4 = v => v.toFixed(4);
  console.log(`\n${matches} partidos, ${acc.n} jugadores-partido`);
  console.log(`log-loss del modelo: ${f4(acc.full / acc.n)}  ·  sin ajustar a los goles esperados del partido: ${f4(acc.raw / acc.n)}`);
  console.log(`probabilidad media de marcar: modelo ${(acc.p / acc.n).toFixed(4)}, sin ajustar ${(acc.pr / acc.n).toFixed(4)}; marcaron ${(acc.y / acc.n).toFixed(4)}`);
  const table = (bins, what) => {
    console.log(`\ncalibración (${what}): prob. media → marcó`);
    for (const [, b] of Object.entries(bins).sort((x, y) => x[0] - y[0])) if (b.n >= 25) console.log(`  ${(100 * b.p / b.n).toFixed(1).padStart(5)} % → ${(100 * b.y / b.n).toFixed(1).padStart(5)} %  (${b.n})`);
  };
  table(cal, 'todos'); table(calReg, 'los que juegan 30 minutos o más de media');
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
