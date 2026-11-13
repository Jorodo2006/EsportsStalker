// Matemática de cuotas: probabilidad implícita, quitar margen, valor y Kelly.

/** Probabilidad implícita bruta de una cuota decimal. */
export const implied = (odds) => 1 / odds;

/** Margen de la casa en un mercado de 2 resultados (0.05 = 5 %). */
export const overround = (o1, o2) => implied(o1) + implied(o2) - 1;

/**
 * Quita el margen y devuelve las probabilidades "justas" que marca la casa.
 * method: 'multiplicative' (proporcional) o 'power' (reparte más margen en el no favorito,
 * que es como suelen cargarlo las casas en tenis).
 */
export function fairProbs(o1, o2, method = 'power') {
  const p1 = implied(o1);
  const p2 = implied(o2);
  if (method === 'multiplicative') {
    const s = p1 + p2;
    return [p1 / s, p2 / s];
  }
  // Método potencia: buscar k tal que p1^k + p2^k = 1 (bisección).
  let lo = 0.5, hi = 2;
  for (let i = 0; i < 60; i++) {
    const k = (lo + hi) / 2;
    const s = Math.pow(p1, k) + Math.pow(p2, k);
    if (s > 1) lo = k; else hi = k;
  }
  const k = (lo + hi) / 2;
  return [Math.pow(p1, k), Math.pow(p2, k)];
}

/** Valor esperado por unidad apostada: +0.05 = +5 %. */
export const edge = (prob, odds) => prob * odds - 1;

/** Cuota mínima para que una probabilidad tenga valor. */
export const fairOdds = (prob) => 1 / prob;

/**
 * Stake de Kelly como fracción de la banca.
 * fraction: 0.25 = cuarto de Kelly (lo recomendable; Kelly completo es demasiado agresivo).
 * cap: máximo por apuesta, como fracción de banca.
 */
export function kelly(prob, odds, { fraction = 0.25, cap = 0.03 } = {}) {
  const b = odds - 1;
  const f = (prob * odds - 1) / b;
  if (f <= 0) return 0;
  return Math.min(f * fraction, cap);
}

/**
 * CLV (closing line value): cuánto mejor fue tu cuota que la de cierre.
 * Usa la probabilidad justa de cierre (sin margen) si se da la cuota del rival.
 *   clvOdds  = cuotaTomada / cuotaCierre - 1
 *   clvProb  = cuotaTomada * probJustaCierre - 1  (valor esperado según el cierre)
 */
export function clv(takenOdds, closingOdds, closingOpponentOdds = null) {
  const res = { clvOdds: takenOdds / closingOdds - 1 };
  if (closingOpponentOdds) {
    const [pFair] = fairProbs(closingOdds, closingOpponentOdds);
    res.closingFairProb = pFair;
    res.clvEV = takenOdds * pFair - 1;
  }
  return res;
}
