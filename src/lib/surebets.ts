import type { SurebetLeg } from '@/lib/types';

// Reparto del dinero de una surebet: a cada selección lo justo para que cobre lo mismo salga la que salga (importe ∝ 1/cuota).
// Redondeado a `step` (las casas no aceptan céntimos raros y un importe exacto como 47,62 € llama la atención): después de
// redondear, lo que se cobra ya no es igual en todas, y se da lo peor y lo mejor. Pruebas en surebets.test.ts
export function stakesFor(legs: SurebetLeg[], total: number, step = 1) {
  const sum = legs.reduce((s, l) => s + 1 / l.price, 0);
  if (!(total > 0) || !sum) return null;
  const stakes = legs.map(l => {
    const exact = total / (l.price * sum);
    const s = step > 0 ? Math.max(step, Math.round(exact / step) * step) : exact;
    return { ...l, stake: s, returns: s * l.price };
  });
  const spent = stakes.reduce((s, x) => s + x.stake, 0);
  const worst = Math.min(...stakes.map(x => x.returns)) - spent;
  const best = Math.max(...stakes.map(x => x.returns)) - spent;
  return { stakes, spent, worst, best };
}

// El reparto más redondo que no se come el beneficio: euros enteros si se puede; si no, 0,50, 0,10 o céntimos. Con un margen
// pequeño, redondear a euros puede dejar una selección cobrando menos de lo apostado
export function bestStakes(legs: SurebetLeg[], total: number) {
  let last = null;
  for (const step of [1, 0.5, 0.1, 0.01]) {
    last = stakesFor(legs, total, step);
    if (!last || last.worst > 0) return last && { ...last, step };
  }
  return last && { ...last, step: 0.01 };
}

// Minutos desde que se leyó la casa más antigua de las que hacen falta: si es mucho, la cuota puede haber cambiado
export function ageMinutes(read: Record<string, number>, books: string[], now = Date.now()) {
  const ts = books.map(b => read[b]).filter((x): x is number => typeof x === 'number');
  return ts.length ? Math.round((now - Math.min(...ts)) / 60e3) : null;
}
