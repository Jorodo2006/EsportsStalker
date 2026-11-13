// Validación "walk-forward": el modelo predice cada partido ANTES de ver el resultado,
// y solo se puntúan los partidos de [testFrom, testTo). Así no hay trampa.
//
// scoreLevels: niveles que se puntúan (p. ej. ['C']). Los demás (ATP, ITF) sólo sirven de historial para los ratings:
// el motor apuesta en Challengers, así que es ahí donde hay que medirlo.

import { EloModel } from './elo.js';

export function evaluate(matches, { testFrom, testTo, scoreLevels = null, modelOptions = {}, buckets = 10, includeLowData = false } = {}) {
  const model = new EloModel(modelOptions);
  const preds = [];
  for (const m of matches) {
    const p = model.update(m); // predicción previa al resultado
    if (testFrom && m.date < testFrom) continue;
    if (testTo && m.date >= testTo) continue;
    if (scoreLevels && !scoreLevels.includes(m.level)) continue;
    if (!includeLowData && p.lowData) continue;
    // Para no sesgar, puntuamos desde el punto de vista del jugador con mayor rating.
    const favWon = p.pA >= 0.5;
    const pFav = favWon ? p.pA : 1 - p.pA;
    preds.push({ p: pFav, y: favWon ? 1 : 0, date: m.date, surface: m.surface });
  }
  return { model, metrics: metrics(preds, buckets), n: preds.length };
}

export function metrics(preds, buckets = 10) {
  if (!preds.length) return null;
  let brier = 0, logLoss = 0, correct = 0;
  const cal = Array.from({ length: buckets }, () => ({ n: 0, sumP: 0, wins: 0 }));
  for (const { p, y } of preds) {
    const pc = Math.min(Math.max(p, 1e-6), 1 - 1e-6);
    brier += (p - y) ** 2;
    logLoss += -(y * Math.log(pc) + (1 - y) * Math.log(1 - pc));
    if ((p >= 0.5 ? 1 : 0) === y) correct++;
    // p del favorito está en [0.5, 1]; repartimos en tramos dentro de ese rango.
    const b = Math.min(buckets - 1, Math.floor(((p - 0.5) / 0.5) * buckets));
    cal[b].n++; cal[b].sumP += p; cal[b].wins += y;
  }
  const n = preds.length;
  return {
    n,
    accuracy: correct / n,
    brier: brier / n,
    logLoss: logLoss / n,
    calibration: cal
      .map((c, i) => ({
        range: `${(50 + (i * 50) / buckets).toFixed(0)}-${(50 + ((i + 1) * 50) / buckets).toFixed(0)}%`,
        n: c.n,
        predicted: c.n ? c.sumP / c.n : null,
        actual: c.n ? c.wins / c.n : null,
      }))
      .filter((c) => c.n > 0),
  };
}

/**
 * Prueba varias combinaciones de parámetros y devuelve la mejor por log-loss en [tuneFrom, tuneTo).
 * Ese periodo tiene que ser distinto del que se evalúa después: si se ajusta y se puntúa con los mismos
 * partidos, las cifras salen mejores de lo que serán con partidos nuevos.
 */
export function tune(matches, { tuneFrom, tuneTo, scoreLevels = null, grid } = {}) {
  const g = grid ?? {
    surfaceWeight: [0.2, 0.3, 0.5],
    kBase: [200, 250, 300],
    kShape: [0.3, 0.4, 0.5],
  };
  const results = [];
  for (const surfaceWeight of g.surfaceWeight)
    for (const kBase of g.kBase)
      for (const kShape of g.kShape) {
        const opts = { surfaceWeight, kBase, kShape };
        const { metrics: mt } = evaluate(matches, { testFrom: tuneFrom, testTo: tuneTo, scoreLevels, modelOptions: opts });
        if (mt) results.push({ ...opts, logLoss: mt.logLoss, brier: mt.brier, accuracy: mt.accuracy, n: mt.n });
      }
  results.sort((a, b) => a.logLoss - b.logLoss);
  return results;
}
