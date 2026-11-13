'use strict';
// Mide el modelo de MMA con combates pasados: recorre el historial por fecha y predice cada combate sólo con lo que se sabía
// antes. Se ajusta con un periodo y se comprueba con otro (no se miran los mismos combates). Salida: Brier, log-loss, acierto
// y tabla de calibración. Se ejecuta dentro del contenedor:  docker compose exec mma node services/mma/backtest.js
// No usa el récord del marcador de ESPN (no se sabe si es de antes o de después del combate): sólo el Elo, la edad y la inactividad.
const H = require('./history');
const M = require('./model');

const FIT_TO = '2024-07-01'; // ajuste: 2019-01 a 2024-06 · comprobación: 2024-07 en adelante
const WARM = '2019-01-01'; // los tres primeros años sólo calientan el Elo: no se puntúan

function run(P, fights, from, to, minFights = 0) {
  const r = new Map();
  const out = [];
  for (const f of fights) {
    if (!M.counts(f)) continue;
    const a = r.get(f.a.id) || { elo: 1500, fights: 0, lastDate: '' }, b = r.get(f.b.id) || { elo: 1500, fights: 0, lastDate: '' };
    const d = String(f.date).slice(0, 10);
    if (d >= from && d < to && Math.min(a.fights, b.fights) >= minFights) {
      const at = new Date(f.date).getTime();
      const ctx = x => ({ elo: x.elo, fights: x.fights, record: '', daysSinceLast: x.lastDate ? (at - new Date(x.lastDate).getTime()) / 864e5 : undefined });
      const p = M.predict(ctx(a), ctx(b), { org: f.org, rounds: f.rounds }, P).pA;
      out.push({ p, y: f.result.winner === 'a' ? 1 : 0, org: f.org });
    }
    M.applyFight(r, f, P);
  }
  return out;
}

const score = rows => {
  const n = rows.length;
  if (!n) return { n: 0, brier: NaN, logloss: NaN, acc: NaN };
  let br = 0, ll = 0, ok = 0;
  for (const { p, y } of rows) {
    br += (p - y) ** 2;
    ll -= y ? Math.log(p) : Math.log(1 - p);
    ok += (p >= 0.5) === !!y ? 1 : 0;
  }
  return { n, brier: br / n, logloss: ll / n, acc: ok / n };
};
const fmt = s => `n=${s.n}  Brier ${s.brier.toFixed(4)}  log-loss ${s.logloss.toFixed(4)}  acierto ${(s.acc * 100).toFixed(1)} %`;

// Calibración: lo que dice el modelo para el favorito frente a lo que pasó
function calibration(rows) {
  const bins = [[0.5, 0.55], [0.55, 0.6], [0.6, 0.65], [0.65, 0.7], [0.7, 0.8], [0.8, 1.01]];
  return bins.map(([lo, hi]) => {
    const r = rows.map(x => (x.p >= 0.5 ? { p: x.p, y: x.y } : { p: 1 - x.p, y: 1 - x.y })).filter(x => x.p >= lo && x.p < hi);
    const n = r.length;
    return `  ${(lo * 100) | 0}-${Math.min(100, (hi * 100) | 0)} %: n=${String(n).padStart(4)}  dice ${n ? (100 * r.reduce((t, x) => t + x.p, 0) / n).toFixed(1) : '-'} %  pasó ${n ? (100 * r.reduce((t, x) => t + x.y, 0) / n).toFixed(1) : '-'} %`;
  }).join('\n');
}

async function main() {
  const { fights } = await H.all();
  const post = fights.filter(M.counts);
  const byOrg = o => post.filter(f => f.org === o).length;
  console.log(`Combates con ganador: ${post.length} (UFC ${byOrg('ufc')}, PFL ${byOrg('pfl')}, WOW ${byOrg('wow')})\n`);

  const grid = [];
  for (const SCALE of [300, 400, 500]) for (const K1 of [30, 56, 90]) for (const K0 of [16, 24, 32]) grid.push({ ...M.PARAMS, SCALE, K1, K0 });
  const fit = grid.map(P => ({ P, s: score(run(P, fights, WARM, FIT_TO, 0)) })).sort((x, y) => x.s.logloss - y.s.logloss);
  console.log('Mejores parámetros en el periodo de ajuste (log-loss):');
  fit.slice(0, 5).forEach(({ P, s }) => console.log(`  SCALE ${P.SCALE} K0 ${P.K0} K1 ${P.K1}  ${fmt(s)}`));
  const best = fit[0].P;
  console.log(`\nAhora mismos:   SCALE ${M.PARAMS.SCALE} K0 ${M.PARAMS.K0} K1 ${M.PARAMS.K1}   Elegidos: SCALE ${best.SCALE} K0 ${best.K0} K1 ${best.K1}\n`);

  for (const [name, P] of [['Actuales', M.PARAMS], ['Elegidos en el ajuste', best]]) {
    const test = run(P, fights, FIT_TO, '9999', 0);
    console.log(`== Comprobación (desde ${FIT_TO}) con ${name}`);
    console.log(`  Todos:        ${fmt(score(test))}`);
    console.log(`  ≥3 combates:  ${fmt(score(run(P, fights, FIT_TO, '9999', 3)))}`);
    for (const o of ['ufc', 'pfl', 'wow']) console.log(`  ${o.toUpperCase().padEnd(4)}:        ${fmt(score(test.filter(x => x.org === o)))}`);
    console.log('  Calibración (favorito):\n' + calibration(test) + '\n');
  }
  console.log('Referencia: Brier 0,25 y log-loss 0,693 es lanzar una moneda; las casas rondan 0,21-0,22 y 0,62-0,63.');
}

if (require.main === module) main().then(() => process.exit(0), e => { console.error(e); process.exit(1); });
module.exports = { run, score };
