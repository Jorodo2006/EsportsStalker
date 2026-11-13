// Modelo de props de jugador de baloncesto (adaptado de courtside-edge): proyección ponderada por recencia y minutos,
// ajuste local / visitante y por rival, probabilidad de la línea mezclada con la frecuencia histórica,
// y el valor, la fiabilidad y el veredicto con las funciones comunes de value.ts.
import type { BasketLogGame, BasketTeamLogs, MatchOdds } from './types';
import type { GameCtx } from './basket-context';
import { devig, devigBooks, lineProbs, relCommon, reliability, sideValue, tooFar, verdict, type Side, type SideValue } from './value';

type G = BasketLogGame;

// Cuánto pesa el modelo frente a la casa sin margen al calcular el valor. Con las primeras 633 recomendaciones reales de la NBA
// (noviembre de 2026, unos 15 partidos: es poco) la casa sola acertó más que cualquier mezcla en los "más", y en los "menos"
// lo mejor fue 0,2-0,3; con 0,4 se recomendaba el doble y se perdía. Se baja a 0,3, como en tenis y fútbol (0,25). Hay que
// volver a medirlo con «Todas las líneas» en Acierto del modelo cuando haya unos miles resueltas
const MODEL_WEIGHT = 0.3;
const THIN_WEIGHT = 0.15; // con poca muestra, todavía menos
const THIN_GAMES = 10;
export const BASKET_MARKETS: Record<string, { label: string; short: string; f: (g: G) => number }> = {
  pts: { label: 'Puntos', short: 'PTS', f: g => g.pts },
  reb: { label: 'Rebotes', short: 'REB', f: g => g.reb },
  ast: { label: 'Asistencias', short: 'AST', f: g => g.ast },
  fg3m: { label: 'Triples anotados', short: '3PM', f: g => g.fg3m },
  pra: { label: 'Pts + Reb + Ast', short: 'PRA', f: g => g.pts + g.reb + g.ast },
  pr: { label: 'Pts + Reb', short: 'P+R', f: g => g.pts + g.reb },
  pa: { label: 'Pts + Ast', short: 'P+A', f: g => g.pts + g.ast },
  ra: { label: 'Reb + Ast', short: 'R+A', f: g => g.reb + g.ast },
  stl: { label: 'Robos', short: 'STL', f: g => g.stl },
  blk: { label: 'Tapones', short: 'BLK', f: g => g.blk },
  sb: { label: 'Robos + Tapones', short: 'S+B', f: g => g.stl + g.blk },
  tov: { label: 'Pérdidas', short: 'TOV', f: g => g.tov }
};
export type BasketMarket = keyof typeof BASKET_MARKETS;

// El contexto del partido (descanso, vuelta tras baja) sale de gameCtx en basket-context.ts, igual en todas las pantallas
// matesOut: compañeros importantes de baja desde hace poco (basket-mates.ts). No cambian la proyección (no está medido cuánto),
// pero bajan la fiabilidad de los "menos": la proyección sale de partidos en los que ellos jugaban
export interface BasketCtx extends GameCtx { currentSeason: number; home: boolean | null; opp: string | null; injury: string | null; matesOut?: string[] }

// Cuánto cambia lo que hace un jugador con el cansancio y al volver de una baja, por mercado, frente a lo que ya proyecta
// el modelo. Medido con scripts/backtest-basket.ts (ajuste: temporada 25-26 hasta enero; comprobación: el resto); 1 = no
// se nota y no se aplica
// - B2B: al contrario de lo que se suele pensar, rinden algo MÁS de lo proyectado (ajuste: PRA +2,7 % ±2,4, minutos +2,2 %;
//   comprobación: +5,9 % y +5,0 %). Quien juega el segundo de un B2B está sano y tiene minutos; los que descansan no salen
// - 1.er partido tras perderse 3 o más: −11/−13 % en todo y −13 % de minutos (en los dos periodos). 2.º: algo menos. 3.º: normal
// Lo medido en el ajuste se encoge un 20 % hacia 1 para no pasarse
const CTX_FACTORS: Record<'b2b' | 'back1' | 'back2', Partial<Record<BasketMarket, number>>> = {
  b2b: { pts: 1.02, reb: 1.02, pra: 1.02, pr: 1.02, pa: 1.02, ra: 1.02 },
  back1: { pts: 0.91, reb: 0.91, ast: 0.9, fg3m: 0.93, pra: 0.91, pr: 0.91, pa: 0.91, ra: 0.9, stl: 0.93, blk: 0.92, sb: 0.92, tov: 0.92 },
  back2: { pts: 0.93, reb: 0.95, ast: 0.93, fg3m: 0.97, pra: 0.93, pr: 0.93, pa: 0.93, ra: 0.93, stl: 0.95, blk: 0.95, sb: 0.95, tov: 0.95 }
};
function ctxFactors(market: BasketMarket, ctx: BasketCtx) {
  const out: { label: string; f: number; n: number }[] = [];
  const f = (k: keyof typeof CTX_FACTORS) => CTX_FACTORS[k][market] ?? 1;
  if (ctx.b2b && f('b2b') !== 1) out.push({ label: 'B2B', f: f('b2b'), n: 0 });
  if (ctx.back === 1 && f('back1') !== 1) out.push({ label: '1.er partido tras baja', f: f('back1'), n: 0 });
  if (ctx.back === 2 && f('back2') !== 1) out.push({ label: '2.º partido tras baja', f: f('back2'), n: 0 });
  return out;
}

const sum = (a: number[]) => a.reduce((s, v) => s + v, 0);
const mean = (a: number[]) => (a.length ? sum(a) / a.length : 0);
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
export const wmean = (xs: number[], ws: number[]) => { const W = sum(ws); return W ? sum(xs.map((x, i) => x * ws[i])) / W : 0; };
export function wvar(xs: number[], ws: number[]) {
  const m = wmean(xs, ws), W = sum(ws), W2 = sum(ws.map(w => w * w));
  const denom = W - W2 / W; // corrección de sesgo con pesos
  return denom > 0 ? sum(xs.map((x, i) => ws[i] * (x - m) ** 2)) / denom : 0;
}
const std = (a: number[]) => { if (a.length < 2) return 0; const m = mean(a); return Math.sqrt(sum(a.map(x => (x - m) ** 2)) / (a.length - 1)); };

// Ajustes de la proyección, medidos con scripts/calib-basket.ts (se exportan para que la prueba pueda cambiarlos):
// - carry / carryMin: lo que vale un partido de la temporada pasada al proyectar esta (estadística y minutos). Los que siguen
//   de un año a otro juegan menos: les quitan minutos los novatos y los fichajes, y son un año mayores
// - curWeight: cuánto más pesa un partido de esta temporada que uno de la pasada
// - minPivot / minPull: los minutos muy altos vuelven hacia la media (descansos, palizas, faltas)
export const PROJ = { carry: 0.88, carryMin: 0.92, curWeight: 1.6, minPivot: 30, minPull: 0.15, varMult: 1.2 };

// Muestra: sin pretemporada salvo que no haya otra cosa; vida media de 10 partidos, esta temporada pesa más (PROJ.curWeight)
function buildSample(games: G[], currentSeason: number) {
  let pool = games.filter(g => g.type !== 'pre');
  let usedPreseason = false;
  if (pool.length < 3) { pool = games.slice(); usedPreseason = pool.some(g => g.type === 'pre'); }
  pool = pool.slice().sort((a, b) => +new Date(b.date) - +new Date(a.date)).slice(0, 70);
  const weights = pool.map((g, i) => {
    let w = Math.pow(0.5, i / 10);
    if (g.season === currentSeason) w *= PROJ.curWeight;
    if (g.type === 'post') w *= 0.85;
    if (g.type === 'pre') w *= 0.5;
    return w;
  });
  return { pool, weights, usedPreseason };
}

// Factor de un subconjunto (en casa, contra el rival) encogido hacia 1 según su tamaño
function shrink(subset: number[], all: number[], k: number, lo: number, hi: number) {
  const mAll = mean(all);
  if (!subset.length || mAll <= 0) return { f: 1, n: subset.length };
  const n = subset.length;
  return { f: clamp(1 + (mean(subset) / mAll - 1) * (n / (n + k)), lo, hi), n };
}

export function project(games: G[], market: BasketMarket, ctx: BasketCtx) {
  const M = BASKET_MARKETS[market];
  const { pool, weights, usedPreseason } = buildSample(games, ctx.currentSeason);
  if (!pool.length) return null;
  const old = (g: G) => g.season < ctx.currentSeason;
  const val = (g: G) => M.f(g) * (old(g) ? PROJ.carry : 1);
  const xs = pool.map(val), mins = pool.map(g => g.min * (old(g) ? PROJ.carryMin : 1));
  const wAvg = wmean(xs, weights), wMin = wmean(mins, weights), last5Min = mean(mins.slice(0, 5));
  let projMin = pool.length >= 5 ? 0.6 * last5Min + 0.4 * wMin : wMin;
  if (projMin > PROJ.minPivot) projMin -= PROJ.minPull * (projMin - PROJ.minPivot);
  const perMin = sum(xs.map((x, i) => x * weights[i])) / Math.max(1e-9, sum(mins.map((m, i) => m * weights[i])));
  // Mitad media directa, mitad ritmo por minuto × minutos previstos: así se nota un cambio de rol
  let mu = 0.5 * wAvg + 0.5 * perMin * projMin;
  const factors: { label: string; f: number; n: number }[] = [];
  if (ctx.home != null) {
    const loc = shrink(pool.filter(g => g.home === ctx.home).map(val), xs, 15, 0.94, 1.06);
    mu *= loc.f;
    factors.push({ label: ctx.home ? 'En casa' : 'Fuera', ...loc });
  }
  if (ctx.opp) {
    const h2h = shrink(pool.filter(g => g.opp === ctx.opp).map(val), xs, 8, 0.9, 1.1);
    mu *= h2h.f;
    factors.push({ label: `Contra ${ctx.opp}`, ...h2h });
  }
  for (const c of ctxFactors(market, ctx)) { mu *= c.f; factors.push(c); }
  const W = sum(weights), neff = (W * W) / sum(weights.map(w => w * w));
  let variance = Math.max(wvar(xs, weights), mu * 0.9);
  variance *= (1 + 2 / Math.max(neff, 1)) * PROJ.varMult; // más incertidumbre con muestras cortas
  return { mu, sigma: Math.sqrt(variance), neff, projMin, wMin, last5Min, factors, pool, weights, xs, usedPreseason };
}

export interface BasketAnalysis {
  mu: number; sigma: number; projMin: number;
  factors: { label: string; f: number; n: number }[];
  pOver: number; pUnder: number; pPush: number; fairOver: number; fairUnder: number;
  modelOver: number; histOver: number;
  market: ReturnType<typeof devig>;
  sides: SideValue[];
  rel: ReturnType<typeof reliability>; // la del lado con más valor
  relBySide: Record<Side, ReturnType<typeof reliability>>;
  verdict: ReturnType<typeof verdict>;
  // hit: proporción de partidos por encima de la línea; under, por debajo (con línea entera no suman 1: el resto son nulas)
  splits: { label: string; n: number; avg: number | null; hit: number | null; under: number | null; min: number | null }[];
  ladder: { line: number; pOver: number; fairOver: number; fairUnder: number }[];
}

// odds.books: las cuotas de cada casa en esa línea. Con ellas la probabilidad de la casa sale de quitar a cada una su margen
// (devigBooks), y no depende de qué cuota se esté mirando; over / under son las que se pagarían
export type LineOdds = { over?: number | null; under?: number | null; book?: string; books?: { over?: number | null; under?: number | null }[] };
export function analyze(games: G[], market: BasketMarket, line: number, odds: LineOdds, ctx: BasketCtx): BasketAnalysis | null {
  const P = project(games, market, ctx);
  if (!P) return null;
  const { mu, sigma, neff, pool, weights, xs } = P;
  const model = lineProbs(mu, sigma, line);

  const W = sum(weights);
  const empOver = sum(xs.map((x, i) => (x > line ? weights[i] : 0))) / W;
  const empUnder = sum(xs.map((x, i) => (x < line ? weights[i] : 0))) / W;
  // Mezcla: el modelo cuenta como 10 partidos frente a la frecuencia ponderada
  const K = 10;
  let pOver = (neff * empOver + K * model.over) / (neff + K);
  let pUnder = (neff * empUnder + K * model.under) / (neff + K);
  const pPush = model.push;
  const norm = (pOver + pUnder) / Math.max(1e-9, 1 - pPush);
  pOver = clamp(pOver / norm, 0.02, 0.98);
  pUnder = clamp(pUnder / norm, 0.02, 0.98);

  const mk = odds.books?.length ? devigBooks(odds.books) : devig(odds.over, odds.under);
  const w = pool.length < THIN_GAMES ? THIN_WEIGHT : MODEL_WEIGHT;
  const sides: SideValue[] = [];
  if (odds.over && odds.over > 1) sides.push(sideValue('over', pOver, pPush, odds.over, mk.over, odds.book, w));
  if (odds.under && odds.under > 1) sides.push(sideValue('under', pUnder, pPush, odds.under, mk.under, odds.book, w));

  const cur = pool.filter(g => g.season === ctx.currentSeason && g.type === 'reg');
  const recentMins = pool.slice(0, 10).map(g => g.min);
  const cvMin = mean(recentMins) > 0 ? std(recentMins) / mean(recentMins) : 1;
  const penalties: { pts: number; warning: string }[] = [];
  if (ctx.injury && !/active/i.test(ctx.injury)) penalties.push({ pts: 20, warning: `Estado médico: ${ctx.injury}` });
  if (P.wMin > 0 && Math.abs(P.last5Min - P.wMin) / P.wMin > 0.18)
    penalties.push({ pts: 8, warning: `Cambio de rol: ${P.last5Min.toFixed(1)} min en los últimos 5 frente a ${P.wMin.toFixed(1)} de media` });
  if (P.usedPreseason) penalties.push({ pts: 15, warning: 'La muestra incluye partidos de pretemporada' });
  const far = sides.find(s => s.gap != null && tooFar(s.pModel, s.pModel - s.gap));
  if (far) penalties.push({ pts: 25, warning: `El modelo se aleja mucho de la casa (${Math.round(far.pModel * 100)} % frente a ${Math.round((far.pModel - far.gap!) * 100)} %): lo normal es que ella sepa algo que él no` });
  const relFactors = [
    { label: 'Muestra esta temporada', value01: cur.length / 10, max: 25, note: `${cur.length} partido${cur.length === 1 ? '' : 's'} de liga regular` },
    { label: 'Historial total', value01: pool.length / 40, max: 15, note: `${pool.length} partidos analizados` },
    relCommon.consistency(mu, sigma),
    { label: 'Minutos estables', value01: 1 - (cvMin - 0.08) / 0.3, max: 15, note: `${mean(recentMins).toFixed(1)} min ± ${std(recentMins).toFixed(1)}` },
    relCommon.distance(mu, sigma, line),
    relCommon.agreement(model.over, empOver)
  ];
  const mates = ctx.matesOut ?? [];
  const matePenalty = mates.length ? [{ pts: Math.min(25, 10 + 5 * mates.length), warning: `Baja${mates.length > 1 ? 's' : ''} reciente${mates.length > 1 ? 's' : ''} de ${mates.join(', ')}: la proyección sale de partidos con ${mates.length > 1 ? 'ellos' : 'él'} y no cuenta que ahora le pueden llegar más balones y minutos` }] : [];
  const relBySide = { over: reliability(relFactors, penalties), under: reliability(relFactors, [...penalties, ...matePenalty]) };
  const bestSide = sides.slice().sort((a, b) => b.ev - a.ev)[0]?.side ?? (pOver >= pUnder ? 'over' : 'under');
  const rel = relBySide[bestSide];

  const M = BASKET_MARKETS[market];
  const reg = games.filter(g => g.type !== 'pre');
  const split = (label: string, arr: G[]) => {
    const v = arr.map(M.f);
    return { label, n: arr.length, avg: v.length ? mean(v) : null, hit: v.length ? v.filter(x => x > line).length / v.length : null, under: v.length ? v.filter(x => x < line).length / v.length : null, min: arr.length ? mean(arr.map(g => g.min)) : null };
  };
  const splits = [
    split('Últimos 5', reg.slice(0, 5)),
    split('Últimos 10', reg.slice(0, 10)),
    split('Últimos 20', reg.slice(0, 20)),
    split('Esta temporada', reg.filter(g => g.season === ctx.currentSeason)),
    split('Temporada pasada', reg.filter(g => g.season === ctx.currentSeason - 1)),
    split('En casa', reg.slice(0, 40).filter(g => g.home === true)),
    split('Fuera', reg.slice(0, 40).filter(g => g.home === false))
  ];
  if (ctx.opp) splits.push(split(`Contra ${ctx.opp}`, reg.filter(g => g.opp === ctx.opp)));

  // Escalera: probabilidades y cuotas justas de las líneas de alrededor de la proyección
  const ladder: BasketAnalysis['ladder'] = [];
  const step = mu >= 12 ? 1 : 0.5, center = Math.round(mu / step) * step;
  for (let i = -3; i <= 3; i++) {
    const L = Math.floor(center + i * step) + 0.5;
    if (L < 0.5 || ladder.some(r => r.line === L)) continue;
    const lp = lineProbs(mu, sigma, L);
    ladder.push({ line: L, pOver: lp.over, fairOver: 1 / lp.over, fairUnder: 1 / lp.under });
  }

  return {
    mu, sigma, projMin: P.projMin, factors: P.factors,
    pOver, pUnder, pPush, fairOver: (1 - pPush) / pOver, fairUnder: (1 - pPush) / pUnder,
    modelOver: model.over, histOver: empOver, market: mk, sides, rel, relBySide,
    verdict: verdict(sides, rel.score, line, pOver >= pUnder ? 'over' : 'under'),
    splits, ladder
  };
}

// Resumen de todos los mercados de un jugador: proyección, rango del 80 % y regularidad
export function scanMarkets(games: G[], ctx: BasketCtx) {
  return (Object.keys(BASKET_MARKETS) as BasketMarket[]).flatMap(k => {
    const P = project(games, k, ctx);
    if (!P) return [];
    const cv = P.mu > 0 ? P.sigma / P.mu : 9;
    return [{
      key: k, ...BASKET_MARKETS[k], mu: P.mu, range: [Math.max(0, P.mu - 1.2816 * P.sigma), P.mu + 1.2816 * P.sigma] as [number, number],
      l10: mean(P.pool.slice(0, 10).map(BASKET_MARKETS[k].f)), consistency: cv < 0.3 ? 'Alta' : cv < 0.5 ? 'Media' : 'Baja'
    }];
  });
}

// Una línea de un jugador para el escáner, con el mismo cálculo que el analizador: las dos pantallas dan la misma probabilidad
export function scanLine(games: G[], market: BasketMarket, line: number, side: Side, ctx: BasketCtx, odds: LineOdds = {}) {
  const R = analyze(games, market, line, odds, ctx);
  if (!R) return null;
  const f = BASKET_MARKETS[market].f;
  const reg = games.filter(g => g.type !== 'pre');
  const hit = (list: G[]) => ({ n: list.length, won: list.filter(g => (side === 'over' ? f(g) > line : f(g) < line)).length });
  return {
    mu: R.mu, projMin: R.projMin, rel: R.relBySide[side], push: R.pPush,
    p: side === 'over' ? R.pOver : R.pUnder, fair: side === 'over' ? R.fairOver : R.fairUnder,
    value: R.sides.find(s => s.side === side) ?? null,
    played: reg.length, last5: hit(reg.slice(0, 5)), last10: hit(reg.slice(0, 10)), season: hit(reg.filter(g => g.season === ctx.currentSeason))
  };
}

// Línea sugerida: la media proyectada redondeada a x,5
export const suggestedLine = (games: G[], market: BasketMarket, ctx: BasketCtx) => {
  const P = project(games, market, ctx);
  return P ? Math.floor(P.mu) + 0.5 : null;
};

export const fmtLine = (n: number) => String(n).replace('.', ',');
// "+4,5" es Más de 4,5 y "-4.5", Menos de 4,5: el signo se traduce a lado y aquí sólo queda el número
export const parseLine = (s: string) => { const n = parseFloat(s.trim().replace(/^[+-]\s*/, '').replace(',', '.')); return Number.isFinite(n) && n >= 0 ? n : null; };

// Los que faltan a los últimos partidos de su equipo: es el único aviso de baja en la Euroliga, donde la API no las da
export function missedByPlayer(t: BasketTeamLogs) {
  const season = t.players.flatMap(p => p.games).filter(g => g.season === t.currentSeason && g.type !== 'pre');
  const games = [...new Map(season.map(g => [g.id, g.date])).entries()].sort((a, b) => +new Date(b[1]) - +new Date(a[1])).map(([id]) => id);
  return new Map(t.players.map(p => {
    const own = new Set(p.games.map(g => g.id));
    let n = 0;
    while (n < games.length && !own.has(games[n])) n++;
    return [p.id, n];
  }));
}

// Baja segura: lesionado, sancionado o sin jugar los últimos 3 partidos de su equipo
export const playerOut = (injury: string | null | undefined, missed: number) => (!!injury && /out|suspen/i.test(injury)) || missed >= 3;

// Una línea de jugador en las casas: la mejor cuota de cada lado (y de qué casa es) y lo que da cada casa
export interface CasaLine { line: number; over?: number; under?: number; overBook?: string; underBook?: string; books: Record<string, { over?: number; under?: number }> }

// Líneas de un jugador que tienen las casas, para rellenar el analizador: { "Puntos": [{ line, over, under, books }] }
export function playerLines(odds: MatchOdds | undefined, name: string) {
  // Sin "Jr." ni "III": ESPN y las casas no siempre lo ponen
  const bare = (s: string) => s.trim().replace(/\s+(jr|sr|ii|iii|iv)\.?$/i, '');
  const norm = (s: string) => bare(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z]/g, '');
  const n = norm(name), last = norm(bare(name).split(' ').slice(-1)[0] || '');
  const out: Record<string, CasaLine[]> = {};
  for (const m of odds?.markets ?? []) {
    if (!m.key.startsWith('player|') || m.line == null) continue;
    const [, stat, who] = m.key.split('|');
    const w = norm(who);
    if (w !== n && !(last.length >= 4 && w.endsWith(last) && w[0] === n[0])) continue;
    // Una casa puede escribir el nombre de otra forma ("Trey Murphy III" / "Trey Murphy"): misma línea, se juntan
    const list = (out[stat] ??= []);
    let row = list.find(r => r.line === m.line);
    if (!row) list.push(row = { line: m.line, books: {} });
    for (const side of ['over', 'under'] as const) {
      for (const [book, price] of Object.entries(m.outcomes.find(o => o.id === side)?.prices ?? {})) {
        if (!(price > 1)) continue;
        (row.books[book] ??= {})[side] = price;
        if (!(row[side]! >= price)) { row[side] = price; row[side === 'over' ? 'overBook' : 'underBook'] = book; }
      }
    }
  }
  return out;
}
