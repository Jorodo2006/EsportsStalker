// Plan de apuestas por objetivo: reparte el dinero entre las recomendaciones de las próximas 48 h para intentar llegar a un
// beneficio, y dice con qué probabilidad se llega. Todo son funciones puras (sin red ni reloj propio), con sus pruebas en plan.test.ts.

export type PlanSport = 'tennis' | 'football' | 'mma' | 'basket';

export interface PlanPick {
  id: string; sport: PlanSport;
  // match identifica el partido (clave de «una sola apuesta por partido»); event es sólo la etiqueta «A vs B»
  match: string; event: string; league: string; title: string;
  start: string; book: string; price: number; p: number; ev: number; rel: number;
}

// Una apuesta sencilla (1 pata) o una combinada: cuota y probabilidad son el producto de las patas
export interface Ticket { legs: PlanPick[]; price: number; p: number; stake: number; toReturn: number }

export type RiskLevel = 'bajo' | 'medio' | 'alto' | 'muy alto';
export interface Risk { pReach: number; pProfit: number; pLoseAll: number; expectedReturn: number; level: RiskLevel; message: string }
export interface Plan { budget: number; target: number; tickets: Ticket[]; risk: Risk; warnings: string[]; eligible: number }

// Las cuotas sólo se leen para lo que empieza pronto: es la ventana del plan
export const WINDOW_HOURS = 48;
const HOUR = 3600_000;
const MAX_TICKETS = 12;

// Filtro de elegibles. No se filtra por veredicto: con datos reales casi todas las más fiables son «No apostar» (cuota 1,15-1,22
// y valor esperado cerca de −6 %), y el plan se quedaría sin apuestas. El valor esperado negativo se avisa aparte (planWarnings)
export function isEligible(p: PlanPick, now: number): boolean {
  const t = Date.parse(p.start);
  if (!Number.isFinite(t)) return false;
  return t > now && t < now + WINDOW_HOURS * HOUR && p.rel >= 45 && p.ev >= -0.10 && p.price >= 1.10 && p.price <= 15;
}

export function poolStats(pool: PlanPick[], now: number): Record<PlanSport, { matches: number; picks: number }> {
  const seen: Record<PlanSport, Set<string>> = { tennis: new Set(), football: new Set(), mma: new Set(), basket: new Set() };
  const out: Record<PlanSport, { matches: number; picks: number }> = {
    tennis: { matches: 0, picks: 0 }, football: { matches: 0, picks: 0 }, mma: { matches: 0, picks: 0 }, basket: { matches: 0, picks: 0 }
  };
  for (const p of pool) {
    if (!isEligible(p, now)) continue;
    out[p.sport].picks++;
    seen[p.sport].add(p.match);
  }
  for (const s of Object.keys(out) as PlanSport[]) out[s].matches = seen[s].size;
  return out;
}

export function ticketOf(legs: PlanPick[], stake: number): Ticket {
  const price = legs.reduce((a, l) => a * l.price, 1);
  const p = legs.reduce((a, l) => a * l.p, 1);
  return { legs, price, p, stake, toReturn: stake * price };
}

// Umbrales sobre la probabilidad de llegar al objetivo: a partir de 60 % se considera que lo normal es llegar; por debajo de 15 %
// lo normal es no llegar. Los tramos intermedios son decisión de diseño, no una medida
export function levelOf(pReach: number): RiskLevel {
  if (pReach >= 0.6) return 'bajo';
  if (pReach >= 0.35) return 'medio';
  if (pReach >= 0.15) return 'alto';
  return 'muy alto';
}

const pctText = (v: number) => (v > 0 && v < 0.005 ? 'menos del 1 %' : `${Math.round(v * 100)} %`);

interface Dist { pReach: number; pProfit: number; pLoseAll: number; expectedReturn: number }

// Distribución exacta de lo devuelto. Como el plan usa un solo partido por apuesta, los tickets son independientes: se van
// duplicando los resultados posibles ticket a ticket (2ⁿ, con n ≤ 12)
function distOf(tickets: Ticket[], budget: number, target: number): Dist {
  let rets = [0];
  let probs = [1];
  for (const t of tickets) {
    const n = rets.length;
    const r2 = new Array<number>(n * 2);
    const p2 = new Array<number>(n * 2);
    for (let i = 0; i < n; i++) {
      r2[i] = rets[i]; p2[i] = probs[i] * (1 - t.p);
      r2[n + i] = rets[i] + t.toReturn; p2[n + i] = probs[i] * t.p;
    }
    rets = r2; probs = p2;
  }
  const need = budget + target - 1e-9;
  let pReach = 0, pProfit = 0, pLose = 0, exp = 0;
  for (let i = 0; i < rets.length; i++) {
    if (rets[i] >= need) pReach += probs[i];
    if (rets[i] > budget + 1e-9) pProfit += probs[i];
    if (rets[i] === 0) pLose += probs[i];
    exp += rets[i] * probs[i];
  }
  if (!tickets.length) return { pReach: 0, pProfit: 0, pLoseAll: 1, expectedReturn: 0 };
  return { pReach, pProfit, pLoseAll: pLose, expectedReturn: exp };
}

export function riskOf(tickets: Ticket[], budget: number, target: number): Risk {
  const d = distOf(tickets, budget, target);
  const level = levelOf(d.pReach);
  const lead = {
    'bajo': 'Es probable', 'medio': 'Es posible, pero incierto', 'alto': 'Es poco probable', 'muy alto': 'Es muy improbable'
  }[level];
  return { ...d, level, message: `${lead}: probabilidad de llegar al objetivo, ${pctText(d.pReach)}.` };
}

const num1 = (x: number) => String(Math.round(x * 10) / 10).replace('.', ',');

export function planWarnings(risk: Risk, budget: number, target: number): string[] {
  const out: string[] = [];
  const need = 1 + target / budget;
  if (need > 3) out.push(`El objetivo exige multiplicar el dinero por ${need.toFixed(1).replace('.', ',')}: con cuotas normales sólo se consigue con varias combinadas y una probabilidad muy baja.`);
  if (risk.expectedReturn < budget) {
    const per100 = budget > 0 ? (risk.expectedReturn / budget) * 100 : 0;
    out.push(`De media, este plan devuelve ${num1(per100)} € por cada 100 € puestos: a la larga se pierde dinero.`);
  }
  out.push('Las probabilidades son las del modelo, que puede equivocarse; se supone que las apuestas son independientes entre sí y las cuotas pueden haber cambiado desde que se leyeron.');
  return out;
}

// «100», «100,5» o «100.50». Hasta 2 decimales, más de 0 y como mucho 1.000.000
export function parseEuros(text: string): number | null {
  const t = text.trim();
  if (!/^\d+([.,]\d{1,2})?$/.test(t)) return null;
  const v = Number(t.replace(',', '.'));
  return v > 0 && v <= 1_000_000 ? v : null;
}

// ---- Reparto ----

// Una apuesta por partido (la de más probabilidad): así los tickets son independientes y una combinada nunca repite partido
function onePerMatch(list: PlanPick[]): PlanPick[] {
  const best = new Map<string, PlanPick>();
  for (const p of list) {
    const cur = best.get(p.match);
    if (!cur || p.p > cur.p || (p.p === cur.p && p.ev > cur.ev)) best.set(p.match, p);
  }
  return [...best.values()].sort((a, b) => b.p - a.p || b.ev - a.ev || (a.id < b.id ? -1 : 1));
}

// Fracciones del dinero (suman 1) con tope del 60 % por ticket cuando hay 3 o más: lo que sobra pasa a los demás
function capShares(shares: number[]): number[] {
  if (shares.length < 3) return shares;
  const s = [...shares];
  for (let k = 0; k < 20; k++) {
    let excess = 0, room = 0;
    for (const x of s) { if (x > 0.6) excess += x - 0.6; else room += x; }
    if (excess < 1e-12) break;
    for (let i = 0; i < s.length; i++) s[i] = s[i] > 0.6 ? 0.6 : s[i] + (room > 0 ? excess * (s[i] / room) : excess / s.length);
  }
  return s;
}

// Importes en céntimos que suman exactamente el total: se reparte por el resto mayor y, si el tope se pasaría de un céntimo,
// el céntimo va a otro ticket. null si algún ticket se queda sin ni un céntimo
function toCents(shares: number[], budget: number, capped: boolean): number[] | null {
  const total = Math.round(budget * 100);
  const exact = shares.map(f => f * total);
  const cents = exact.map(Math.floor);
  let left = total - cents.reduce((a, b) => a + b, 0);
  const order = exact.map((x, i) => ({ i, r: x - Math.floor(x) })).sort((a, b) => b.r - a.r || a.i - b.i);
  const limit = Math.floor(0.6 * total + 0.5);
  let guard = 0;
  while (left > 0 && guard++ < 10_000) {
    const slot = order.find(o => !capped || cents[o.i] + 1 <= limit) ?? order[order.length - 1];
    cents[slot.i]++; left--;
    order.push(order.shift()!);
  }
  return cents.every(c => c >= 1) ? cents : null;
}

type Scheme = (legs: PlanPick[][]) => number[];

// Formas de repartir el dinero entre los tickets de una estructura: a partes iguales, o para que cada ticket devuelva lo mismo
// (lo que hace falta cuando basta con que ganen unos cuantos), con distinto peso para las combinadas
const normalize = (w: number[]) => { const s = w.reduce((a, b) => a + b, 0); return w.map(x => x / s); };
const price = (legs: PlanPick[]) => legs.reduce((a, l) => a * l.price, 1);
const SCHEMES: Scheme[] = [
  t => normalize(t.map(() => 1)),
  t => normalize(t.map(l => 1 / price(l))),
  ...[0.1, 0.25, 0.4, 0.7].map<Scheme>(f => t => {
    const combos = t.map(l => l.length > 1), nc = combos.filter(Boolean).length;
    if (!nc || nc === t.length) return normalize(t.map(l => 1 / price(l)));
    const wc = normalize(t.map((l, i) => (combos[i] ? 1 / price(l) : 0)));
    const ws = normalize(t.map((l, i) => (combos[i] ? 0 : 1 / price(l))));
    return t.map((_, i) => (combos[i] ? f * wc[i] : (1 - f) * ws[i]));
  })
];

// Estructuras candidatas, sobre las mejores apuestas ordenadas por probabilidad: sólo sencillas; una combinada de 2 a 8 patas más
// sencillas; dos combinadas más sencillas. No dependen del objetivo, así que pedir más nunca da más probabilidad (monotonía)
function structures(L: PlanPick[]): PlanPick[][][] {
  const out: PlanPick[][][] = [];
  const n = L.length;
  const singles = (from: number, count: number) => L.slice(from, from + count).map(p => [p]);
  for (let k = 1; k <= Math.min(n, 10); k++) out.push(singles(0, k));
  for (let c = 2; c <= Math.min(n, 8); c++) {
    for (let s = 0; s <= Math.min(n - c, 9); s++) {
      out.push([L.slice(0, c), ...singles(c, s)]);
      if (s > 0) out.push([...singles(0, s), L.slice(s, s + c)].filter(t => t.length === 1 || t.length === c));
    }
  }
  for (let c1 = 2; c1 <= 4; c1++) {
    for (let c2 = 2; c2 <= 4; c2++) {
      if (c1 + c2 > n) continue;
      for (let s = 0; s <= Math.min(n - c1 - c2, 6); s++) out.push([L.slice(0, c1), L.slice(c1, c1 + c2), ...singles(c1 + c2, s)]);
    }
  }
  return out.filter(st => st.length >= 1 && st.length <= MAX_TICKETS);
}

function emptyPlan(budget: number, target: number, eligible: number, why = 'No hay apuestas disponibles en las próximas 48 horas para armar un plan.'): Plan {
  const risk = riskOf([], budget, target);
  return { budget, target, tickets: [], risk, eligible, warnings: [why] };
}

// Lo que elige el usuario: qué deportes entran y qué tipo de apuesta. combo: una combinada; single: una sencilla. mixed es el
// reparto de la primera versión (sencillas y combinadas a la vez), que ya no sale en la pantalla
export type PlanMode = 'combo' | 'single' | 'mixed';
// odds: la cuota pedida; si no se da, la que sale del beneficio (que va redondeado a céntimos y puede quedar un pelo por encima)
export interface PlanOptions { mode?: PlanMode; sports?: PlanSport[]; odds?: number }

// Cuotas objetivo de la pantalla: el beneficio buscado es el dinero × (cuota − 1)
export const TARGET_ODDS = [1.5, 1.75, 2] as const;
export const targetOf = (budget: number, odds: number) => Math.round(budget * (odds - 1) * 100) / 100;

// «1,5», «1.75» o «2». Una cuota de verdad: más de 1 y como mucho 50
export function parseOdds(text: string): number | null {
  const t = text.trim();
  if (!/^\d+([.,]\d{1,2})?$/.test(t)) return null;
  const v = Number(t.replace(',', '.'));
  return v > 1 && v <= 50 ? v : null;
}

// La sencilla más probable de las que pagan al menos la cuota pedida (a igual probabilidad, la de más valor)
export function bestSingle(elig: PlanPick[], need: number): PlanPick | null {
  let best: PlanPick | null = null;
  for (const p of elig) {
    if (p.price < need - 1e-9) continue;
    if (!best || p.p > best.p + 1e-12 || (Math.abs(p.p - best.p) <= 1e-12 && (p.ev > best.ev || (p.ev === best.ev && p.id < best.id)))) best = p;
  }
  return best;
}

// Las líneas de un partido que merece la pena mirar: las que no tienen otra que pague más y acierte más a la vez
function frontier(lines: PlanPick[]): PlanPick[] {
  const out: PlanPick[] = [];
  let bestP = -1;
  for (const l of [...lines].sort((x, y) => y.price - x.price || y.p - x.p || (x.id < y.id ? -1 : 1))) {
    if (l.p > bestP + 1e-12) { out.push(l); bestP = l.p; }
  }
  return out;
}

// La combinada más probable que llega a la cuota pedida, de 2 a 8 partidos distintos y con cualquier línea de cada partido. Es una
// mochila: se recorren los partidos guardando, para cada número de patas y cada tramo de cuota (en logaritmos, de 0,2 % en 0,2 %),
// la combinación más probable. Al juntar las que caen en el mismo tramo se puede perder una opción casi igual, nunca una que no llegue
export const MAX_LEGS = 8;
const STEP = 0.002;
interface Node { pick: PlanPick; prev: Node | null }
interface State { lp: number; lq: number; legs: number; path: Node | null }
export function bestCombo(elig: PlanPick[], need: number): PlanPick[] | null {
  const goal = Math.log(need) - 1e-9;
  const cap = Math.ceil(goal / STEP) + 1;
  const byMatch = new Map<string, PlanPick[]>();
  for (const p of elig) byMatch.set(p.match, [...(byMatch.get(p.match) ?? []), p]);
  const matches = [...byMatch.keys()].sort().map(k => frontier(byMatch.get(k)!));
  const keyOf = (legs: number, lq: number) => legs * (cap + 1) + (lq >= goal ? cap : Math.min(cap - 1, Math.floor(lq / STEP)));
  let states = new Map<number, State>([[0, { lp: 0, lq: 0, legs: 0, path: null }]]);
  for (const lines of matches) {
    const next = new Map(states);
    for (const st of states.values()) {
      if (st.legs >= MAX_LEGS) continue;
      for (const l of lines) {
        const cand: State = { lp: st.lp + Math.log(l.p), lq: st.lq + Math.log(l.price), legs: st.legs + 1, path: { pick: l, prev: st.path } };
        const k = keyOf(cand.legs, cand.lq);
        const cur = next.get(k);
        if (!cur || cand.lp > cur.lp + 1e-12) next.set(k, cand);
      }
    }
    states = next;
  }
  let best: State | null = null;
  for (const st of states.values()) {
    if (st.legs < 2 || st.lq < goal) continue;
    if (!best || st.lp > best.lp + 1e-12 || (Math.abs(st.lp - best.lp) <= 1e-12 && st.legs < best.legs)) best = st;
  }
  if (!best) return null;
  const legs: PlanPick[] = [];
  for (let n = best.path; n; n = n.prev) legs.unshift(n.pick);
  return legs;
}

// La cuota más alta a la que se puede llegar: las 8 líneas de más cuota, de partidos distintos
function maxCombo(elig: PlanPick[]): number {
  const top = new Map<string, number>();
  for (const p of elig) top.set(p.match, Math.max(top.get(p.match) ?? 0, p.price));
  const list = [...top.values()].sort((a, b) => b - a).slice(0, MAX_LEGS);
  return list.length >= 2 ? list.reduce((a, b) => a * b, 1) : 0;
}

const SPORT_TEXT: Record<PlanSport, string> = { tennis: 'tenis', football: 'fútbol', mma: 'MMA', basket: 'baloncesto' };
const oddText = (v: number) => v.toFixed(2).replace('.', ',');

// Un plan de una sola apuesta (la combinada o la sencilla) con todo el dinero
function onlyTicket(legs: PlanPick[], budget: number, target: number, eligible: number): Plan {
  const tickets = [ticketOf(legs, budget)];
  const risk = riskOf(tickets, budget, target);
  const warnings = planWarnings(risk, budget, target);
  if (legs.some(l => l.sport === 'basket')) warnings.splice(warnings.length - 1, 0, 'Las de baloncesto son una estimación: no hay cuotas antiguas con las que comprobar si su modelo acierta.');
  return { budget, target, tickets, risk, warnings, eligible };
}

export function buildPlan(pool: PlanPick[], budget: number, target: number, now: number = Date.now(), opts: PlanOptions = {}): Plan {
  const mode = opts.mode ?? 'mixed';
  const sports = opts.sports?.length ? new Set(opts.sports) : null;
  const elig = pool.filter(p => (!sports || sports.has(p.sport)) && isEligible(p, now));
  const L = onePerMatch(elig).slice(0, 14);
  if (!L.length || !(budget > 0)) {
    const which = sports ? [...sports].map(s => SPORT_TEXT[s]).join(', ') : '';
    return emptyPlan(budget, target, elig.length, which && pool.length
      ? `No hay apuestas de ${which} en las próximas 48 horas para armar un plan.` : undefined);
  }
  const need = opts.odds ?? 1 + target / budget;

  if (mode === 'combo') {
    const legs = bestCombo(elig, need);
    if (legs) return onlyTicket(legs, budget, target, elig.length);
    const top = maxCombo(elig);
    return emptyPlan(budget, target, elig.length, top
      ? `Con las apuestas que hay ahora ninguna combinada llega a cuota ${oddText(need)}: la más alta posible es ${oddText(top)}. Prueba con una cuota más baja u otro deporte.`
      : 'Para una combinada hacen falta al menos dos partidos con apuestas; ahora sólo hay uno.');
  }
  if (mode === 'single') {
    const pick = bestSingle(elig, need);
    if (pick) return onlyTicket([pick], budget, target, elig.length);
    const top = Math.max(...elig.map(p => p.price));
    return emptyPlan(budget, target, elig.length, `Ninguna apuesta sencilla de las que hay ahora paga ${oddText(need)} o más: la más alta es ${oddText(top)}. Prueba con una combinada o una cuota más baja.`);
  }

  let best: { tickets: Ticket[]; d: Dist } | null = null;
  const seen = new Set<string>();
  for (const st of structures(L)) {
    for (const scheme of SCHEMES) {
      const shares = capShares(scheme(st));
      const cents = toCents(shares, budget, st.length >= 3);
      if (!cents) continue;
      const key = st.map((legs, i) => `${legs.map(l => l.id).join('+')}@${cents[i]}`).join('|');
      if (seen.has(key)) continue;
      seen.add(key);
      const tickets = st.map((legs, i) => ticketOf(legs, cents[i] / 100));
      const d = distOf(tickets, budget, target);
      const better = !best || d.pReach > best.d.pReach + 1e-12
        || (Math.abs(d.pReach - best.d.pReach) <= 1e-12 && (d.pLoseAll < best.d.pLoseAll - 1e-12
          || (Math.abs(d.pLoseAll - best.d.pLoseAll) <= 1e-12 && tickets.length > best.tickets.length)));
      if (better) best = { tickets, d };
    }
  }
  if (!best) return emptyPlan(budget, target, elig.length);
  // Los tickets más grandes primero
  const tickets = [...best.tickets].sort((a, b) => b.stake - a.stake);
  const risk = riskOf(tickets, budget, target);
  const warnings = planWarnings(risk, budget, target);
  return { budget, target, tickets, risk, warnings, eligible: elig.length };
}
