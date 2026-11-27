'use strict';
// Comprueba el modelo de córneres y tarjetas del partido (totals.js) con los partidos de la temporada de las ligas de hombres y la
// A-League: cada partido se calcula sólo con los anteriores de su liga (cada equipo con MIN_GAMES o más). Se eligen K y R con la
// primera mitad (por fecha) y se miden en la segunda, frente a no saber nada de los equipos (la media de la liga). Trae de ESPN los
// resúmenes que falten (season.js los guarda para siempre).
// Con «prev», además la temporada anterior entera: se ajusta con ella y se prueba con la actual (lo correcto; sin ella, la actual a mitades).
//   docker compose exec football node services/football/backtest-totales.js [prev]
const H = require('./history');
const S = require('./season');
const T = require('./totals');

const LEAGUES = [...H.POOLS.men, ...H.POOLS.aus].filter(l => l !== 'esp.copa_del_rey');
const LINES = { corners: [7.5, 8.5, 9.5, 10.5, 11.5], cards: [2.5, 3.5, 4.5, 5.5, 6.5] };
const GRID = { k: [0, 2, 4, 6, 10, 20, 1e9], r: [5, 10, 25, 50, Infinity] };
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const ll = (p, y) => -Math.log(clamp(y ? p : 1 - p, 1e-6, 1));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const PREV = process.argv.includes('prev');
// La temporada anterior: los partidos de los 12 meses antes del inicio de la actual (del histórico de resultados)
async function previousGames(lg) {
  const { games } = await S.gamesOf(lg);
  const start = games.map(g => g.date).sort()[0];
  if (!start) return [];
  const from = new Date(start); from.setUTCMonth(from.getUTCMonth() - 12);
  const months = H.monthsBack(13, new Date(start));
  const rows = (await Promise.all(months.map(ym => H.month(lg, ym, false).catch(() => [])))).flat();
  const seen = new Set();
  return rows.filter(g => g.date < start && g.date >= from.toISOString() && !seen.has(g.id) && seen.add(g.id));
}

(async () => {
  const all = [];
  for (const lg of LEAGUES) {
    const cur = (await S.gamesOf(lg)).games.map(g => ({ ...g, season: 'cur' }));
    const games = PREV ? [...(await previousGames(lg)).map(g => ({ ...g, season: 'prev' })), ...cur] : cur;
    const have = await S.cached(lg, games.map(g => g.id));
    const missing = games.filter(g => !have.has(g.id));
    for (let i = 0; i < missing.length; i += 3) {
      await Promise.all(missing.slice(i, i + 3).map(g => S.fetchMatch(lg, g.id).then(v => have.set(g.id, v)).catch(() => {})));
      await sleep(300);
    }
    for (const g of games) if (have.get(g.id)?.t?.length === 2) all.push({ lg, date: g.date, season: g.season, ...have.get(g.id) });
    console.log(`${lg}: ${games.length} partidos (${missing.length} traídos ahora)`);
  }
  all.sort((a, b) => a.date.localeCompare(b.date));
  const cut = PREV ? all.find(m => m.season === 'cur').date : all[Math.floor(all.length / 2)].date;
  console.log(`\n${all.length} partidos; ajuste antes de ${cut.slice(0, 10)}, prueba desde entonces\n`);

  for (const stat of ['corners', 'cards']) {
    // Cada partido con lo esperado según K (los anteriores de su liga)
    const cases = [];
    const byLg = new Map();
    for (const m of all) {
      // Los equipos se cuentan dentro de su temporada: la plantilla y el entrenador cambian en verano
      const key = `${m.lg}|${m.season}`;
      const prev = byLg.get(key) || [];
      const rates = T.ratesOf(prev, stat);
      const ok = rates.teams.get(m.t[0][0])?.n >= T.MIN_GAMES && rates.teams.get(m.t[1][0])?.n >= T.MIN_GAMES;
      if (ok) {
        const y = T.STATS[stat](m.t[0]) + T.STATS[stat](m.t[1]);
        cases.push({ test: m.date >= cut, y, mus: Object.fromEntries(GRID.k.map(k => [k, T.expected(rates, m.t[0][0], m.t[1][0], { k }).mu])) });
      }
      prev.push(m); byLg.set(key, prev);
    }
    const score = (list, k, r) => {
      let s = 0, n = 0;
      for (const c of list) for (const L of LINES[stat]) { s += ll(T.overUnder(c.mus[k], r, L).over, c.y > L); n++; }
      return s / n;
    };
    const fit = cases.filter(c => !c.test), test = cases.filter(c => c.test);
    let best = null;
    for (const k of GRID.k) for (const r of GRID.r) { const v = score(fit, k, r); if (!best || v < best.v) best = { k, r, v }; }
    const base = Math.min(...GRID.r.map(r => score(fit, 1e9, r)));
    const baseR = GRID.r.find(r => score(fit, 1e9, r) === base);
    console.log(`${stat}: ${fit.length} de ajuste, ${test.length} de prueba`);
    console.log(`  ajuste: mejor K=${best.k} R=${best.r} → ${best.v.toFixed(4)} (media de la liga, R=${baseR}: ${base.toFixed(4)})`);
    console.log(`  prueba: modelo ${score(test, best.k, best.r).toFixed(4)} · media de la liga ${score(test, 1e9, baseR).toFixed(4)}`);
    console.log('  prueba con cada K y R (para ver lo estable que es):', GRID.k.map(k => `K=${k > 1e8 ? '∞' : k}: ` + GRID.r.map(r => score(test, k, r).toFixed(4)).join('/')).join(' · '));
    // Calibración en la prueba: lo que decía frente a lo que pasó, por línea
    for (const L of LINES[stat]) {
      const said = test.reduce((s, c) => s + T.overUnder(c.mus[best.k], best.r, L).over, 0) / test.length;
      const was = test.filter(c => c.y > L).length / test.length;
      console.log(`    más de ${L}: decía ${(said * 100).toFixed(1)} %, fue ${(was * 100).toFixed(1)} %`);
    }
    const sd = arr => Math.sqrt(arr.reduce((s, v) => s + v * v, 0) / arr.length - (arr.reduce((s, v) => s + v, 0) / arr.length) ** 2);
    console.log(`  media real ${(test.reduce((s, c) => s + c.y, 0) / test.length).toFixed(2)}, desviación ${sd(test.map(c => c.y)).toFixed(2)}`);
  }
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
