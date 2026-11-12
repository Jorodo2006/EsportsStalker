// Valor de una apuesta Más / Menos, común a LoL y a la NBA (idea de courtside-edge):
// margen de la casa, valor esperado, ventaja, stake con ¼ de Kelly, fiabilidad 0-100 y veredicto.
// Funciones puras: cada deporte calcula sus probabilidades y sus factores de fiabilidad y los pasa aquí.

export type Side = 'over' | 'under';
export const SIDE_LABEL: Record<Side, string> = { over: 'Más', under: 'Menos' };

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

// Margen típico de las líneas de jugador en las casas europeas cuando sólo hay una cuota
const DEFAULT_MARGIN = 0.07;

// Probabilidad sin margen de cada lado. Con las dos cuotas se quita el margen exacto; con una, se estima.
export function devig(over?: number | null, under?: number | null) {
  const io = over && over > 1 ? 1 / over : null, iu = under && under > 1 ? 1 / under : null;
  if (io && iu) return { over: io / (io + iu), under: iu / (io + iu), margin: io + iu - 1, exact: true };
  const f = 1 + DEFAULT_MARGIN / 2;
  return { over: io ? io / f : null, under: iu ? iu / f : null, margin: io || iu ? DEFAULT_MARGIN : null, exact: false };
}

// Probabilidad sin margen cuando hay varias casas: a cada una se le quita su propio margen (con sus dos cuotas, o estimado si sólo
// da un lado) y se promedian, pesando menos las estimadas. Quitárselo a la mejor cuota de cada lado mezclando casas (el más de una y
// el menos de otra) daba márgenes casi nulos (0,3 %) y una probabilidad inflada justo del lado que se iba a apostar: la misma
// apuesta salía con +7 % desde la recomendación y con +0,8 % al pulsar la cuota de una sola casa
export function devigBooks(books: { over?: number | null; under?: number | null }[]) {
  let w = 0, over = 0, margin = 0, nExact = 0;
  for (const b of books) {
    const d = devig(b.over, b.under);
    const o = d.over ?? (d.under != null ? 1 - d.under : null);
    if (o == null) continue;
    const k = d.exact ? 1 : 0.5;
    w += k; over += k * o;
    if (d.exact) { margin += d.margin!; nExact++; }
  }
  if (!w) return { over: null, under: null, margin: null, exact: false };
  const o = over / w;
  return { over: o, under: 1 - o, margin: nExact ? margin / nExact : DEFAULT_MARGIN, exact: nExact > 0 };
}

export interface SideValue {
  side: Side;
  price: number;
  book?: string;
  p: number; // probabilidad estimada de ganar (sin contar la nula)
  pModel: number; // la del modelo, antes de mezclarla con la casa y sin la nula
  ev: number; // valor esperado por unidad: p·cuota + nula − 1
  edge: number | null; // probabilidad estimada − probabilidad de la casa sin margen
  gap: number | null; // lo mismo con la del modelo: cuánto discrepa de la casa antes de mezclar
  kelly: number; // fracción del bank: ¼ de Kelly con tope del 3 %
}

const logit = (p: number) => Math.log(p / (1 - p));
const sigmoid = (x: number) => 1 / (1 + Math.exp(-x));
const inBounds = (p: number) => clamp(p, 0.002, 0.998);

// Probabilidad final: el modelo mezclado en logit con la casa sin margen. Ordenar por valor con el modelo a secas
// sube a la cabeza sus propios errores (una baja que no conoce, un cambio de rol), con EV de +30 % que no existen.
// Hacia los extremos pesa menos: ahí el modelo sale optimista (docs/specs/08-baloncesto.md) y una diferencia pequeña de
// probabilidad se convierte en un EV enorme con cuotas altas.
export function blendWithMarket(p: number, fair: number, modelWeight: number) {
  const w = modelWeight * 4 * fair * (1 - fair);
  return sigmoid(w * logit(inBounds(p)) + (1 - w) * logit(inBounds(fair)));
}

// Tanta diferencia con la casa suele ser que al modelo le falta algo (una baja, un cambio de rol) o un mercado mal leído. Se mide en
// logit porque 10 % frente a 29 % es mucho más grave que 50 % frente a 69 %: 0,85 es 50 % frente a 70 %, o 10 % frente a 21 %
const TOO_FAR = 0.85;
export const tooFar = (pModel: number, fair: number) => Math.abs(logit(inBounds(pModel)) - logit(inBounds(fair))) >= TOO_FAR;

// p y push sobre el total (p + p del otro lado + push = 1); fair = probabilidad sin margen de la casa.
// modelWeight: cuánto pesa el modelo frente a la casa (1 = sólo el modelo, sin mezclar)
export function sideValue(side: Side, p: number, push: number, price: number, fair: number | null, book?: string, modelWeight = 1): SideValue {
  const pModel = p / Math.max(1e-9, 1 - push);
  const pNoPush = fair != null && modelWeight < 1 ? blendWithMarket(pModel, fair, modelWeight) : pModel;
  const final = pNoPush * (1 - push);
  const b = price - 1;
  const kelly = b > 0 ? clamp((b * pNoPush - (1 - pNoPush)) / b, 0, 1) : 0;
  return {
    side, price, book, p: final, pModel, ev: final * price + push - 1,
    edge: fair != null ? pNoPush - fair : null, gap: fair != null ? pModel - fair : null, kelly: Math.min(kelly / 4, 0.03)
  };
}

// ---------- fiabilidad ----------
export interface RelFactor { label: string; score: number; max: number; note: string }
export interface Reliability { score: number; label: 'Alta' | 'Media' | 'Baja'; factors: RelFactor[]; warnings: string[] }

// value01: 0 = nada, 1 = lo máximo para ese factor. penalties: puntos que se restan con su aviso.
export function reliability(factors: { label: string; value01: number; max: number; note: string }[], penalties: { pts: number; warning: string }[] = []): Reliability {
  const fs = factors.map(f => ({ label: f.label, max: f.max, note: f.note, score: clamp(f.value01, 0, 1) * f.max }));
  const total = fs.reduce((s, f) => s + f.max, 0) || 1;
  // Se reescala a 100 por si un deporte usa otros máximos
  let score = (fs.reduce((s, f) => s + f.score, 0) / total) * 100;
  for (const p of penalties) score -= p.pts;
  score = Math.round(clamp(score, 0, 100));
  return { score, label: score >= 70 ? 'Alta' : score >= 50 ? 'Media' : 'Baja', factors: fs, warnings: penalties.map(p => p.warning) };
}

// Factores que valen para cualquier estadística de jugador
export const relCommon = {
  // Regularidad: coeficiente de variación de 0,2 (muy regular) a 0,9 (muy irregular)
  consistency: (mean: number, sd: number) => {
    const cv = mean > 0 ? sd / mean : 1;
    return { label: 'Regularidad', value01: 1 - (cv - 0.2) / 0.7, max: 20, note: `variación ${(cv * 100).toFixed(0)} % sobre la media` };
  },
  // Distancia de la proyección a la línea en desviaciones (0,8 o más = máximo)
  distance: (mean: number, sd: number, line: number) => {
    const z = Math.abs(mean - line) / Math.max(sd, 0.5);
    return { label: 'Margen sobre la línea', value01: z / 0.8, max: 15, note: `proyección a ${z.toFixed(2)} desviaciones de la línea` };
  },
  // Acuerdo entre el modelo y la frecuencia con la que superó la línea
  agreement: (model: number, hist: number) => ({
    label: 'Modelo vs histórico', value01: 1 - Math.abs(model - hist) / 0.25, max: 10,
    note: `modelo ${(model * 100).toFixed(0)} % · histórico ${(hist * 100).toFixed(0)} %`
  })
};

// ---------- veredicto ----------
export type VerdictCode = 'BET' | 'LEAN' | 'PASS' | 'NOODDS';
export interface Verdict { code: VerdictCode; title: string; text: string; best: SideValue | null }

export const VERDICT_LABEL: Record<VerdictCode, string> = { BET: 'Apostar', LEAN: 'Valor ligero', PASS: 'No apostar', NOODDS: 'Sin cuota' };

// Un solo criterio para todas las pantallas (recomendaciones, la banda de Hoy, el análisis del jugador, tenis, fútbol y LoL): si
// cada una usara el suyo, la misma apuesta saldría como "de las mejores" en una y "No apostar" en otra.
// Apostar: EV ≥ 2 % y fiabilidad ≥ 55. Valor ligero: EV ≥ 1 % y fiabilidad ≥ 45. Lo demás, no apostar
export const BET_EV = 0.02, BET_REL = 55, LEAN_EV = 0.01, LEAN_REL = 45;
export const verdictOf = (ev: number, rel: number): 'BET' | 'LEAN' | 'PASS' =>
  ev >= BET_EV && rel >= BET_REL ? 'BET' : ev >= LEAN_EV && rel >= LEAN_REL ? 'LEAN' : 'PASS';

export function verdict(sides: SideValue[], rel: number, line: number, lean: Side): Verdict {
  const best = sides.slice().sort((a, b) => b.ev - a.ev)[0] ?? null;
  const name = (s: Side) => `${SIDE_LABEL[s]} de ${line}`;
  if (!best) return { code: 'NOODDS', title: `Tendencia: ${name(lean)}`, text: 'Pon la cuota de la casa para calcular si hay valor.', best };
  // Tan lejos de la casa suele ser que al modelo le falta algo: las recomendaciones no las enseñan, y aquí tampoco se dice que se apueste
  if (best.gap != null && tooFar(best.pModel, best.pModel - best.gap))
    return { code: 'PASS', title: 'No apostar', best, text: 'El modelo se aleja demasiado de la casa: lo normal es que ella sepa algo que él no (una baja, un cambio de rol).' };
  const code = verdictOf(best.ev, rel);
  if (code === 'BET') return { code, title: name(best.side), text: 'Hay valor y la muestra respalda el pronóstico.', best };
  if (code === 'LEAN') return { code, title: `${name(best.side)} (valor ligero)`, text: 'Ventaja pequeña: stake bajo o espera a una cuota mejor.', best };
  return {
    code, title: 'No apostar', best,
    text: best.ev < LEAN_EV ? 'La cuota no paga lo suficiente para la probabilidad estimada.' : 'Hay algo de valor, pero la fiabilidad es baja.'
  };
}

// Todo lo que pinta el panel de valor (components/ValuePanel.tsx)
export interface ValueData {
  line: number;
  pOver: number; pUnder: number; pPush: number;
  fairOver: number; fairUnder: number;
  margin: number | null; exact: boolean;
  sides: SideValue[];
  rel: Reliability;
  verdict: Verdict;
}

// ---------- distribuciones ----------
const erf = (x: number) => {
  // Abramowitz y Stegun 7.1.26
  const s = Math.sign(x), a = Math.abs(x), t = 1 / (1 + 0.3275911 * a);
  return s * (1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-a * a));
};
export const normCdf = (z: number) => 0.5 * (1 + erf(z / Math.SQRT2));

// Binomial negativa con media mu y varianza dada (Poisson si no hay sobredispersión)
export function discretePmf(mu: number, variance: number, kMax: number) {
  const pmf = new Array<number>(kMax + 1).fill(0);
  if (mu <= 0) { pmf[0] = 1; return pmf; }
  if (variance <= mu * 1.02) {
    pmf[0] = Math.exp(-mu);
    for (let k = 1; k <= kMax; k++) pmf[k] = (pmf[k - 1] * mu) / k;
  } else {
    const r = (mu * mu) / (variance - mu), p = r / (r + mu);
    pmf[0] = Math.pow(p, r);
    for (let k = 1; k <= kMax; k++) pmf[k] = (pmf[k - 1] * (k - 1 + r) * (1 - p)) / k;
  }
  return pmf;
}

// Más / nula / Menos de una línea: discreta para medias pequeñas, normal con corrección de continuidad para las grandes
export function lineProbs(mu: number, sigma: number, line: number) {
  const isInt = Math.abs(line - Math.round(line)) < 1e-9;
  if (mu < 12) {
    const kMax = Math.ceil(mu + 12 * Math.max(sigma, 1) + 10);
    const pmf = discretePmf(mu, sigma * sigma, kMax);
    let under = 0, push = 0;
    for (let k = 0; k <= kMax; k++) {
      if (k < line - 1e-9) under += pmf[k];
      else if (isInt && k === Math.round(line)) push += pmf[k];
    }
    return { over: Math.max(0, 1 - under - push), push, under };
  }
  const sd = Math.max(sigma, 0.5);
  if (isInt) {
    const under = normCdf((line - 0.5 - mu) / sd), over = 1 - normCdf((line + 0.5 - mu) / sd);
    return { over, push: Math.max(0, 1 - over - under), under };
  }
  const under = normCdf((Math.floor(line) + 0.5 - mu) / sd);
  return { over: 1 - under, push: 0, under };
}
