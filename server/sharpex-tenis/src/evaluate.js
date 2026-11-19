// Validación "walk-forward": el modelo predice cada partido ANTES de ver el resultado,
// y solo se puntúan los partidos de [testFrom, testTo). Así no hay trampa.
//
// scoreLevels: niveles que se puntúan (p. ej. ['C']). Los demás (ATP, ITF) sólo sirven de historial para los ratings:
// el motor apuesta en Challengers, así que es ahí donde hay que medirlo.

import { EloModel, combine, diffsOf } from './elo.js';
import { venueSurfaces } from './data.js';

// venues: la tabla de ciudades (superficie y país); si no se da, sale de los mismos partidos, como al entrenar
export function evaluate(matches, { testFrom, testTo, scoreLevels = null, modelOptions = {}, buckets = 10, includeLowData = false, venues = null } = {}) {
  const model = new EloModel(modelOptions);
  model.venues = venues ?? venueSurfaces(matches);
  const preds = [];
  for (const m of matches) {
    const scored = !(testFrom && m.date < testFrom) && !(testTo && m.date >= testTo) && !(scoreLevels && !scoreLevels.includes(m.level));
    // Predicción previa al resultado, sólo de los que se puntúan: con saque y resto, calcularla en todo el histórico es lo lento
    const p = model.update(m, { predict: scored });
    if (!scored) continue;
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

// Variables de la fase 2 que se pueden ajustar (src/form.js), con su peso en las opciones del modelo
export const FEATURES = { weeks5: 'bWeeks', lastWeek: 'bLastWeek', home: 'bHome' };

/**
 * Pesos de la mezcla (wElo, wStats), pendiente de la cola (tailSlope) y pesos de las variables pedidas en features (de
 * FEATURES: actividad y factor local), ajustados con los partidos de [tuneFrom, tuneTo). Una sola pasada guarda la
 * probabilidad del Elo, la de saque y resto y las diferencias de las variables de cada partido, que no dependen de los pesos,
 * y luego se busca lo que da menos log-loss. Como en tune, ese periodo tiene que ser distinto del que se evalúa después.
 * stats: false ajusta sólo el Elo y la cola (para comparar); las variables que no se piden se quedan en 0.
 */
export function fitWeights(matches, { tuneFrom, tuneTo, scoreLevels = null, modelOptions = {}, stats = true, features = [], venues = null } = {}) {
  for (const f of features) if (!FEATURES[f]) throw new Error(`Variable desconocida: ${f} (hay ${Object.keys(FEATURES).join(', ')})`);
  const model = new EloModel({ ...modelOptions, wStats: 1 }); // con peso, para que predict calcule las estadísticas
  model.venues = venues ?? venueSurfaces(matches);
  const xs = [];
  for (const m of matches) {
    const inTune = m.date >= tuneFrom && m.date < tuneTo && (!scoreLevels || scoreLevels.includes(m.level));
    const p = model.update(m, { predict: inTune });
    if (inTune && !p.lowData) xs.push([p.pElo, p.pStats, diffsOf(p.factors) ?? { weeks: 0, lastWeek: 0, home: 0 }]); // desde el ganador: el resultado es siempre 1
  }
  if (!xs.length) return null;
  const k = model.o.tailFrom, lg = (p) => Math.log(Math.min(0.995, Math.max(0.005, p)) / (1 - Math.min(0.995, Math.max(0.005, p))));
  const on = { weeks: features.includes('weeks5'), lastWeek: features.includes('lastWeek'), home: features.includes('home') };
  const pts = xs.map(([e, s, d]) => [lg(e), stats ? lg(s) : 0, on.weeks ? d.weeks : 0, on.lastWeek ? d.lastWeek : 0, on.home ? d.home : 0]);
  // Descenso por gradiente de la log-loss. z0 = wE·le + wS·ls; por encima de k, la cola: z = k + t·(|z0| − k) con su signo;
  // y a z se le suman las variables: bW·Δsemanas + bL·Δsemana anterior + bH·Δcasa
  let wE = 1, wS = 0, t = 1, bW = 0, bL = 0, bH = 0;
  for (let it = 0; it < 3000; it++) {
    let gE = 0, gS = 0, gT = 0, gW = 0, gL = 0, gH = 0;
    for (const [le, ls, dw, dl, dh] of pts) {
      const z0 = wE * le + wS * ls, a = Math.abs(z0), tail = a > k;
      const z = (tail ? Math.sign(z0) * (k + t * (a - k)) : z0) + bW * dw + bL * dl + bH * dh;
      const d = 1 / (1 + Math.exp(-z)) - 1; // derivada de −log σ(z)
      const dz0 = tail ? t : 1;
      gE += d * dz0 * le; gS += d * dz0 * ls;
      if (tail) gT += d * Math.sign(z0) * (a - k);
      gW += d * dw; gL += d * dl; gH += d * dh;
    }
    const lr = 1 / pts.length;
    wE -= lr * gE; if (stats) wS -= lr * gS; t = Math.min(1.5, Math.max(0.2, t - lr * gT));
    bW -= lr * gW; bL -= lr * gL; bH -= lr * gH;
  }
  const o = { ...model.o, wElo: wE, wStats: wS, tailSlope: t, bWeeks: bW, bLastWeek: bL, bHome: bH };
  const logLoss = pts.reduce((s, [, , dw, dl, dh], i) => s - Math.log(combine(xs[i][0], xs[i][1], o, { weeks: dw, lastWeek: dl, home: dh })), 0) / xs.length;
  const r3 = (v) => Math.round(v * 1000) / 1000;
  return { wElo: r3(wE), wStats: r3(wS), tailSlope: r3(t), bWeeks: r3(bW), bLastWeek: r3(bL), bHome: r3(bH), n: xs.length, logLoss };
}
