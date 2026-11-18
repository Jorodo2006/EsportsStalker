// Prueba de las bajas en los puntos de equipo de la NBA: para cada partido pasado se proyecta con los partidos anteriores (el
// modelo de verdad, projectGame de src/lib/basket-teams.ts), se calcula cuánto cambia la plantilla frente a la muestra de la
// proyección (lineupDelta de src/lib/basket-absences.ts, con quién jugó de verdad) y se mide qué parte de esos puntos se pierde o se
// gana en el marcador (k). Se ajusta con un periodo y se comprueba con otro.
//
// Datos (no se piden a ESPN): los registros de jugadores de la caché del servicio basket y los partidos de la liga:
//   docker compose exec -T db psql -U lolet -d lolet -At -c "SELECT json_object_agg(key, value) FROM basket.cache WHERE key LIKE 'log:nba:%'" > logs.json
//   docker compose exec -T basket node -e 'fetch("http://localhost:4004/api/basket/league-games/nba").then(r=>r.json()).then(j=>console.log(JSON.stringify(j.data)))' > liga.json
//   npx esbuild scripts/backtest-puntos.ts --bundle --platform=node --outfile=<temporal>/bp.cjs && node <temporal>/bp.cjs logs.json liga.json
import { readFileSync } from 'node:fs';
import { projectGame } from '../src/lib/basket-teams';
import { lineupDelta } from '../src/lib/basket-absences';
import type { BasketLeagueGames, BasketLogGame } from '../src/lib/types';

const [logsFile, leagueFile] = process.argv.slice(2);
if (!logsFile || !leagueFile) { console.error('Uso: node bp.cjs logs.json liga.json'); process.exit(1); }
const raw = JSON.parse(readFileSync(logsFile, 'utf8').replace(/^﻿/, '')) as Record<string, BasketLogGame[]>;
const league = JSON.parse(readFileSync(leagueFile, 'utf8').replace(/^﻿/, '')) as BasketLeagueGames;

// Partidos de cada jugador, sin repetir (la caché guarda uno por temporada)
const players = new Map<string, { id: string; name: string; games: BasketLogGame[] }>();
for (const [key, games] of Object.entries(raw)) {
  const id = key.split(':')[2];
  const p = players.get(id) ?? { id, name: id, games: [] };
  for (const g of games) if (!p.games.some(x => x.id === g.id)) p.games.push(g);
  players.set(id, p);
}
// Quién jugó cada partido (y cuántos puntos), y los jugadores que han pasado por cada equipo
const played = new Map<string, Map<string, number>>(); // partido → jugador → puntos
const byTeam = new Map<string, Set<string>>();
for (const p of players.values()) for (const g of p.games) {
  if (!g.teamId || g.type === 'pre') continue;
  if (g.min > 0) { const m = played.get(g.id) ?? new Map(); m.set(p.id, g.pts); played.set(g.id, m); }
  const s = byTeam.get(g.teamId) ?? new Set(); s.add(p.id); byTeam.set(g.teamId, s);
}

const SPLIT = Date.parse('2026-02-01'); // antes: para ajustar; después (y la temporada 26-27): para comprobar
const FROM = Date.parse('2025-11-20'); // los primeros partidos de 25-26 no tienen muestra
type Row = { fit: boolean; season: number; r: number; d: number; dNeg: number; dReg: number; dRegOpp: number; dOpp: number; mu: number; sd: number; y: number; cover: number };
const rows: Row[] = [];
const totals: { fit: boolean; y: number; mu: number; sd: number; d: number; dNeg: number; dReg: number }[] = [];
let skipped = 0;
for (const g of league.games) {
  const t = Date.parse(g.date);
  if (g.type !== 'reg' || t < FROM) continue;
  const P = projectGame(league, g.away.id, g.home.id, 'game', g.date, g.season);
  if (!P) continue;
  const who = played.get(g.id) ?? new Map<string, number>();
  const side = (teamId: string, pts: number, pool: { id: string }[], w: number[]) => {
    const team = [...(byTeam.get(teamId) ?? [])].map(id => players.get(id)!);
    const res = lineupDelta(team, teamId, pool, w, id => (who.has(id) ? 1 : 0), g.date);
    // Qué parte de los puntos del equipo anotaron jugadores con registro: si faltan muchos, no se sabe quién jugó
    const got = team.reduce((s, p) => s + (who.get(p.id) ?? 0), 0);
    // Bajas de habituales: jugadores que han jugado al menos 5 de los 10 últimos partidos del equipo esta temporada y hoy no juegan
    // (lo que da el parte médico antes de un partido). Fuera los que se fueron del equipo y los fichajes: cambios de plantilla
    const last10 = pool.filter(r => (league.games.find(x => x.id === r.id)?.season ?? 0) === g.season).slice(0, 10).map(r => r.id);
    const regular = (id: string) => last10.length >= 5 && last10.filter(gid => played.get(gid)?.has(id)).length >= 5;
    const dReg = res.changes.filter(c => c.play === 0 && regular(c.id)).reduce((s, c) => s + c.delta, 0);
    return { d: res.delta, dNeg: res.changes.filter(c => c.delta < 0).reduce((s, c) => s + c.delta, 0), dReg, cover: pts ? got / pts : 0 };
  };
  const A = side(g.away.id, g.away.pts, P.a.pool, P.a.weights), B = side(g.home.id, g.home.pts, P.b.pool, P.b.weights);
  if (A.cover < 0.85 || B.cover < 0.85) { skipped++; continue; }
  const fit = t < SPLIT;
  rows.push({ fit, season: g.season, r: g.away.pts - P.away.mu, d: A.d, dNeg: A.dNeg, dReg: A.dReg, dRegOpp: B.dReg, dOpp: B.d, mu: P.away.mu, sd: P.away.sd, y: g.away.pts, cover: A.cover });
  rows.push({ fit, season: g.season, r: g.home.pts - P.home.mu, d: B.d, dNeg: B.dNeg, dReg: B.dReg, dRegOpp: A.dReg, dOpp: A.d, mu: P.home.mu, sd: P.home.sd, y: g.home.pts, cover: B.cover });
  totals.push({ fit, y: g.away.pts + g.home.pts, mu: P.total.mu, sd: P.total.sd, d: A.d + B.d, dNeg: A.dNeg + B.dNeg, dReg: A.dReg + B.dReg });
}

const fitRows = rows.filter(r => r.fit), test = rows.filter(r => !r.fit);
console.log(`Partidos: ${totals.length} (ajuste ${totals.filter(x => x.fit).length}, comprobación ${totals.filter(x => !x.fit).length}); fuera por registros incompletos: ${skipped}`);

// Mínimos cuadrados sin término independiente: r = k·x
const k1 = (xs: Row[], f: (r: Row) => number) => { const sxy = xs.reduce((s, r) => s + f(r) * r.r, 0), sxx = xs.reduce((s, r) => s + f(r) ** 2, 0); return sxx ? sxy / sxx : 0; };
// Con el rival: r = a·d + b·dOpp
function k2(xs: Row[]) {
  let a11 = 0, a12 = 0, a22 = 0, b1 = 0, b2 = 0;
  for (const r of xs) { a11 += r.d * r.d; a12 += r.d * r.dOpp; a22 += r.dOpp * r.dOpp; b1 += r.d * r.r; b2 += r.dOpp * r.r; }
  const det = a11 * a22 - a12 * a12;
  return det ? { a: (b1 * a22 - b2 * a12) / det, b: (a11 * b2 - a12 * b1) / det } : { a: 0, b: 0 };
}
const mse = (xs: Row[], adj: (r: Row) => number) => xs.reduce((s, r) => s + (r.r - adj(r)) ** 2, 0) / xs.length;

const kFull = k1(fitRows, r => r.d), kNeg = k1(fitRows, r => r.dNeg), both = k2(fitRows);
console.log(`\nAjustado (hasta el 1-2-2026): k = ${kFull.toFixed(3)} con bajas y vueltas · ${kNeg.toFixed(3)} sólo bajas · con el rival a = ${both.a.toFixed(3)}, b = ${both.b.toFixed(3)}`);
console.log(`Sesgo medio de la proyección: ajuste ${(fitRows.reduce((s, r) => s + r.r, 0) / fitRows.length).toFixed(2)} · comprobación ${(test.reduce((s, r) => s + r.r, 0) / test.length).toFixed(2)} puntos`);
for (const [name, xs] of [['Ajuste', fitRows], ['Comprobación', test], ['  · 25-26 desde febrero', test.filter(r => r.season === 2026)], ['  · 26-27', test.filter(r => r.season === 2027)]] as [string, Row[]][]) {
  if (!xs.length) continue;
  const base = mse(xs, () => 0);
  console.log(`${name.padEnd(26)} n=${String(xs.length).padStart(4)} · error² sin bajas ${base.toFixed(1)} · con bajas ${mse(xs, r => kFull * r.d).toFixed(1)} · sólo bajas ${mse(xs, r => kNeg * r.dNeg).toFixed(1)} · con el rival ${mse(xs, r => both.a * r.d + both.b * r.dOpp).toFixed(1)}`);
}

// Por tramos de delta: lo que se apartó de la proyección (debería crecer con delta) y lo que dice el ajuste
console.log('\nPuntos del equipo frente a la proyección, por cambio en la plantilla (todos los partidos):');
const BINS: [number, number, string][] = [[-99, -15, '≤ −15'], [-15, -8, '−15 a −8'], [-8, -3, '−8 a −3'], [-3, 3, '−3 a 3'], [3, 8, '3 a 8'], [8, 99, '≥ 8']];
for (const [lo, hi, label] of BINS) {
  const xs = rows.filter(r => r.d >= lo && r.d < hi);
  if (!xs.length) continue;
  const m = xs.reduce((s, r) => s + r.r, 0) / xs.length, dm = xs.reduce((s, r) => s + r.d, 0) / xs.length;
  console.log(`  ${label.padEnd(9)} n=${String(xs.length).padStart(4)} · cambio medio ${dm.toFixed(1).padStart(6)} · se apartó ${m.toFixed(1).padStart(6)} · el ajuste dice ${(kFull * dm).toFixed(1).padStart(6)}`);
}

// El total del partido: probabilidad del «más» en una línea cerca de la proyección, sin y con las bajas (log-loss y acierto)
const phi = (z: number) => 0.5 * (1 + Math.tanh(Math.sqrt(2 / Math.PI) * (z + 0.044715 * z ** 3)));
function totalScore(xs: typeof totals, k: number, f: (x: (typeof totals)[number]) => number) {
  let ll0 = 0, ll1 = 0, n = 0, e0 = 0, e1 = 0;
  for (const x of xs) {
    const line = Math.round(x.mu) + 0.5, over = x.y > line ? 1 : 0;
    const p0 = Math.min(0.99, Math.max(0.01, 1 - phi((line - x.mu) / x.sd))), p1 = Math.min(0.99, Math.max(0.01, 1 - phi((line - x.mu - k * f(x)) / x.sd)));
    ll0 -= over ? Math.log(p0) : Math.log(1 - p0); ll1 -= over ? Math.log(p1) : Math.log(1 - p1);
    e0 += (x.y - x.mu) ** 2; e1 += (x.y - x.mu - k * f(x)) ** 2; n++;
  }
  return { n, ll0: ll0 / n, ll1: ll1 / n, e0: e0 / n, e1: e1 / n };
}
console.log('\nTotal del partido (línea a medio punto de la proyección):');
for (const [name, xs] of [['Ajuste', totals.filter(x => x.fit)], ['Comprobación', totals.filter(x => !x.fit)]] as [string, typeof totals][]) {
  const s = totalScore(xs, kFull, x => x.d), s2 = totalScore(xs, kNeg, x => x.dNeg);
  console.log(`  ${name.padEnd(13)} n=${s.n} · error² ${s.e0.toFixed(1)} → ${s.e1.toFixed(1)} (sólo bajas ${s2.e1.toFixed(1)}) · log-loss ${s.ll0.toFixed(4)} → ${s.ll1.toFixed(4)} (sólo bajas ${s2.ll1.toFixed(4)})`);
}

// ---------- Bajas de habituales (lo que se sabe antes del partido: el parte médico) ----------
const kReg = k1(fitRows, r => r.dReg);
const kRegOpp = (() => { let a11 = 0, a12 = 0, a22 = 0, b1 = 0, b2 = 0; for (const r of fitRows) { a11 += r.dReg ** 2; a12 += r.dReg * r.dRegOpp; a22 += r.dRegOpp ** 2; b1 += r.dReg * r.r; b2 += r.dRegOpp * r.r; } const det = a11 * a22 - a12 * a12; return det ? { a: (b1 * a22 - b2 * a12) / det, b: (a11 * b2 - a12 * b1) / det } : { a: 0, b: 0 }; })();
console.log(`\nBajas de habituales: k = ${kReg.toFixed(3)} (con el rival a = ${kRegOpp.a.toFixed(3)}, b = ${kRegOpp.b.toFixed(3)}) · equipos con baja: ${rows.filter(r => r.dReg < -0.5).length} de ${rows.length}`);
for (const [name, xs] of [['Ajuste', fitRows], ['Comprobación', test], ['  · 25-26 desde febrero', test.filter(r => r.season === 2026)], ['  · 26-27', test.filter(r => r.season === 2027)]] as [string, Row[]][]) {
  const withOut = xs.filter(r => r.dReg < -0.5);
  if (!withOut.length) continue;
  console.log(`${name.padEnd(26)} con baja n=${String(withOut.length).padStart(4)} · se apartaron ${(withOut.reduce((s, r) => s + r.r, 0) / withOut.length).toFixed(2)} · el ajuste dice ${(withOut.reduce((s, r) => s + kReg * r.dReg, 0) / withOut.length).toFixed(2)} · error² ${mse(withOut, () => 0).toFixed(1)} → ${mse(withOut, r => kReg * r.dReg).toFixed(1)} · todos ${mse(xs, () => 0).toFixed(1)} → ${mse(xs, r => kReg * r.dReg).toFixed(1)}`);
}
console.log('Por tamaño de la baja (todos los partidos):');
for (const [lo, hi, label] of [[-99, -20, '≤ −20'], [-20, -12, '−20 a −12'], [-12, -6, '−12 a −6'], [-6, -0.5, '−6 a 0'], [-0.5, 99, 'sin baja']] as [number, number, string][]) {
  const xs = rows.filter(r => r.dReg >= lo && r.dReg < hi);
  if (!xs.length) continue;
  const m = xs.reduce((s, r) => s + r.r, 0) / xs.length, dm = xs.reduce((s, r) => s + r.dReg, 0) / xs.length;
  const se = Math.sqrt(xs.reduce((s, r) => s + (r.r - m) ** 2, 0) / Math.max(1, xs.length - 1) / xs.length);
  console.log(`  ${label.padEnd(10)} n=${String(xs.length).padStart(4)} · baja media ${dm.toFixed(1).padStart(6)} · se apartó ${m.toFixed(1).padStart(5)} (± ${(1.96 * se).toFixed(1)}) · el ajuste dice ${(kReg * dm).toFixed(1).padStart(5)}`);
}
console.log('Total del partido con las bajas de habituales:');
for (const [name, xs] of [['Ajuste', totals.filter(x => x.fit)], ['Comprobación', totals.filter(x => !x.fit)]] as [string, typeof totals][]) {
  const s = totalScore(xs, kReg, x => x.dReg);
  console.log(`  ${name.padEnd(13)} n=${s.n} · error² ${s.e0.toFixed(1)} → ${s.e1.toFixed(1)} · log-loss ${s.ll0.toFixed(4)} → ${s.ll1.toFixed(4)}`);
}

// ---------- Sólo las bajas grandes (lo que dicen los tramos: por debajo, nada medible) ----------
console.log('\nSólo bajas grandes de habituales (ajuste = k · baja si la baja pasa del umbral):');
for (const T of [15, 20, 25]) {
  const big = (r: { dReg: number }) => r.dReg <= -T;
  const kb = k1(fitRows.filter(big), r => r.dReg);
  const adj = (r: Row) => (big(r) ? kb * r.dReg : 0);
  const line = (name: string, xs: Row[]) => {
    const b = xs.filter(big);
    return `${name} grandes n=${b.length} se apartaron ${(b.reduce((s, r) => s + r.r, 0) / Math.max(1, b.length)).toFixed(2)} dice ${(b.reduce((s, r) => s + adj(r), 0) / Math.max(1, b.length)).toFixed(2)} · error² todos ${mse(xs, () => 0).toFixed(1)} → ${mse(xs, adj).toFixed(1)}`;
  };
  // El total: la suma de lo de los dos equipos
  const totAdj = (fit: boolean) => {
    const xs = rows.filter(r => r.fit === fit);
    let ll0 = 0, ll1 = 0, n = 0;
    for (let i = 0; i + 1 < xs.length; i += 2) {
      const a = xs[i], b = xs[i + 1], y = a.y + b.y, mu = a.mu + b.mu, sd = Math.sqrt(a.sd ** 2 + b.sd ** 2), line = Math.round(mu) + 0.5, over = y > line ? 1 : 0;
      const sh = adj(a) + adj(b);
      const p0 = Math.min(0.99, Math.max(0.01, 1 - phi((line - mu) / sd))), p1 = Math.min(0.99, Math.max(0.01, 1 - phi((line - mu - sh) / sd)));
      ll0 -= over ? Math.log(p0) : Math.log(1 - p0); ll1 -= over ? Math.log(p1) : Math.log(1 - p1); n++;
    }
    return `log-loss total ${(ll0 / n).toFixed(4)} → ${(ll1 / n).toFixed(4)}`;
  };
  console.log(`  umbral ${T}: k = ${kb.toFixed(3)}\n    ${line('ajuste      ', fitRows)} · ${totAdj(true)}\n    ${line('comprobación', test)} · ${totAdj(false)}`);
}

// ---------- Cantidades prudentes, sin volver a ajustar: ¿alguna mejora en los dos periodos? ----------
console.log('\nCantidades fijas con bajas de 20 o más (error² de los equipos con baja grande · log-loss del total):');
for (const k of [0.03, 0.05, 0.08, 0.1]) {
  const adj = (r: Row) => (r.dReg <= -20 ? k * r.dReg : 0);
  const out = [true, false].map(fit => {
    const xs = rows.filter(r => r.fit === fit), b = xs.filter(r => r.dReg <= -20);
    let ll0 = 0, ll1 = 0, n = 0;
    for (let i = 0; i + 1 < xs.length; i += 2) {
      const a = xs[i], c = xs[i + 1], y = a.y + c.y, mu = a.mu + c.mu, sd = Math.sqrt(a.sd ** 2 + c.sd ** 2), line = Math.round(mu) + 0.5, over = y > line ? 1 : 0;
      const p0 = Math.min(0.99, Math.max(0.01, 1 - phi((line - mu) / sd))), p1 = Math.min(0.99, Math.max(0.01, 1 - phi((line - mu - adj(a) - adj(c)) / sd)));
      ll0 -= over ? Math.log(p0) : Math.log(1 - p0); ll1 -= over ? Math.log(p1) : Math.log(1 - p1); n++;
    }
    return `${fit ? 'ajuste' : 'comprobación'} ${mse(b, () => 0).toFixed(1)} → ${mse(b, adj).toFixed(1)} · ${(ll0 / n).toFixed(4)} → ${(ll1 / n).toFixed(4)}`;
  });
  console.log(`  k = ${k.toFixed(2)}: ${out.join(' | ')}`);
}
