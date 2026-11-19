import { describe, expect, it } from 'vitest';
import { bestCombo, bestSingle, buildPlan, isEligible, levelOf, MAX_LEGS, parseEuros, parseOdds, planWarnings, poolStats, riskOf, targetOf, ticketOf, type PlanPick, type Risk, type Ticket } from './plan';

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
      tennis: { matches: 2, picks: 3 }, football: { matches: 0, picks: 0 }, mma: { matches: 0, picks: 0 }, basket: { matches: 0, picks: 0 }
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

describe('cuota objetivo, deporte y tipo de apuesta', () => {
  // Varias líneas por partido, como llegan ahora (todas las calculadas, no sólo la más fiable)
  const pool = [
    pick({ id: 'b1', sport: 'basket', match: 'b:1', price: 1.2, p: 0.8 }),
    pick({ id: 'b2', sport: 'basket', match: 'b:1', price: 1.9, p: 0.5 }),
    pick({ id: 'b3', sport: 'basket', match: 'b:1', price: 2.1, p: 0.47 }),
    pick({ id: 'b4', sport: 'basket', match: 'b:2', price: 1.45, p: 0.66 }),
    pick({ id: 'b5', sport: 'basket', match: 'b:2', price: 1.3, p: 0.6 }), // peor que b4 en las dos cosas: no se mira
    pick({ id: 't1', sport: 'tennis', match: 't:1', price: 1.25, p: 0.78 }),
    pick({ id: 't2', sport: 'tennis', match: 't:1', price: 2.05, p: 0.46 }),
    pick({ id: 'f1', sport: 'football', match: 'f:1', price: 1.4, p: 0.69 }),
    pick({ id: 'f2', sport: 'football', match: 'f:2', price: 2.4, p: 0.4 })
  ];
  const ids = (l: PlanPick[] | null) => (l ?? []).map(x => x.id).sort();

  it('la cuota objetivo da el beneficio y se lee como cuota', () => {
    expect(targetOf(100, 1.75)).toBe(75);
    expect(targetOf(10.6, 2)).toBe(10.6);
    expect(parseOdds('1,5')).toBe(1.5);
    expect(parseOdds('2.75')).toBe(2.75);
    expect(parseOdds('1')).toBeNull();
    expect(parseOdds('51')).toBeNull();
    expect(parseOdds('abc')).toBeNull();
  });

  it('simple: la más probable de las que pagan la cuota o más, de cualquier deporte elegido', () => {
    expect(bestSingle(pool, 2)?.id).toBe('b3');
    expect(bestSingle(pool.filter(p => p.sport !== 'basket'), 2)?.id).toBe('t2');
    expect(bestSingle(pool, 3)).toBeNull();
    const plan = buildPlan(pool, 100, targetOf(100, 2), NOW, { mode: 'single', odds: 2 });
    expect(plan.tickets).toHaveLength(1);
    expect(plan.tickets[0]).toMatchObject({ stake: 100, legs: [{ id: 'b3' }] });
    expect(plan.risk.pReach).toBeCloseTo(0.47);
  });

  it('simple que no existe: no se inventa y dice la cuota más alta', () => {
    const plan = buildPlan(pool, 100, targetOf(100, 3), NOW, { mode: 'single', odds: 3 });
    expect(plan.tickets).toHaveLength(0);
    expect(plan.warnings[0]).toMatch(/Ninguna apuesta sencilla .* paga 3,00 o más: la más alta es 2,40/);
  });

  it('combinada a cuota 2: la más probable, con cualquier línea de cada partido y nunca dos del mismo', () => {
    // b4 × f1 = 2,03 con 0,455 gana a b1 × t1 × f1 = 2,10 con 0,43 y a cualquier sencilla de 2 o más
    const legs = bestCombo(pool, 2)!;
    expect(ids(legs)).toEqual(['b4', 'f1']);
    expect(new Set(legs.map(l => l.match)).size).toBe(legs.length);
    const plan = buildPlan(pool, 100, targetOf(100, 2), NOW, { mode: 'combo', odds: 2 });
    expect(plan.tickets[0].price).toBeGreaterThanOrEqual(2);
    expect(plan.risk.pReach).toBeCloseTo(0.66 * 0.69);
  });

  it('combinada de un solo deporte', () => {
    const plan = buildPlan(pool, 100, targetOf(100, 1.5), NOW, { mode: 'combo', sports: ['basket'], odds: 1.5 });
    expect(plan.tickets[0].legs.every(l => l.sport === 'basket')).toBe(true);
    expect(ids(plan.tickets[0].legs)).toEqual(['b1', 'b4']); // 1,74 con 0,528
    expect(plan.warnings.some(w => /baloncesto son una estimación/.test(w))).toBe(true);
  });

  it('combinada que no llega: no se arma y dice la cuota más alta', () => {
    const plan = buildPlan(pool, 100, targetOf(100, 40), NOW, { mode: 'combo', sports: ['tennis', 'football'], odds: 40 });
    expect(plan.tickets).toHaveLength(0);
    expect(plan.warnings[0]).toMatch(/ninguna combinada llega a cuota 40,00: la más alta posible es 6,89/);
  });

  it('la combinada es la mejor posible (frente a probarlas todas)', () => {
    let seed = 7;
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    for (let round = 0; round < 25; round++) {
      const list: PlanPick[] = [];
      for (let m = 0; m < 6; m++) for (let k = 0; k < 3; k++) {
        const price = 1.1 + rnd() * 2.5;
        list.push(pick({ id: `r${round}-${m}-${k}`, match: `m${m}`, price, p: Math.min(0.95, (1 / price) * (0.85 + rnd() * 0.2)) }));
      }
      const need = 1.5 + rnd() * 4;
      // Todas: para cada partido, ninguna línea o una de las tres
      let bestP = -1;
      const walk = (m: number, price: number, p: number, legs: number) => {
        if (m === 6) { if (legs >= 2 && legs <= MAX_LEGS && price >= need && p > bestP) bestP = p; return; }
        walk(m + 1, price, p, legs);
        for (const l of list.filter(x => x.match === `m${m}`)) walk(m + 1, price * l.price, p * l.p, legs + 1);
      };
      walk(0, 1, 1, 0);
      const got = bestCombo(list, need);
      if (bestP < 0) { expect(got).toBeNull(); continue; }
      const p = got!.reduce((a, l) => a * l.p, 1), price = got!.reduce((a, l) => a * l.price, 1);
      expect(price).toBeGreaterThanOrEqual(need - 1e-9);
      // Los tramos de cuota pueden juntar dos casi iguales: como mucho un 1 % peor que la mejor
      expect(p).toBeGreaterThanOrEqual(bestP * 0.99);
    }
  });

  it('sin apuestas del deporte elegido lo dice', () => {
    const plan = buildPlan(pool, 100, 100, NOW, { mode: 'combo', sports: ['mma'], odds: 2 });
    expect(plan.tickets).toHaveLength(0);
    expect(plan.warnings[0]).toMatch(/No hay apuestas de MMA/);
  });

  it('cuenta las de baloncesto por partido', () => {
    expect(poolStats(pool, NOW).basket).toEqual({ matches: 2, picks: 5 });
  });
});
