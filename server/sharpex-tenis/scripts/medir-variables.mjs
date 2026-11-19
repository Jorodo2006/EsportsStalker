// Medición de variables propias de los Challenger frente al Elo (fase 2 de docs/superpowers/specs/2026-11-19-motor-challenger-v2-design.md).
// No es parte del motor ni del servicio: se lanza a mano y no guarda nada.
//   cd server/sharpex-tenis && node bin/sharpex-tenis.js datos --carpeta datos      (la primera vez; 63 MB, ignorado por git)
//   node --max-old-space-size=2000 scripts/medir-variables.mjs datos
// O con los datos del servicio en Docker (desde la raíz del repo, en Git Bash con MSYS_NO_PATHCONV=1):
//   docker run --rm --entrypoint node -v sharpex_challenger:/data:ro -v "$PWD/server/sharpex-tenis:/motor:ro" sharpex-server --max-old-space-size=2000 /motor/scripts/medir-variables.mjs /data/datos
// Ojo: usa SÓLO el archivo de Sackmann (atp_matches_*.csv, hasta el 1-6-2026), porque trae lo que el formato interno no guarda
// (cómo entró al cuadro, ranking, minutos), y su propio recorrido del Elo (sin contar las retiradas), así que su línea base no es
// la de 'validar'. Sirve para saber qué variables tienen efecto; el peso de verdad se ajusta dentro del motor.
// Ajuste de pesos con 2023, evaluación con 2024 en adelante, sólo cuadro final de Challengers y sin jugadores con pocos datos.
// Residuo = resultado − probabilidad del Elo, desde cada jugador (positivo: gana más de lo que dice el Elo).
import { readFileSync, readdirSync } from 'node:fs';
import { parseCsv } from '../src/csv.js';
import { EloModel } from '../src/elo.js';

const DIR = process.argv[2] || 'datos';
const ROUND = { Q1: 1, Q2: 2, Q3: 3, Q4: 4, R128: 5, R64: 6, R32: 7, R16: 8, QF: 9, SF: 10, F: 11, RR: 6, BR: 10 };
const iso = d => `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`;
const dayN = d => Date.UTC(+d.slice(0, 4), +d.slice(4, 6) - 1, +d.slice(6, 8)) / 864e5;
const logit = p => Math.log(p / (1 - p));
const sig = x => 1 / (1 + Math.exp(-x));

// ---------- carga ----------
const rows = [];
for (const f of readdirSync(DIR).filter(f => /^atp_matches_(qual_chall_|futures_)?\d{4}\.csv$/.test(f))) {
  for (const r of parseCsv(readFileSync(`${DIR}/${f}`, 'utf8'))) {
    if (!r.winner_id || !r.loser_id || !r.tourney_date || r.tourney_level === 'D') continue;
    rows.push({
      d: r.tourney_date, day: dayN(r.tourney_date), tid: r.tourney_id, level: r.tourney_level, surface: r.surface || 'Hard', round: r.round,
      num: +r.match_num || 0, w: `sk:${r.winner_id}`, l: `sk:${r.loser_id}`, wE: (r.winner_entry || '').toUpperCase(), lE: (r.loser_entry || '').toUpperCase(),
      wI: r.winner_ioc, lI: r.loser_ioc, wR: +r.winner_rank || 0, lR: +r.loser_rank || 0, score: r.score || '', min: +r.minutes || 0
    });
  }
}
rows.sort((a, b) => a.d.localeCompare(b.d) || (ROUND[a.round] ?? 6) - (ROUND[b.round] ?? 6) || a.num - b.num);
console.log(`${rows.length} partidos cargados (${rows[0].d} a ${rows.at(-1).d})`);

// Pais del torneo: el de la mayoria de los invitados (las wildcards casi siempre son de casa)
const wcIoc = new Map();
for (const r of rows) for (const [e, i] of [[r.wE, r.wI], [r.lE, r.lI]]) if (e === 'WC' && i) {
  const m = wcIoc.get(r.tid) ?? new Map(); m.set(i, (m.get(i) ?? 0) + 1); wcIoc.set(r.tid, m);
}
const country = new Map();
for (const [tid, m] of wcIoc) {
  const tot = [...m.values()].reduce((s, v) => s + v, 0), [top, n] = [...m.entries()].sort((a, b) => b[1] - a[1])[0];
  if (n >= 2 && n / tot >= 0.5) country.set(tid, top);
}

// ---------- recorrido ----------
const elo = new EloModel({ wElo: 0.91, wStats: 0, tailSlope: 1 });
const hist = new Map(); // jugador -> { tours: [{tid, day, matches, min}], rets: [day] }
const H = id => hist.get(id) ?? (hist.set(id, { tours: [], rets: [] }), hist.get(id));
const samples = []; // una fila por partido puntuable, orientada por id
const isRet = s => /RET/i.test(s), isWo = s => /W\/?O|walkover|DEF/i.test(s);

function feats(id, entry, ioc, rank, r) {
  const h = H(id);
  const prev = h.tours.filter(t => t.tid !== r.tid && t.day < r.day);
  const weeks5 = new Set(prev.filter(t => r.day - t.day <= 35).map(t => t.tid)).size;
  const last = prev.at(-1);
  const lastWeek = last && r.day - last.day <= 10 ? last : null;
  const home = country.has(r.tid) ? (ioc === country.get(r.tid) ? 1 : 0) : null;
  const travel = last && country.has(r.tid) && country.has(last.tid) && r.day - last.day <= 10 ? (country.get(r.tid) !== country.get(last.tid) ? 1 : 0) : null;
  return {
    wc: entry === 'WC' ? 1 : 0, q: entry === 'Q' || entry === 'LL' ? 1 : 0, pr: entry === 'PR' ? 1 : 0, home, travel,
    weeks5: Math.min(weeks5, 4), lastWeekMatches: lastWeek ? Math.min(lastWeek.matches, 5) : 0, lastWeekMin: lastWeek ? lastWeek.min : 0,
    ret35: h.rets.some(d => d < r.day && r.day - d <= 35) ? 1 : 0, lrank: rank > 0 ? Math.log(rank) : null, rank
  };
}

for (const r of rows) {
  const score = r.score;
  const playable = !isWo(score) && score.trim() !== '';
  const scorable = r.level === 'C' && !/^Q/.test(r.round) && r.d >= '20230101' && playable;
  if (scorable) {
    // Orientacion fija por id para que el ganador no este siempre del mismo lado
    const flip = r.w > r.l;
    const [A, B] = flip ? [r.l, r.w] : [r.w, r.l];
    const pr = elo.predict(A, B, r.surface);
    if (!pr.lowData) {
      const fa = flip ? feats(r.l, r.lE, r.lI, r.lR, r) : feats(r.w, r.wE, r.wI, r.wR, r);
      const fb = flip ? feats(r.w, r.wE, r.wI, r.wR, r) : feats(r.l, r.lE, r.lI, r.lR, r);
      samples.push({ d: r.d, round: r.round, surface: r.surface, p: pr.pA, y: flip ? 0 : 1, a: fa, b: fb, ret: isRet(score), retLoser: isRet(score) });
    }
  }
  // Historial: torneo jugado (partido jugado o retirada) y retiradas
  for (const [id, won] of [[r.w, true], [r.l, false]]) {
    if (isWo(score) && !won) continue; // el que no se presento no jugo
    const h = H(id);
    let t = h.tours.at(-1);
    if (!t || t.tid !== r.tid) { t = { tid: r.tid, day: r.day, matches: 0, min: 0 }; h.tours.push(t); if (h.tours.length > 40) h.tours.shift(); }
    t.matches++; t.min += r.min;
  }
  if (isRet(score)) H(r.l).rets.push(r.day);
  if (playable && !isRet(score)) elo.update({ date: iso(r.d), surface: r.surface, winnerId: r.w, winnerName: r.w, loserId: r.l, loserName: r.l });
}
const train = samples.filter(s => s.d < '20240101'), test = samples.filter(s => s.d >= '20240101');
console.log(`Puntuables: ${train.length} de 2023 (ajuste) y ${test.length} de 2024-2026 (evaluacion)`);

// ---------- residuos por variable (2024-2026), desde cada jugador ----------
function table(title, keyOf) {
  const bins = new Map();
  for (const s of test) for (const [f, y, p] of [[s.a, s.y, s.p], [s.b, 1 - s.y, 1 - s.p]]) {
    const k = keyOf(f, s); if (k == null) continue;
    const b = bins.get(k) ?? { n: 0, r: 0, v: 0 }; b.n++; b.r += y - p; b.v += p * (1 - p); bins.set(k, b);
  }
  console.log(`\n${title}`);
  for (const [k, b] of [...bins].sort((x, y) => String(x[0]).localeCompare(String(y[0])))) if (b.n >= 40)
    console.log(`  ${String(k).padEnd(34)} n=${String(b.n).padStart(6)}  residuo ${(b.r / b.n * 100 >= 0 ? '+' : '') + (b.r / b.n * 100).toFixed(1)} pts (±${(196 * Math.sqrt(b.v) / b.n).toFixed(1)})`);
}
table('Como entro al cuadro', f => (f.wc ? 'invitacion (WC)' : f.q ? 'de la previa (Q/LL)' : f.pr ? 'ranking protegido (PR)' : 'directo'));
table('Juega en casa (pais del torneo por sus invitados)', f => (f.home == null ? null : f.home ? 'en casa' : 'fuera'));
table('Torneos en las 5 semanas anteriores', f => `${f.weeks5}${f.weeks5 === 4 ? ' o mas' : ''}`);
table('Partidos la semana anterior', f => (f.lastWeekMatches === 0 ? '0 (no jugo o descanso)' : f.lastWeekMatches <= 2 ? '1-2' : f.lastWeekMatches <= 4 ? '3-4' : '5 (final)'));
table('Cambia de pais respecto a la semana anterior', f => (f.travel == null ? null : f.travel ? 'si' : 'no'));
table('Se retiro hace 5 semanas o menos', f => (f.ret35 ? 'si' : 'no'));
// Por ronda y por superficie, desde el favorito del Elo
function favTable(title, keyOf) {
  const bins = new Map();
  for (const s of test) {
    const fav = s.p >= 0.5, p = fav ? s.p : 1 - s.p, y = fav ? s.y : 1 - s.y, k = keyOf(s, p);
    const b = bins.get(k) ?? { n: 0, r: 0, v: 0, pp: 0, ret: 0 }; b.n++; b.r += y - p; b.v += p * (1 - p); b.pp += p; if (s.ret) b.ret++; bins.set(k, b);
  }
  console.log(`\n${title}`);
  for (const [k, b] of [...bins].sort((x, y) => String(x[0]).localeCompare(String(y[0])))) if (b.n >= 40)
    console.log(`  ${String(k).padEnd(20)} n=${String(b.n).padStart(6)}  dice ${(b.pp / b.n * 100).toFixed(1)} %  pasa ${((b.pp + b.r) / b.n * 100).toFixed(1)} %  (±${(196 * Math.sqrt(b.v) / b.n).toFixed(1)})  retiradas ${(b.ret / b.n * 100).toFixed(1)} %`);
}
favTable('Favorito del Elo por ronda', s => s.round);
favTable('Favorito del Elo por superficie', s => s.surface);
favTable('Favorito del Elo por tramo de probabilidad (cuota justa)', (s, p) => (p < 0.6 ? '50-60 % (1,67-2)' : p < 0.7 ? '60-70 % (1,43-1,67)' : p < 0.8 ? '70-80 % (1,25-1,43)' : p < 0.9 ? '80-90 % (1,11-1,25)' : '90 %+'));

// ---------- regresion logistica: Elo + variables, ajuste 2023 y prueba 2024-2026 ----------
const X = (s, keys) => keys.map(k => {
  if (k === 'elo') return logit(Math.min(0.995, Math.max(0.005, s.p)));
  if (k === 'rank') return s.a.lrank != null && s.b.lrank != null ? s.b.lrank - s.a.lrank : 0;
  const va = s.a[k] ?? 0, vb = s.b[k] ?? 0;
  return (va - vb) / (SD[k] || 1);
});
const SD = {};
for (const k of ['home', 'wc', 'q', 'pr', 'weeks5', 'lastWeekMatches', 'lastWeekMin', 'travel', 'ret35']) {
  const v = train.map(t => (t.a[k] ?? 0) - (t.b[k] ?? 0)), m = v.reduce((a, b) => a + b, 0) / v.length;
  SD[k] = Math.sqrt(v.reduce((a, b) => a + (b - m) ** 2, 0) / v.length) || 1;
}
function fit(keys, data) {
  const w = keys.map(k => (k === 'elo' ? 1 : 0));
  for (let it = 0; it < 1500; it++) {
    const g = w.map(() => 0);
    for (const s of data) { const x = X(s, keys), e = s.y - sig(x.reduce((t, v, i) => t + v * w[i], 0)); x.forEach((v, i) => { g[i] += e * v; }); }
    w.forEach((_, i) => { w[i] += (0.8 / data.length) * g[i]; });
  }
  return w;
}
const ll = (keys, w, data) => data.reduce((t, s) => { const p = sig(X(s, keys).reduce((u, v, i) => u + v * w[i], 0)); return t - (s.y * Math.log(p) + (1 - s.y) * Math.log(1 - p)); }, 0) / data.length;
const base = ll(['elo'], [1], test);
console.log(`\nLog-loss 2024-2026 del Elo de hoy: ${base.toFixed(4)}`);
for (const keys of [['elo'], ['elo', 'rank'], ['elo', 'home'], ['elo', 'wc', 'q', 'pr'], ['elo', 'weeks5', 'lastWeekMatches', 'lastWeekMin'], ['elo', 'travel'], ['elo', 'ret35'],
  ['elo', 'rank', 'home', 'wc', 'q', 'pr', 'weeks5', 'lastWeekMatches', 'lastWeekMin', 'travel', 'ret35']]) {
  const w = fit(keys, train), v = ll(keys, w, test);
  console.log(`  ${keys.join(' + ').padEnd(80)} ${v.toFixed(4)} (${((v - base) * 1e4).toFixed(1)} diezmilesimas)  pesos ${w.map(x => x.toFixed(3)).join(', ')}`);
}
