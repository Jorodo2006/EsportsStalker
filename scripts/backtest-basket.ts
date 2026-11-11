// Prueba del modelo de props de baloncesto con partidos pasados: para cada partido se proyecta con los partidos anteriores
// del jugador (el modelo de verdad, src/lib/basket-model.ts) y se compara con lo que hizo. Mide si el cansancio (B2B,
// pocos días de descanso) y la vuelta tras perderse partidos se notan más allá de lo que el modelo ya recoge, y si los
// factores que usa el modelo mejoran la probabilidad en un periodo distinto del que se usó para ajustarlos.
//
// Datos: los registros de jugadores de la caché del servicio basket (no se piden a ESPN), en un JSON { clave: partidos }:
//   docker compose exec -T db psql -U lolet -d lolet -At -c "SELECT json_object_agg(key, value) FROM basket.cache WHERE key LIKE 'log:nba:%'" > logs.json
//   npx esbuild scripts/backtest-basket.ts --bundle --platform=node --outfile=<temporal>/bt.cjs && node <temporal>/bt.cjs logs.json
import { readFileSync } from 'node:fs';
import { BASKET_MARKETS, analyze, project, type BasketCtx, type BasketMarket } from '../src/lib/basket-model';
import { gameCtx } from '../src/lib/basket-context';
import type { BasketLogGame } from '../src/lib/types';

const file = process.argv[2];
if (!file) { console.error('Uso: node bt.cjs logs.json'); process.exit(1); }
const raw = JSON.parse(readFileSync(file, 'utf8').replace(/^﻿/, '')) as Record<string, BasketLogGame[]>;

// Partidos de cada jugador, de las dos temporadas, sin repetir
const byPlayer = new Map<string, BasketLogGame[]>();
for (const [key, games] of Object.entries(raw)) {
  const id = key.split(':')[2];
  const list = byPlayer.get(id) ?? [];
  for (const g of games) if (!list.some(x => x.id === g.id)) list.push(g);
  byPlayer.set(id, list);
}
// Calendario de cada equipo: los partidos de todos sus jugadores juntos
const teamGames = new Map<string, { id: string; date: string }[]>();
for (const games of byPlayer.values()) for (const g of games) {
  if (!g.teamId || g.type === 'pre') continue;
  const list = teamGames.get(g.teamId) ?? [];
  if (!list.some(x => x.id === g.id)) list.push({ id: g.id, date: g.date });
  teamGames.set(g.teamId, list);
}

const MARKETS: BasketMarket[] = ['pts', 'reb', 'ast', 'fg3m', 'pra', 'pr', 'pa', 'ra', 'stl', 'blk', 'tov'];
const SPLIT = +new Date('2026-02-01'); // antes: para ajustar; después (y la temporada 26-27): para comprobar
type Row = { fit: boolean; m: BasketMarket; y: number; mu: number; min: number; projMin: number; b2b: boolean; away: boolean; rest: number; back: number; muCtx: number; pBase: number; pCtx: number; line: number };
const rows: Row[] = [];

for (const games of byPlayer.values()) {
  const asc = games.filter(g => g.type !== 'pre').sort((a, b) => +new Date(a.date) - +new Date(b.date));
  for (let i = 0; i < asc.length; i++) {
    const g = asc[i];
    const prior = games.filter(x => +new Date(x.date) < +new Date(g.date));
    if (prior.filter(x => x.type !== 'pre').length < 10) continue;
    const team = g.teamId ? teamGames.get(g.teamId) ?? [] : [];
    // El contexto sale igual que en la app: sólo del registro del jugador, del calendario de su equipo y de la fecha
    const cx = gameCtx(prior, team, g.date, g.teamId);
    const base: BasketCtx = { currentSeason: g.season, home: g.home, opp: g.opp, injury: null };
    for (const m of MARKETS) {
      const P = project(prior, m, base);
      if (!P || P.mu <= 0.3) continue;
      const Pc = project(prior, m, { ...base, ...cx });
      const line = Math.floor(P.mu) + 0.5; // una línea cerca de la proyección, como las de las casas
      const A = analyze(prior, m, line, {}, base), Ac = analyze(prior, m, line, {}, { ...base, ...cx });
      if (!A || !Ac || !Pc) continue;
      rows.push({
        fit: +new Date(g.date) < SPLIT && g.season === 2026, m, y: BASKET_MARKETS[m].f(g), mu: P.mu, min: g.min, projMin: P.projMin,
        b2b: !!cx.b2b, away: g.home === false, rest: cx.rest ?? 9, back: cx.back ?? 0, muCtx: Pc.mu, pBase: A.pOver, pCtx: Ac.pOver, line
      });
    }
  }
}

// Real / proyectado en un grupo, con su error típico
function ratio(rs: Row[], y: (r: Row) => number, mu: (r: Row) => number) {
  const Y = rs.reduce((s, r) => s + y(r), 0), M = rs.reduce((s, r) => s + mu(r), 0);
  const q = Y / M;
  const se = Math.sqrt(rs.reduce((s, r) => s + (y(r) - q * mu(r)) ** 2, 0)) / M;
  return { n: rs.length, q, se };
}
const fmt = (x: { n: number; q: number; se: number }) => `${(x.q * 100 - 100).toFixed(1).padStart(5)} % ±${(x.se * 196).toFixed(1)} (n ${x.n})`;

for (const part of [true, false]) {
  console.log(`\n===== ${part ? 'AJUSTE (temporada 25-26 hasta enero)' : 'COMPROBACIÓN (febrero en adelante y 26-27)'} =====`);
  const R = rows.filter(r => r.fit === part);
  const groups: [string, (r: Row) => boolean][] = [
    ['todos', () => true], ['B2B', r => r.b2b], ['B2B fuera', r => r.b2b && r.away], ['B2B en casa', r => r.b2b && !r.away],
    ['1 día de descanso', r => r.rest === 1], ['2 días', r => r.rest === 2], ['3 o más', r => r.rest >= 3 && r.rest < 9],
    ['vuelta: 1.º partido', r => r.back === 1], ['vuelta: 2.º', r => r.back === 2], ['vuelta: 3.º', r => r.back === 3]
  ];
  console.log('grupo'.padEnd(22), 'minutos'.padEnd(26), MARKETS.map(m => m.padEnd(26)).join(''));
  for (const [name, f] of groups) {
    const rs = R.filter(f);
    const mins = ratio(rs.filter(r => r.m === 'pts'), r => r.min, r => r.projMin);
    console.log(name.padEnd(22), fmt(mins).padEnd(26), MARKETS.map(m => fmt(ratio(rs.filter(r => r.m === m), r => r.y, r => r.mu)).padEnd(26)).join(''));
  }
  // ¿Mejora la probabilidad con el contexto? Brier y log-loss de "Más de la línea", con y sin
  const score = (rs: Row[], p: (r: Row) => number) => {
    let b = 0, l = 0;
    for (const r of rs) { const o = r.y > r.line ? 1 : 0, q = Math.min(0.999, Math.max(0.001, p(r))); b += (q - o) ** 2; l -= o ? Math.log(q) : Math.log(1 - q); }
    return `Brier ${(b / rs.length).toFixed(5)} · log-loss ${(l / rs.length).toFixed(5)}`;
  };
  console.log('\nProbabilidad de "Más" (sin contexto → con contexto):');
  for (const [name, f] of [['todos', () => true], ['B2B', (r: Row) => r.b2b], ['vuelta (1.º-3.º)', (r: Row) => r.back > 0]] as [string, (r: Row) => boolean][]) {
    const rs = R.filter(f);
    console.log(`  ${name.padEnd(18)} ${score(rs, r => r.pBase)}  →  ${score(rs, r => r.pCtx)}  (n ${rs.length})`);
  }
  // Calibración con contexto: por tramos de probabilidad, lo que dijo frente a lo que salió
  console.log('\nCalibración con contexto (dijo → salió):');
  for (let lo = 0; lo < 1; lo += 0.1) {
    const rs = R.filter(r => r.pCtx >= lo && r.pCtx < lo + 0.1);
    if (rs.length < 30) continue;
    const said = rs.reduce((s, r) => s + r.pCtx, 0) / rs.length, got = rs.filter(r => r.y > r.line).length / rs.length;
    console.log(`  ${(lo * 100).toFixed(0).padStart(3)}-${((lo + 0.1) * 100).toFixed(0)} %: ${(said * 100).toFixed(1)} % → ${(got * 100).toFixed(1)} %  (n ${rs.length})`);
  }
}
