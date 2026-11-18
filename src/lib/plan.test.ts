import { describe, expect, it } from 'vitest';
import { buildPlan, isEligible, levelOf, parseEuros, planWarnings, poolStats, riskOf, ticketOf, type PlanPick, type Risk, type Ticket } from './plan';

const NOW = Date.parse('2026-11-18T10:00:00Z');
const H = 3600_000;
const iso = (ms: number) => new Date(ms).toISOString();

let seq = 0;
function pick(over: Partial<PlanPick> = {}): PlanPick {
  seq++;
  return {
    id: `p${seq}`, sport: 'tennis', match: `m${seq}`, event: 'A vs B', league: 'Liga', title: 'Gana A', start: iso(NOW + 5 * H),
    book: 'Winamax', price: 1.5, p: 0.7, ev: 0, rel: 70, ...over
  };
}

describe('isEligible', () => {
  it('aplica los límites de fiabilidad, valor, cuota y ventana', () => {
    expect(isEligible(pick(), NOW)).toBe(true);
    expect(isEligible(pick({ rel: 44 }), NOW)).toBe(false);
    expect(isEligible(pick({ rel: 45 }), NOW)).toBe(true);
    expect(isEligible(pick({ ev: -0.101 }), NOW)).toBe(false);
    expect(isEligible(pick({ ev: -0.10 }), NOW)).toBe(true);
    expect(isEligible(pick({ price: 1.09 }), NOW)).toBe(false);
    expect(isEligible(pick({ price: 1.10 }), NOW)).toBe(true);
    expect(isEligible(pick({ price: 15 }), NOW)).toBe(true);
    expect(isEligible(pick({ price: 15.01 }), NOW)).toBe(false);
  });
  it('deja fuera lo que empieza a 48 h o más, lo ya empezado y las fechas inválidas', () => {
    expect(isEligible(pick({ start: iso(NOW + 48 * H) }), NOW)).toBe(false);
    expect(isEligible(pick({ start: iso(NOW + 48 * H - 1) }), NOW)).toBe(true);
    expect(isEligible(pick({ start: iso(NOW) }), NOW)).toBe(false);
    expect(isEligible(pick({ start: iso(NOW - H) }), NOW)).toBe(false);
    expect(isEligible(pick({ start: 'no-es-una-fecha' }), NOW)).toBe(false);
  });
});

describe('poolStats', () => {
  it('cuenta sólo las elegibles y los partidos distintos', () => {
    const pool = [pick({ match: 'x' }), pick({ match: 'x' }), pick({ match: 'y' }), pick({ sport: 'football', rel: 10 })];
    expect(poolStats(pool, NOW)).toEqual({
      tennis: { matches: 2, picks: 3 }, football: { matches: 0, picks: 0 }, mma: { matches: 0, picks: 0 }
    });
  });
});

describe('ticketOf', () => {
  it('multiplica cuota y probabilidad de las patas', () => {
    const t = ticketOf([pick({ price: 2, p: 0.5 }), pick({ price: 1.5, p: 0.8, match: 'otro' })], 10);
    expect(t.price).toBeCloseTo(3, 10);
    expect(t.p).toBeCloseTo(0.4, 10);
    expect(t.stake).toBe(10);
    expect(t.toReturn).toBeCloseTo(30, 10);
  });
});

describe('levelOf', () => {
  it('usa los umbrales 60 / 35 / 15 %', () => {
    expect(levelOf(0.6)).toBe('bajo');
    expect(levelOf(0.5999)).toBe('medio');
    expect(levelOf(0.35)).toBe('medio');
    expect(levelOf(0.3499)).toBe('alto');
    expect(levelOf(0.15)).toBe('alto');
    expect(levelOf(0.1499)).toBe('muy alto');
    expect(levelOf(0)).toBe('muy alto');
  });
});

const BAD = /garantiz|segur|asegur|gana/i;
const two = (): Ticket[] => [
  { legs: [pick()], price: 2, p: 0.5, stake: 50, toReturn: 100 },
  { legs: [pick()], price: 2, p: 0.5, stake: 50, toReturn: 100 }
];

describe('riskOf', () => {
  it('enumera los resultados de tickets independientes', () => {
    const r = riskOf(two(), 100, 0);
    expect(r.pReach).toBeCloseTo(0.75, 10);
    expect(r.pProfit).toBeCloseTo(0.25, 10);
    expect(r.pLoseAll).toBeCloseTo(0.25, 10);
    expect(r.expectedReturn).toBeCloseTo(100, 10);
    expect(riskOf(two(), 100, 100).pReach).toBeCloseTo(0.25, 10);
  });
  it('sin tickets no hay nada que llegar', () => {
    const r = riskOf([], 100, 20);
    expect(r).toMatchObject({ pReach: 0, pProfit: 0, pLoseAll: 1, expectedReturn: 0, level: 'muy alto' });
  });
  it('el mensaje no promete nada', () => {
    for (const r of [riskOf(two(), 100, 0), riskOf(two(), 100, 100), riskOf([], 100, 20)]) expect(r.message).not.toMatch(BAD);
  });
});

describe('planWarnings', () => {
  const risk = (expectedReturn: number): Risk => ({ pReach: 0.5, pProfit: 0.5, pLoseAll: 0.1, expectedReturn, level: 'medio', message: '' });
  it('avisa de valor esperado negativo', () => {
    const w = planWarnings(risk(90), 100, 20);
    const neg = w.find(x => /pierde dinero/.test(x));
    expect(neg).toBeDefined();
    expect(neg).toMatch(/90/);
    expect(planWarnings(risk(110), 100, 20).some(x => /pierde dinero/.test(x))).toBe(false);
  });
  it('avisa si la cuota necesaria pasa de 3', () => {
    expect(planWarnings(risk(100), 100, 250).some(x => /3,5/.test(x))).toBe(true);
    expect(planWarnings(risk(100), 100, 200).some(x => /cuota necesaria/i.test(x))).toBe(false);
  });
  it('lleva siempre el aviso fijo y no promete', () => {
    const w = planWarnings(risk(100), 100, 20);
    expect(w.some(x => /modelo/.test(x) && /independ/.test(x) && /cuotas/.test(x))).toBe(true);
    for (const x of w) expect(x).not.toMatch(/garantiz|segur|asegur/i);
  });
});

describe('parseEuros', () => {
  it('acepta cifras válidas', () => {
    expect(parseEuros('100')).toBe(100);
    expect(parseEuros('100,5')).toBe(100.5);
    expect(parseEuros('100.50')).toBe(100.5);
    expect(parseEuros('0,01')).toBe(0.01);
    expect(parseEuros('1000000')).toBe(1000000);
  });
  it('rechaza lo demás', () => {
    for (const t of ['', 'abc', '-5', '0', '1,234', '1e6', '1000000,01', ' ']) expect(parseEuros(t)).toBeNull();
  });
});

describe('buildPlan', () => {
  const mk = (n: number, matches = n): PlanPick[] => Array.from({ length: n }, (_, i) => pick({
    // Cuota coherente con la probabilidad (valor esperado −2 %), como las recomendaciones reales
    id: `b${n}-${i}`, match: `bm${i % matches}`, p: 0.62 + ((i * 7) % 24) / 100, price: Math.round((0.98 / (0.62 + ((i * 7) % 24) / 100)) * 100) / 100, ev: -0.02
  }));
  const pool = mk(12);
  const cases: [number, number][] = [[100, 5], [100, 20], [100, 80], [33.33, 10], [0.01, 0.01], [250, 40]];

  it.each(cases)('cumple las reglas con %s € y +%s €', (budget, target) => {
    const plan = buildPlan(pool, budget, target, NOW);
    const cents = plan.tickets.reduce((s, t) => s + Math.round(t.stake * 100), 0);
    expect(cents).toBe(Math.round(budget * 100));
    const ids = plan.tickets.flatMap(t => t.legs.map(l => l.id));
    expect(new Set(ids).size).toBe(ids.length);
    for (const t of plan.tickets) {
      expect(new Set(t.legs.map(l => l.match)).size).toBe(t.legs.length);
      expect(t.stake).toBeGreaterThan(0);
    }
    if (plan.tickets.length >= 3) for (const t of plan.tickets) expect(t.stake).toBeLessThanOrEqual(0.6 * budget + 0.005);
    expect(plan.tickets.length).toBeLessThanOrEqual(12);
    expect(plan.risk.pReach).toBeCloseTo(riskOf(plan.tickets, budget, target).pReach, 10);
  });

  it('es determinista', () => {
    expect(buildPlan(pool, 100, 20, NOW)).toEqual(buildPlan(pool, 100, 20, NOW));
  });
  it('cuanto más difícil el objetivo, menos probable', () => {
    const a = buildPlan(pool, 100, 5, NOW).risk.pReach;
    const b = buildPlan(pool, 100, 20, NOW).risk.pReach;
    const c = buildPlan(pool, 100, 80, NOW).risk.pReach;
    expect(a).toBeGreaterThanOrEqual(b);
    expect(b).toBeGreaterThanOrEqual(c);
  });
  it('un objetivo fácil es probable y uno difícil obliga a combinar', () => {
    expect(buildPlan(pool, 100, 5, NOW).risk.pReach).toBeGreaterThanOrEqual(0.5);
    expect(buildPlan(pool, 100, 80, NOW).tickets.some(t => t.legs.length >= 2)).toBe(true);
  });
  it('un objetivo disparatado sigue dando plan, con nivel muy alto y aviso de cuota', () => {
    const plan = buildPlan(pool, 100, 500, NOW);
    expect(plan.tickets.length).toBeGreaterThan(0);
    expect(plan.risk.level).toBe('muy alto');
    expect(plan.warnings.some(w => /6,0/.test(w))).toBe(true);
  });
  it('descarta lo que no pasa el filtro y cuenta las elegibles', () => {
    const bad = pick({ id: 'malo', rel: 40 });
    const plan = buildPlan([...pool, bad], 100, 20, NOW);
    expect(plan.tickets.flatMap(t => t.legs).some(l => l.id === 'malo')).toBe(false);
    expect(plan.eligible).toBe(pool.length);
  });
  it('sin elegibles no inventa nada', () => {
    for (const p of [[], [pick({ rel: 1 })]]) {
      const plan = buildPlan(p, 100, 20, NOW);
      expect(plan.tickets).toEqual([]);
      expect(plan.eligible).toBe(0);
      expect(plan.risk.pReach).toBe(0);
      expect(plan.warnings.some(w => /no hay/i.test(w))).toBe(true);
    }
  });
  it('una elegible lleva todo el dinero; dos del mismo partido no se combinan', () => {
    const one = buildPlan([pick()], 100, 20, NOW);
    expect(one.tickets).toHaveLength(1);
    expect(one.tickets[0].stake).toBe(100);
    const same = buildPlan([pick({ match: 'mm' }), pick({ match: 'mm' })], 100, 20, NOW);
    expect(same.tickets).toHaveLength(1);
    expect(same.tickets[0].stake).toBe(100);
  });
  it('tarda menos de 200 ms con 80 apuestas', () => {
    const big = mk(80, 60);
    const t0 = performance.now();
    buildPlan(big, 100, 40, NOW);
    expect(performance.now() - t0).toBeLessThan(200);
  });
});
