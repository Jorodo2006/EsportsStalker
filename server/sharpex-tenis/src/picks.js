// Recomendaciones de los Challenger (fase 3 de docs/superpowers/specs/2026-11-19-motor-challenger-v2-design.md): la probabilidad
// del modelo se mezcla con la de la casa sin margen y salen dos tipos, cada uno en su tramo de cuota:
//  - Valor: valor esperado por encima de un mínimo con la probabilidad mezclada.
//  - Alta probabilidad: muy probable y sin regalar el margen, pero sin ventaja sobre la casa (lo dice siempre).
//
// Fase 0 (19-11-2026, 155 Challengers del cuadro final de producción, del 12 al 18 de noviembre): la mezcla mejora un poco a la
// casa de cierre (log-loss 0,5932 → 0,5900 al 25 %, sin margen suficiente para darlo por seguro), el mejor peso del modelo en la
// mitad grande es 0,15-0,20 y comprobado en la otra también mejora; y las que el modelo solo daría como valor pierden frente a la
// cuota de cierre (CLV −7,2 % ± 1,3 % en 58). Por eso el peso es 0,20 y Valor se calcula y se registra pero no se enseña
// (VALUE_VISIBLE) hasta que el CLV de las registradas diga lo contrario.

import { fairProbs } from './odds.js';
import { RETIRE } from './form.js';

export const PICKS = {
  w: 0.2, // peso del modelo frente a la casa en la mezcla (fase 0)
  maxGap: 0.2, // más diferencia con la casa sobre quién gana: casi siempre una cuota mal leída o algo que el modelo no sabe
  tramos: [
    { id: 'baja', min: 1.15, max: 1.6, valor: 0.03, alta: 0.75 },
    { id: 'media', min: 1.6, max: 2.5, valor: 0.04, alta: 0.75 },
    { id: 'alta', min: 2.5, max: 6, valor: 0.07, alta: null }, // en cuotas altas no hay "alta probabilidad"
  ],
  relValor: 55,
  relAlta: 65,
  altaMinEv: -0.03, // Alta probabilidad: que no regale el margen entero
  altaMaxGap: 0.05, // y que el modelo y la casa estén de acuerdo
  staleMs: 6 * 3600e3,
};
// Valor no se enseña mientras la fase 0 no diga que el modelo gana a la cuota de cierre (sí se calcula y se registra)
export const VALUE_VISIBLE = false;

// Qué hace cada casa con la apuesta al ganador si un jugador se retira (fase 4). Winamax la anula y devuelve lo apostado (su
// reglamento, sección Tenis; la «Garantía Abandono», que la paga, es sólo para la ATP y la WTA: los Challenger no entran). Betway:
// también la anula según las comparativas, sin confirmar en su reglamento de España. 'paga': la da por ganada al que sigue
export const RETIRE_RULE = { winamax: 'anula', betway: 'anula' };
const ruleOf = (book) => RETIRE_RULE[String(book ?? '').toLowerCase()] ?? 'anula';
// Los avisos físicos: el del tiempo muerto médico (tmo_reciente) aún no tiene fuente
const PHYSICAL = ['retirada_reciente', 'tmo_reciente', 'ranking_protegido'];

/** Valor esperado con la regla de la casa: si anula, con una retirada se recupera lo apostado (ni se gana ni se pierde). */
export function evWithRetirement(p, price, r, rule = 'anula') {
  return rule === 'anula' ? (1 - r) * (p * price - 1) : p * price - 1;
}

const logit = (p) => Math.log(p / (1 - p));
const clampP = (p) => Math.min(0.995, Math.max(0.005, p));
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/** Probabilidad final: σ(w · logit modelo + (1 − w) · logit casa sin margen). */
export function blendWithMarket(pModel, pMarket, w = PICKS.w) {
  return 1 / (1 + Math.exp(-(w * logit(clampP(pModel)) + (1 - w) * logit(clampP(pMarket)))));
}

/**
 * El mercado de ganador de un partido con lo último de cada casa: books = { Casa: { a, b, ts } }. Devuelve la probabilidad de
 * A sin margen (método potencia, media de las casas), la mejor cuota de cada uno con su casa, cuántas casas y la edad de la
 * lectura más reciente. null si no hay ninguna con las dos cuotas.
 */
export function marketOf(books, now = Date.now()) {
  const list = Object.entries(books ?? {}).filter(([, x]) => x?.a > 1 && x?.b > 1);
  if (!list.length) return null;
  const pA = list.reduce((s, [, x]) => s + fairProbs(x.a, x.b)[0], 0) / list.length;
  const best = { a: { price: 0, book: '' }, b: { price: 0, book: '' } };
  for (const [book, x] of list) for (const s of ['a', 'b']) if (x[s] > best[s].price) best[s] = { price: x[s], book };
  const ts = Math.max(...list.map(([, x]) => x.ts || 0));
  return { pA, best, books: list.length, ageMs: ts ? Math.max(0, now - ts) : null };
}

/**
 * Cuánto nos fiamos del cálculo (0-100), no de que salga: datos de los dos jugadores, acuerdo entre el modelo y la casa sobre quién
 * gana, las cuotas (cuántas casas y de cuándo) y el contexto (superficie y actividad al día). Misma forma que la del tenis
 * (server/services/tennis/picks.js), para enseñarla igual.
 */
export function reliabilityOf({ minMatches, gap, books, ageMs, surfaceKnown, stale }) {
  const factors = [
    { label: 'Datos de los jugadores', max: 30, score: 30 * clamp(minMatches / 60, 0, 1), note: `${minMatches} partidos el que menos` },
    { label: 'Modelo y casa de acuerdo', max: 35, score: 35 * clamp(1 - (gap - 0.03) / 0.15, 0, 1), note: `${Math.round(gap * 100)} puntos de diferencia sobre quién gana` },
    { label: 'Cuotas', max: 20, score: 20 * (books > 1 ? 1 : 0.6) * (ageMs != null && ageMs > PICKS.staleMs ? 0.4 : 1), note: `${books} ${books > 1 ? 'casas' : 'casa'}` },
    { label: 'Contexto', max: 15, score: 15 * (surfaceKnown ? 1 : 0.5) * (stale ? 0.6 : 1), note: [surfaceKnown ? '' : 'superficie sin confirmar', stale ? 'actividad sin la semana anterior' : ''].filter(Boolean).join(', ') || 'superficie y actividad al día' },
  ];
  const score = Math.round(clamp(factors.reduce((t, f) => t + f.score, 0), 0, 100));
  return { score, label: score >= 70 ? 'Alta' : score >= 50 ? 'Media' : 'Baja', factors, warnings: [] };
}

/**
 * Las recomendaciones de un partido.
 *   pred: lo que da EloModel.predict (pA, nA, nB, lowData, factors)
 *   market: lo de marketOf
 *   surfaceKnown: si la superficie del torneo se sabe
 * Devuelve { pModel, pMarket, pFinal, gap, rel, avisos, who, retirada, picks, excluded } con picks = [{ tipo: 'valor' | 'probabilidad', tramo,
 * side: 'a' | 'b', p, pModel, pMarket, ev, price, book, rel, avisos, visible }]. excluded dice por qué no hay ninguna.
 */
export function picksOfMatch({ pred, market, surfaceKnown = true }, o = PICKS) {
  const avisos = [];
  const who = {}; // de qué jugador es cada aviso: { local: ['a'], retirada_reciente: ['b'] }
  const flag = (aviso, sides) => { if (sides.length) { avisos.push(aviso); who[aviso] = sides; } };
  const f = pred?.factors;
  const sidesOf = (xs, test) => ['a', 'b'].filter((_, i) => test(xs?.[i]));
  flag('local', sidesOf(f?.home, (h) => h === 1));
  if (f?.stale) avisos.push('datos_viejos');
  flag('pocos_datos', sidesOf([pred?.nA ?? 0, pred?.nB ?? 0], (n) => n < 25));
  // Avisos físicos (fase 4): retirada en los últimos 90 días y ranking protegido. El tiempo muerto médico aún no tiene fuente
  flag('retirada_reciente', sidesOf(f?.recentRet, Boolean));
  flag('ranking_protegido', sidesOf(f?.pr, Boolean));
  const minMatches = Math.min(pred?.nA ?? 0, pred?.nB ?? 0);
  const rA = f?.retire?.[0] ?? RETIRE.base, rB = f?.retire?.[1] ?? RETIRE.base;
  const retirada = { a: rA, b: rB, total: rA + rB };
  if (!pred || !market) return { avisos, who, retirada, picks: [], excluded: !pred ? 'sin_modelo' : 'sin_cuotas' };
  const pModel = pred.pA, pMarket = market.pA, gap = Math.abs(pModel - pMarket);
  const pFinal = blendWithMarket(pModel, pMarket, o.w);
  const rel = reliabilityOf({ minMatches, gap, books: market.books, ageMs: market.ageMs, surfaceKnown, stale: !!f?.stale });
  const base = { pModel, pMarket, pFinal, gap, rel, avisos, who, retirada };
  if (pred.lowData) return { ...base, picks: [], excluded: 'pocos_datos' };
  if (gap > o.maxGap) return { ...base, picks: [], excluded: 'discrepancia' };
  // Avisos físicos (retirada reciente, tiempo muerto médico, ranking protegido): sin alta probabilidad para quien lo tiene. El
  // de su rival no la quita: su riesgo de retirada ya está en el valor esperado (con la regla de la casa) y, si se retira, gana
  const physicalOf = (side) => PHYSICAL.some((a) => who[a]?.includes(side));
  const picks = [];
  for (const side of ['a', 'b']) {
    const { price, book } = market.best[side];
    const tramo = o.tramos.find((t) => price >= t.min && price < t.max);
    if (!tramo) continue;
    const p = side === 'a' ? pFinal : 1 - pFinal;
    const pm = side === 'a' ? pModel : 1 - pModel, pc = side === 'a' ? pMarket : 1 - pMarket;
    // Con la regla de la casa para las retiradas: si la anula, la apuesta se recupera en las retiradas de cualquiera de los dos
    const ev = evWithRetirement(p, price, retirada.total, ruleOf(book));
    const pick = { tramo: tramo.id, side, p, pModel: pm, pMarket: pc, ev, price, book, rel: rel.score, avisos };
    if (ev >= tramo.valor && rel.score >= o.relValor) picks.push({ ...pick, tipo: 'valor', visible: VALUE_VISIBLE });
    if (tramo.alta != null && p >= tramo.alta && rel.score >= o.relAlta && ev >= o.altaMinEv && gap < o.altaMaxGap && !physicalOf(side)) {
      picks.push({ ...pick, tipo: 'probabilidad', visible: true });
    }
  }
  return { ...base, picks, excluded: picks.length ? null : 'ninguna' };
}
