'use strict';
// Comprueba los mercados de jugador que salen de la ficha de ESPN (remates, remates a puerta, paradas, faltas cometidas y recibidas, "N o
// más") con partidos pasados de una liga: para cada partido, con lo que se sabía antes (los últimos 10 partidos del equipo), da a cada
// jugador de su plantilla reciente la probabilidad de llegar a N, y se compara con lo que hizo (quien no juega cuenta 0). Prueba el peso
// del punto de partida de cada posición y cuánto debe moverse el ritmo con los goles que se esperan del partido (potencia gamma). Los
// ritmos de cada posición se miden con los mismos partidos (son 5 cifras por posición, con miles de minutos: el sesgo es mínimo).
//   docker compose exec football node services/football/backtest-jugador.js [liga ESPN, esp.1] [desde AAAA-MM-DD] [hasta AAAA-MM-DD]
const H = require('./history');
const M = require('./model');
const S = require('./scorers');

const [lgArg = 'esp.1', from = '2026-01-01', to = new Date().toISOString().slice(0, 10)] = process.argv.slice(2);
const SEASON_FROM = '2025-08-01';
const THRESHOLDS = { shots: [1, 2, 3, 4, 5], sot: [1, 2, 3], saves: [1, 2, 3, 4], fouls: [1, 2, 3], suffered: [1, 2, 3] };
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const ll = (p, y) => -(y ? Math.log(clamp(p, 1e-6, 1 - 1e-6)) : Math.log(clamp(1 - p, 1e-6, 1 - 1e-6)));

async function pool(items, n, fn) {
  let i = 0;
  await Promise.all(Array.from({ length: n }, async () => { for (;;) { const k = i++; if (k >= items.length) return; await fn(items[k]); } }));
}

(async () => {
  const all = await H.results('men', 30);
  const rows = all.filter(r => r.lg === lgArg && r.date.slice(0, 10) >= SEASON_FROM).sort((x, y) => +new Date(y.date) - +new Date(x.date));
  console.log(`${rows.length} partidos de ${lgArg}; se evalúa de ${from} a ${to}`);
  await pool(rows, 6, r => S.matchPlayers(r));

  // Ritmos por 90 de cada posición y estadística
  const tot = {};
  for (const r of rows) for (const team of Object.values((await S.matchPlayers(r)) || {})) for (const p of team) for (const k of Object.keys(S.COUNT_STATS)) {
    const t = ((tot[k] ||= {})[p.pos] ||= { v: 0, min: 0 }); t.v += p.stats[k]; t.min += p.min;
  }
  const prior = Object.fromEntries(Object.keys(S.COUNT_STATS).map(k => [k, Object.fromEntries(Object.entries(tot[k]).map(([pos, t]) => [pos, (90 * t.v) / t.min]))]));
  console.log('Ritmo por 90 según la posición (F delantero, M medio, D defensa, G portero):');
  for (const k of Object.keys(prior)) console.log(`  ${k.padEnd(9)}`, Object.entries(prior[k]).map(([p, v]) => `${p} ${v.toFixed(3)}`).join('  '));

  const models = new Map();
  const fitFor = t => { const w = Math.floor(t / (7 * 864e5)); if (!models.has(w)) models.set(w, M.fit(all, { ...M.PARAMS.men, asOf: w * 7 * 864e5 })); return models.get(w); };
  const items = [];
  for (const r of rows) {
    const d = r.date.slice(0, 10);
    if (d < from || d >= to) continue;
    const actual = await S.matchPlayers(r);
    if (!actual) continue;
    const e = M.expected(fitFor(+new Date(r.date)), r.h, r.a, r.lg, !!r.n);
    for (const [team, lam, lamOpp] of [[r.h, e.lh, e.la], [r.a, e.la, e.lh]]) {
      const prev = rows.filter(x => (x.h === team || x.a === team) && +new Date(x.date) < +new Date(r.date));
      const recent = await S.teamRecent(team, prev);
      if (recent.n < S.MIN_MATCHES) continue;
      const win = prev.slice(0, S.WINDOW);
      const gf = win.reduce((t, x) => t + (x.h === team ? x.hg : x.ag), 0) / win.length, ga = win.reduce((t, x) => t + (x.h === team ? x.ag : x.hg), 0) / win.length;
      items.push({ recent, rf: lam / Math.max(0.3, gf), ra: lamOpp / Math.max(0.3, ga), got: new Map((actual[team] || []).map(x => [x.key, x.stats])), t: +new Date(r.date) });
    }
  }
  items.sort((x, y) => x.t - y.t);
  const mid = items[Math.floor(items.length / 2)].t, first = items.filter(x => x.t < mid), second = items.filter(x => x.t >= mid);
  console.log(`${items.length} equipos-partido`);

  const score = (list, stat, prior90s, gamma) => {
    const a = { n: 0, ll: 0, p: 0, y: 0 };
    for (const it of list) {
      const scale = stat === 'saves' ? it.ra ** gamma : stat === 'fouls' || stat === 'suffered' ? 1 : it.rf ** gamma;
      const m = S.countModel(it.recent, stat, prior[stat], { scale, prior90s });
      for (const [key, pl] of m) {
        if (stat === 'saves' && pl.pos !== 'G') continue;
        const real = it.got.get(key)?.[stat] || 0;
        for (const n of THRESHOLDS[stat]) { const p = pl.atLeast(n), y = real >= n ? 1 : 0; a.n++; a.ll += ll(p, y); a.p += p; a.y += y; }
      }
    }
    return a;
  };
  for (const stat of Object.keys(THRESHOLDS)) {
    console.log(`\n${stat}: log-loss (1.ª mitad / 2.ª mitad) según peso del punto de partida y gamma; prob. media y real en la 2.ª`);
    const res = [];
    for (const k of [1, 3, 8, 30, 1000]) for (const g of [0]) {
      const a = score(first, stat, k, g), b = score(second, stat, k, g);
      res.push({ k, g, a: a.ll / a.n, b: b.ll / b.n, p: b.p / b.n, y: b.y / b.n });
    }
    res.sort((x, y) => x.a - y.a);
    for (const r of res.slice(0, 5)) console.log(`  K ${String(r.k).padStart(2)} gamma ${r.g}: ${r.a.toFixed(4)} / ${r.b.toFixed(4)}   (${(100 * r.p).toFixed(1)} % frente a ${(100 * r.y).toFixed(1)} %)`);
  }
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
