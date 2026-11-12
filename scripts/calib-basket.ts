// Calibración del modelo de props de baloncesto en todas las líneas, no sólo en la de la proyección: las casas ofrecen
// escaleras (más de 19,5, 24,5, 29,5…) y las recomendaciones salen muchas veces de las líneas alejadas. Para cada partido
// pasado se proyecta con los partidos anteriores del jugador y se miran líneas a −1,5…+1,5 desviaciones de su media reciente.
// Dice si la proyección se pasa (sesgo de la media), si la curva acierta en las colas y cuánto se pierde con cada variante.
//
// Datos: los mismos que scripts/backtest-basket.ts (registros de la caché del servicio basket):
//   docker compose exec -T db psql -U lolet -d lolet -At -c "SELECT json_object_agg(key, value) FROM basket.cache WHERE key LIKE 'log:nba:%'" > logs.json
//   npx esbuild scripts/calib-basket.ts --bundle --platform=node --outfile=<temporal>/cal.cjs && node <temporal>/cal.cjs logs.json
import { readFileSync } from 'node:fs';
import { BASKET_MARKETS, PROJ, analyze, project, type BasketCtx, type BasketMarket } from '../src/lib/basket-model';
import { gameCtx } from '../src/lib/basket-context';
import type { BasketLogGame } from '../src/lib/types';

const file = process.argv[2];
if (!file) { console.error('Uso: node cal.cjs logs.json [muestra]'); process.exit(1); }
const EVERY = Number(process.argv[3]) || 3; // un partido de cada N por jugador: con todos tarda mucho
// Variante de los ajustes de la proyección para compararla, en JSON: '{"carry":1}'
if (process.argv[4]) Object.assign(PROJ, JSON.parse(process.argv[4]));
const raw = JSON.parse(readFileSync(file, 'utf8').replace(/^﻿/, '')) as Record<string, BasketLogGame[]>;

const byPlayer = new Map<string, BasketLogGame[]>();
for (const [key, games] of Object.entries(raw)) {
  const id = key.split(':')[2];
  const list = byPlayer.get(id) ?? [];
  for (const g of games) if (!list.some(x => x.id === g.id)) list.push(g);
  byPlayer.set(id, list);
}
const teamGames = new Map<string, { id: string; date: string }[]>();
for (const games of byPlayer.values()) for (const g of games) {
  if (!g.teamId || g.type === 'pre') continue;
  const list = teamGames.get(g.teamId) ?? [];
  if (!list.some(x => x.id === g.id)) list.push({ id: g.id, date: g.date });
  teamGames.set(g.teamId, list);
}

const MARKETS: BasketMarket[] = ['pts', 'reb', 'ast', 'fg3m', 'pra', 'pr', 'pa', 'ra'];
const K = [-1.5, -1, -0.5, 0, 0.5, 1, 1.5];
type Row = { m: BasketMarket; k: number; season: number; y: number; mu: number; sd: number; line: number; p: number; min: number; projMin: number };
const rows: Row[] = [];
let n = 0;
for (const games of byPlayer.values()) {
  const asc = games.filter(g => g.type !== 'pre').sort((a, b) => +new Date(a.date) - +new Date(b.date));
  for (let i = 10; i < asc.length; i += EVERY) {
    const g = asc[i];
    if (g.min < 1) continue; // los que salen un minuto no tienen línea en las casas
    const prior = games.filter(x => +new Date(x.date) < +new Date(g.date));
    const team = g.teamId ? teamGames.get(g.teamId) ?? [] : [];
    const ctx: BasketCtx = { currentSeason: g.season, home: g.home, opp: g.opp, injury: null, ...gameCtx(prior, team, g.date, g.teamId) };
    // Las líneas salen de su media simple de los últimos 20 partidos, no de la proyección: así todas las variantes del modelo
    // se miden con las mismas líneas (como las casas, que no usan nuestro modelo)
    const last = prior.filter(x => x.type !== 'pre').sort((a, b) => +new Date(b.date) - +new Date(a.date)).slice(0, 20);
    // Las casas sólo sacan líneas de jugadores con minutos
    if (last.reduce((a, x) => a + x.min, 0) / last.length < 15) continue;
    for (const m of MARKETS) {
      const vals = last.map(BASKET_MARKETS[m].f), ref = vals.reduce((a, v) => a + v, 0) / vals.length;
      const sd = Math.sqrt(vals.reduce((a, v) => a + (v - ref) ** 2, 0) / (vals.length - 1));
      if (ref < 1.5) continue; // medias casi cero: sin línea
      const P = project(prior, m, ctx);
      if (!P) continue;
      const seen = new Set<number>();
      for (const k of K) {
        const line = Math.floor(ref + k * sd) + 0.5;
        if (line < 0.5 || seen.has(line)) continue;
        seen.add(line);
        const A = analyze(prior, m, line, {}, ctx);
        if (!A) continue;
        rows.push({ m, k, season: g.season, y: BASKET_MARKETS[m].f(g), mu: P.mu, sd: P.sigma, line, p: A.pOver, min: g.min, projMin: P.projMin });
      }
    }
    if (++n % 2000 === 0) process.stderr.write(`${n} partidos\n`);
  }
}

const f3 = (v: number) => v.toFixed(3), pc = (v: number) => (v * 100).toFixed(1).padStart(5);
const ll = (p: number, y: boolean) => -Math.log(Math.min(0.999, Math.max(0.001, y ? p : 1 - p)));
console.log(`\n${rows.length} líneas de ${n} partidos`);

// Sesgo de la proyección: media de (real − proyectada) por mercado y temporada
console.log('\nSesgo de la media (real − proyección) y minutos');
for (const s of [...new Set(rows.map(r => r.season))].sort()) {
  const base = rows.filter(r => r.season === s && r.k === 0);
  const parts = MARKETS.map(m => { const x = base.filter(r => r.m === m); return `${m} ${(x.reduce((a, r) => a + r.y - r.mu, 0) / Math.max(1, x.length)).toFixed(2)}`; });
  const mins = base.filter(r => r.m === 'pts');
  console.log(`  ${s}: ${parts.join(' · ')} · min ${(mins.reduce((a, r) => a + r.min - r.projMin, 0) / Math.max(1, mins.length)).toFixed(2)} (${mins.length})`);
}

// Calibración por distancia de la línea a la proyección: lo que dice el modelo y lo que pasó
console.log('\nPor línea (desviaciones sobre la proyección): modelo % más / real % más · log-loss');
for (const k of K) {
  const x = rows.filter(r => r.k === k);
  const p = x.reduce((a, r) => a + r.p, 0) / x.length, y = x.filter(r => r.y > r.line).length / x.length;
  console.log(`  ${String(k).padStart(4)}: ${pc(p)} / ${pc(y)}  n ${x.length}  ll ${f3(x.reduce((a, r) => a + ll(r.p, r.y > r.line), 0) / x.length)}`);
}
console.log('\nCalibración (tramos de la probabilidad de más)');
for (let b = 0; b < 10; b++) {
  const x = rows.filter(r => r.p >= b / 10 && r.p < (b + 1) / 10);
  if (!x.length) continue;
  console.log(`  ${b * 10}-${b * 10 + 10} %: dice ${pc(x.reduce((a, r) => a + r.p, 0) / x.length)} · pasa ${pc(x.filter(r => r.y > r.line).length / x.length)} · n ${x.length}`);
}
console.log('\nPor mercado: modelo / real en líneas por encima (+0,5…+1,5) y por debajo (−1,5…−0,5)');
for (const m of MARKETS) {
  const hi = rows.filter(r => r.m === m && r.k > 0), lo = rows.filter(r => r.m === m && r.k < 0);
  const s = (x: Row[]) => `${pc(x.reduce((a, r) => a + r.p, 0) / x.length)} / ${pc(x.filter(r => r.y > r.line).length / x.length)}`;
  console.log(`  ${m.padEnd(5)} arriba ${s(hi)} · abajo ${s(lo)} · ll ${f3(rows.filter(r => r.m === m).reduce((a, r) => a + ll(r.p, r.y > r.line), 0) / rows.filter(r => r.m === m).length)}`);
}
const llOf = (x: Row[]) => f3(x.reduce((a, r) => a + ll(r.p, r.y > r.line), 0) / x.length);
console.log(`\nLog-loss total ${llOf(rows)} · ${[...new Set(rows.map(r => r.season))].sort().map(s => `${s}: ${llOf(rows.filter(r => r.season === s))}`).join(' · ')}`);
