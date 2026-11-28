// Prueba del modelo de props de baloncesto con partidos pasados: para cada partido se proyecta con los partidos anteriores
// del jugador (el modelo de verdad, src/lib/basket-model.ts) y se compara con lo que hizo. Mide si el cansancio (B2B,
// pocos días de descanso) y la vuelta tras perderse partidos se notan más allá de lo que el modelo ya recoge, y si los
// factores que usa el modelo mejoran la probabilidad en un periodo distinto del que se usó para ajustarlos.
//
// Datos: los registros de jugadores de la caché del servicio basket (no se piden a ESPN), en un JSON { clave: partidos }:
//   docker compose exec -T db psql -U lolet -d lolet -At -c "SELECT json_object_agg(key, value) FROM basket.cache WHERE key LIKE 'log:nba:%'" > logs.json
//   npx esbuild scripts/backtest-basket.ts --bundle --platform=node --outfile=<temporal>/bt.cjs && node <temporal>/bt.cjs logs.json
// Los registros guardados desde noviembre de 2026 llevan `cup` (partido de la NBA Cup). Para los anteriores se puede pasar un
// segundo JSON { idPartido: eventNote de ESPN } (lo que trae el gamelog de ESPN en events[id].eventNote)
import { readFileSync } from 'node:fs';
import { BASKET_MARKETS, analyze, project, type BasketCtx, type BasketMarket } from '../src/lib/basket-model';
import { cupKind, gameCtx } from '../src/lib/basket-context';
import type { BasketLogGame } from '../src/lib/types';

const file = process.argv[2];
if (!file) { console.error('Uso: node bt.cjs logs.json'); process.exit(1); }
const raw = JSON.parse(readFileSync(file, 'utf8').replace(/^﻿/, '')) as Record<string, BasketLogGame[]>;
const notes = (process.argv[3] ? JSON.parse(readFileSync(process.argv[3], 'utf8')) : {}) as Record<string, string>;
const cupOf = (g: BasketLogGame) => g.cup ?? cupKind(notes[g.id]);

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
type Role = 'star' | 'starter' | 'rotation' | 'bench';
type Row = { fit: boolean; m: BasketMarket; y: number; mu: number; min: number; projMin: number; b2b: boolean; away: boolean; rest: number; back: number; debut: boolean; cup: 'group' | 'ko' | null; cupWeeks: boolean; muCtx: number; pBase: number; pCtx: number; line: number; role: Role; pAt?: (k: number) => number };
const rows: Row[] = [];
// Papel en el equipo por sus minutos de esta temporada antes del partido (en la NBA Cup los entrenadores dan más minutos a los
// primeros y menos a la rotación: ¿mejora la probabilidad si se tiene en cuenta?)
const roleOf = (prior: BasketLogGame[], season: number): Role => {
  const xs = prior.filter(x => x.season === season && x.type === 'reg' && x.min > 0).slice(-15);
  const m = xs.length ? xs.reduce((s, x) => s + x.min, 0) / xs.length : 0;
  return m >= 32 ? 'star' : m >= 26 ? 'starter' : m >= 18 ? 'rotation' : 'bench';
};

for (const games of byPlayer.values()) {
  const asc = games.filter(g => g.type !== 'pre').sort((a, b) => +new Date(a.date) - +new Date(b.date));
  for (let i = 0; i < asc.length; i++) {
    const g = asc[i];
    const prior = games.filter(x => +new Date(x.date) < +new Date(g.date));
    if (prior.filter(x => x.type !== 'pre').length < 10) continue;
    const team = g.teamId ? teamGames.get(g.teamId) ?? [] : [];
    // El contexto sale igual que en la app: sólo del registro del jugador, del calendario de su equipo y de la fecha
    const cx = gameCtx(prior, team, g.date, g.teamId);
    // Como en la app (gameExtras): el partido de la NBA Cup entra en el contexto
    const cupG = cupOf(g);
    const base: BasketCtx = { currentSeason: g.season, home: g.home, opp: g.opp, injury: null };
    const full: BasketCtx = { ...base, ...cx, ...(cupG ? { cup: cupG } : {}) };
    for (const m of MARKETS) {
      const P = project(prior, m, base);
      if (!P || P.mu <= 0.3) continue;
      const Pc = project(prior, m, full);
      const line = Math.floor(P.mu) + 0.5; // una línea cerca de la proyección, como las de las casas
      const A = analyze(prior, m, line, {}, base), Ac = analyze(prior, m, line, {}, full);
      if (!A || !Ac || !Pc) continue;
      const cup = cupOf(g);
      rows.push({
        fit: +new Date(g.date) < SPLIT && g.season === 2026, m, y: BASKET_MARKETS[m].f(g), mu: P.mu, min: g.min, projMin: P.projMin,
        b2b: !!cx.b2b, away: g.home === false, rest: cx.rest ?? 9, back: cx.back ?? 0, debut: !!cx.debut, cup, cupWeeks: /-(11|12)-/.test(g.date.slice(4, 8)) && g.date.slice(5, 10) <= '12-20', muCtx: Pc.mu, pBase: A.pOver, pCtx: Ac.pOver, line,
        role: roleOf(prior, g.season),
        // Probabilidad de «Más» si la proyección se multiplica por k (se aproxima moviendo la línea: line / k)
        ...(cup ? { pAt: (k: number) => analyze(prior, m, line / k, {}, { ...base, ...cx })?.pOver ?? Ac.pOver } : {})
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
    ['vuelta: 1.º partido', r => r.back === 1 && !r.debut], ['vuelta: debut de temporada', r => r.back === 1 && r.debut], ['vuelta: 2.º y 3.º tras debut', r => r.back > 1 && r.debut], ['vuelta: 2.º', r => r.back === 2], ['vuelta: 3.º', r => r.back === 3],
    ['NBA Cup: grupos', r => r.cup === 'group'], ['NBA Cup: eliminatoria', r => r.cup === 'ko'], ['liga (sin Cup)', r => !r.cup]
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
  for (const [name, f] of [['todos', () => true], ['B2B', (r: Row) => r.b2b], ['vuelta (1.º-3.º)', (r: Row) => r.back > 0 && !r.debut], ['vuelta: debut de temporada', (r: Row) => r.back > 0 && r.debut], ['NBA Cup: grupos', (r: Row) => r.cup === 'group'], ['NBA Cup: eliminatoria', (r: Row) => r.cup === 'ko'],
    ['liga, mismas semanas', (r: Row) => !r.cup && r.cupWeeks]] as [string, (r: Row) => boolean][]) {
    const rs = R.filter(f);
    console.log(`  ${name.padEnd(18)} ${score(rs, r => r.pBase)}  →  ${score(rs, r => r.pCtx)}  (n ${rs.length})`);
  }
  // NBA Cup por papel: real / proyectado en la Cup frente a la liga de las mismas semanas, y si un factor por papel ajustado con la
  // temporada 25-26 mejora la probabilidad en la otra
  console.log('\nNBA Cup por papel (real / proyectado; Cup frente a liga de las mismas semanas):');
  for (const role of ['star', 'starter', 'rotation', 'bench'] as Role[]) {
    for (const [name, f] of [['grupos', (r: Row) => r.cup === 'group'], ['eliminatoria', (r: Row) => r.cup === 'ko'], ['liga mismas semanas', (r: Row) => !r.cup && r.cupWeeks]] as [string, (r: Row) => boolean][]) {
      const rs = R.filter(r => r.role === role && f(r));
      if (rs.length < 30) continue;
      console.log(`  ${role.padEnd(9)} ${name.padEnd(20)} minutos ${fmt(ratio(rs.filter(r => r.m === 'pts'), r => r.min, r => r.projMin))}  PRA ${fmt(ratio(rs.filter(r => r.m === 'pra'), r => r.y, r => r.muCtx))}`);
    }
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

// Factor por papel para la fase de grupos: se ajusta con 25-26 (lo que se queda la Cup frente a la liga de esas semanas, en cada
// estadística) y se comprueba en 26-27. Si en 26-27 no baja la log-loss, no se usa
{
  const isFitSeason = (r: Row) => r.fit || (!r.fit && r.cup && false);
  const cupFit = rows.filter(r => r.cup === 'group' && r.fit === true), cupChk = rows.filter(r => r.cup === 'group' && !r.fit);
  const leagueFit = rows.filter(r => !r.cup && r.cupWeeks && r.fit);
  const K = new Map<string, number>();
  for (const role of ['star', 'starter', 'rotation', 'bench'] as Role[]) for (const m of MARKETS) {
    const c = cupFit.filter(r => r.role === role && r.m === m), l = leagueFit.filter(r => r.role === role && r.m === m);
    if (c.length < 20 || l.length < 50) continue;
    const kc = ratio(c, r => r.y, r => r.muCtx).q, kl = ratio(l, r => r.y, r => r.muCtx).q;
    // Encogido a la mitad hacia 1: con tan pocos partidos de Cup, la mitad del efecto como mucho
    K.set(`${role}|${m}`, 1 + (kc / kl - 1) / 2);
  }
  const score = (rs: Row[], p: (r: Row) => number) => {
    let l = 0;
    for (const r of rs) { const o = r.y > r.line ? 1 : 0, q = Math.min(0.999, Math.max(0.001, p(r))); l -= o ? Math.log(q) : Math.log(1 - q); }
    return (l / rs.length).toFixed(5);
  };
  void isFitSeason;
  console.log('\n===== NBA Cup, factor por papel (ajuste 25-26 → comprobación 26-27) =====');
  console.log('factores:', [...K].map(([k, v]) => `${k} ${v.toFixed(3)}`).join(', '));
  for (const [name, rs] of [['ajuste', cupFit], ['comprobación', cupChk]] as [string, Row[]][]) {
    const withK = rs.filter(r => K.has(`${r.role}|${r.m}`) && r.pAt);
    console.log(`  ${name.padEnd(13)} log-loss sin factor ${score(withK, r => r.pCtx)} → con factor ${score(withK, r => r.pAt!(K.get(`${r.role}|${r.m}`)!))}  (n ${withK.length})`);
  }
  // Más sencillo (menos riesgo de aprenderse el ruido): un solo factor por papel, el de PRA, para todas las estadísticas
  const KR = new Map<Role, number>();
  for (const role of ['star', 'starter', 'rotation', 'bench'] as Role[]) {
    const c = cupFit.filter(r => r.role === role && r.m === 'pra'), l = leagueFit.filter(r => r.role === role && r.m === 'pra');
    if (c.length >= 20 && l.length >= 50) KR.set(role, 1 + (ratio(c, r => r.y, r => r.muCtx).q / ratio(l, r => r.y, r => r.muCtx).q - 1) / 2);
  }
  console.log('un factor por papel:', [...KR].map(([k, v]) => `${k} ${v.toFixed(3)}`).join(', '));
  for (const [name, rs] of [['ajuste', cupFit], ['comprobación', cupChk]] as [string, Row[]][]) {
    const withK = rs.filter(r => KR.has(r.role) && r.pAt);
    console.log(`  ${name.padEnd(13)} log-loss sin factor ${score(withK, r => r.pCtx)} → con factor ${score(withK, r => r.pAt!(KR.get(r.role)!))}  (n ${withK.length})`);
    for (const role of KR.keys()) {
      const x = withK.filter(r => r.role === role);
      console.log(`    ${role.padEnd(9)} ${score(x, r => r.pCtx)} → ${score(x, r => r.pAt!(KR.get(role)!))}  (n ${x.length})`);
    }
  }
}
