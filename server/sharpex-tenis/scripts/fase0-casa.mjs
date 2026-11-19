// Fase 0 del motor de los Challenger (docs/superpowers/specs/2026-11-19-motor-challenger-v2-design.md): ¿aporta el modelo algo frente
// a la casa? Con las cuotas de ganador de producción, los resultados de LiveScore y el motor entrenado sólo con lo anterior a cada
// partido. No es parte del motor ni del servicio: se lanza a mano y no guarda nada en el repo. Cómo sacar los dos ficheros de
// entrada: docs/superpowers/plans/2026-11-19-motor-challenger-estado.md (las cuotas, de la base de datos de producción con permiso:
// regla 9 de AGENTS.md; nunca se suben al repo).
//   node --max-old-space-size=2500 scripts/fase0-casa.mjs <datos> <carpeta con cuotas-prod.csv y resultados.json>
// Los cortes de los modelos (M1 y M2, más abajo) son los de la medición del 19-11-2026: cámbialos para otro periodo.
import { readFileSync, writeFileSync } from 'node:fs';
import { loadMatches, venueSurfaces, surfaceOf, EloModel, matcher, fairProbs, parseCsv, HISTORY_LEVELS } from '../src/index.js';
const [, , DATA, DIR] = process.argv;

const logit = (p) => Math.log(p / (1 - p));
const sig = (z) => 1 / (1 + Math.exp(-z));
const clampP = (p) => Math.min(0.995, Math.max(0.005, p));
const ll = (p, y) => -(y ? Math.log(clampP(p)) : Math.log(1 - clampP(p)));
const blend = (pm, pc, w) => sig(w * logit(clampP(pm)) + (1 - w) * logit(clampP(pc)));

// ---------- cuotas: apertura y cierre de cada casa, sin lo leído después de la hora prevista ----------
const rows = parseCsv(readFileSync(`${DIR}/cuotas-prod.csv`, 'utf8'));
const byMatch = new Map();
for (const r of rows) {
  const start = Date.parse(r.start.replace(' ', 'T').replace(/\+00$/, 'Z')), ts = Date.parse(r.ts.replace(' ', 'T').replace(/\+00$/, 'Z'));
  if (!(ts <= start)) continue;
  const m = byMatch.get(r.match_key) ?? { start, league: r.league, books: {} };
  const bk = (m.books[r.book] ??= { a: [], b: [] });
  bk[r.outcome_id].push({ ts, price: +r.price });
  byMatch.set(r.match_key, m);
}
function market(m) {
  const open = [], close = [], best = { open: { a: 0, b: 0 }, close: { a: 0, b: 0 } };
  for (const { a, b } of Object.values(m.books)) {
    if (!a.length || !b.length) continue;
    a.sort((x, y) => x.ts - y.ts); b.sort((x, y) => x.ts - y.ts);
    const o = [a[0].price, b[0].price], c = [a.at(-1).price, b.at(-1).price];
    open.push(fairProbs(o[0], o[1])[0]); close.push(fairProbs(c[0], c[1])[0]);
    best.open.a = Math.max(best.open.a, o[0]); best.open.b = Math.max(best.open.b, o[1]);
    best.close.a = Math.max(best.close.a, c[0]); best.close.b = Math.max(best.close.b, c[1]);
  }
  if (!open.length) return null;
  const avg = (x) => x.reduce((s, v) => s + v, 0) / x.length;
  return { open: avg(open), close: avg(close), best, books: open.length };
}

// ---------- modelos sin ver los partidos que se miden ----------
const all = loadMatches(DATA, { levels: HISTORY_LEVELS });
const venues = venueSurfaces(all);
function trained(before) {
  const m = new EloModel();
  m.venues = venues;
  m.fit(all.filter((x) => x.date < before));
  return { model: m, find: matcher(m) };
}
const M1 = trained('2026-11-09'), M2 = trained('2026-11-16');
console.log(`Histórico: ${all.length} partidos; modelo 1 hasta ${M1.model.lastDate}, modelo 2 hasta ${M2.model.lastDate}`);

// ---------- partidos ----------
const results = JSON.parse(readFileSync(`${DIR}/resultados.json`, 'utf8'));
const S = [];
let noOdds = 0, noPlayer = 0, low = 0;
for (const r of results) {
  if (/^previa/i.test(r.round) || (!r.aw && !r.bw)) continue;
  const mk = byMatch.get(`${r.a}|${r.b}`);
  const mkt = mk && market(mk);
  if (!mkt) { noOdds++; continue; }
  const { model, find } = r.day <= '2026-11-15' ? M1 : M2;
  const a = find(r.a), b = find(r.b);
  if (!a || !b) { noPlayer++; continue; }
  const pred = model.predict(a.id, b.id, surfaceOf(venues, r.tournament).surface, r.date, { tournament: r.tournament });
  if (pred.lowData) { low++; continue; }
  S.push({ day: r.day, t: r.tournament, a: r.a, b: r.b, y: r.aw ? 1 : 0, pm: pred.pA, open: mkt.open, close: mkt.close, best: mkt.best, books: mkt.books });
}
console.log(`Challengers del cuadro final con resultado: ${S.length} medibles (sin cuotas ${noOdds}, jugador sin emparejar ${noPlayer}, pocos datos ${low})`);

// ---------- log-loss: casa, modelo y mezcla ----------
const mean = (xs) => xs.reduce((s, v) => s + v, 0) / xs.length;
const se = (xs) => { const m = mean(xs); return Math.sqrt(xs.reduce((s, v) => s + (v - m) ** 2, 0) / (xs.length - 1) / xs.length); };
const LL = (set, f) => mean(set.map((s) => ll(f(s), s.y)));
const A = S.filter((s) => s.day <= '2026-11-15'), B = S.filter((s) => s.day > '2026-11-15');
const W = Array.from({ length: 21 }, (_, i) => i / 20);
const best = (set, mk) => W.map((w) => [w, LL(set, (s) => blend(s.pm, s[mk], w))]).sort((x, y) => x[1] - y[1])[0];
const out = { n: S.length, nA: A.length, nB: B.length };
for (const [name, set] of [['todos', S], ['12-15 nov', A], ['16-18 nov', B]]) {
  out[name] = {
    n: set.length, casaApertura: LL(set, (s) => s.open), casaCierre: LL(set, (s) => s.close), modelo: LL(set, (s) => s.pm),
    mezcla25apertura: LL(set, (s) => blend(s.pm, s.open, 0.25)), mezcla25cierre: LL(set, (s) => blend(s.pm, s.close, 0.25)),
    mejorWapertura: best(set, 'open'), mejorWcierre: best(set, 'close'),
  };
}
// Peso elegido en una mitad y comprobado en la otra
for (const [fit, test, label] of [[A, B, 'ajuste 12-15, prueba 16-18'], [B, A, 'ajuste 16-18, prueba 12-15']]) {
  for (const mk of ['open', 'close']) {
    const [w] = best(fit, mk);
    out[`${label} (${mk === 'open' ? 'apertura' : 'cierre'})`] = { w, mezcla: LL(test, (s) => blend(s.pm, s[mk], w)), casa: LL(test, (s) => s[mk]) };
  }
}
// ¿Mejora la mezcla a la casa de cierre? Diferencia por partido (negativa: mejor la mezcla), con su error
for (const w of [0.1, 0.25, 0.5]) {
  const d = S.map((s) => ll(blend(s.pm, s.close, w), s.y) - ll(s.close, s.y));
  out[`mezcla ${w} frente a cierre`] = { diferencia: mean(d), error: se(d) };
}

// ---------- CLV de las que habrían sido Valor (con la apertura, mezcla 25 %) ----------
const TRAMOS = [['baja', 1.15, 1.6, 0.03], ['media', 1.6, 2.5, 0.04], ['alta', 2.5, 6.0, 0.07]];
function picks(w) {
  const list = [];
  for (const s of S) {
    const pf = blend(s.pm, s.open, w);
    for (const side of ['a', 'b']) {
      const p = side === 'a' ? pf : 1 - pf, price = s.best.open[side];
      const tramo = TRAMOS.find(([, lo, hi]) => price >= lo && price < hi);
      if (!tramo || Math.abs((side === 'a' ? s.pm : 1 - s.pm) - (side === 'a' ? s.open : 1 - s.open)) > 0.2) continue;
      const ev = p * price - 1;
      if (ev < tramo[3]) continue;
      const pClose = side === 'a' ? s.close : 1 - s.close;
      list.push({ tramo: tramo[0], price, ev, clv: pClose * price - 1, beat: price > s.best.close[side], won: (side === 'a') === (s.y === 1) });
    }
  }
  const sum = (xs) => ({ n: xs.length, valorEsperado: xs.length ? mean(xs.map((x) => x.ev)) : null, clv: xs.length ? mean(xs.map((x) => x.clv)) : null,
    clvError: xs.length > 2 ? se(xs.map((x) => x.clv)) : null, mejorQueCierre: xs.length ? xs.filter((x) => x.beat).length / xs.length : null,
    roi: xs.length ? mean(xs.map((x) => (x.won ? x.price - 1 : -1))) : null });
  return { todas: sum(list), ...Object.fromEntries(TRAMOS.map(([t]) => [t, sum(list.filter((x) => x.tramo === t))])) };
}
out.valorMezcla25 = picks(0.25);
out.valorModeloSolo = picks(1);
// Calibración de la casa de cierre y del modelo en este puñado (por si alguno se pasa de confiado)
console.log(JSON.stringify(out, null, 1));
writeFileSync(`${DIR}/fase0-resultado.json`, JSON.stringify({ out, S }, null, 1));
