// Reajuste diario del modelo de baloncesto con los resultados de cada día (bets.predictions, que guarda todas las líneas calculadas
// con lo que dijo el modelo, p_model, y la casa sin margen, p_market). Lo que se ajusta es cuánto pesa el modelo frente a la casa
// (MODEL_WEIGHT de src/lib/basket-model.ts para las líneas de jugador y de basket-teams.ts para los totales y los puntos de equipo),
// con la misma mezcla que la interfaz (blendWithMarket de src/lib/value.ts).
// Sin sobreentrenarse: se ajusta con lo resuelto hasta hace una semana y se PRUEBA con la última semana, que no se ha usado para
// ajustar. Sólo cambia si en la prueba mejora (pérdida logarítmica más baja que con el peso de ahora), con muestra suficiente, como
// mucho 0,05 al día y entre 0 y 0,5. En noviembre de 2026, en los totales el mejor peso del ajuste (0,85) lo hacía peor en la prueba
// que la casa sola: ese es el error que esto evita. Cada intento se guarda (bets.model_tuning), aplicado o no
const { query } = require('../../shared/db');

const DEFAULTS = { player: 0.3, team: 0.25 };
const RULES = { fitDays: 45, testDays: 7, minFit: 3000, minTest: 500, minGain: 0.0002, step: 0.05, max: 0.5 };
const GRID = Array.from({ length: 21 }, (_, i) => Math.round(i * 0.05 * 100) / 100); // 0 a 1

// La mezcla de la interfaz: el peso del modelo es mayor cerca del 50 % y nada en los extremos
const logit = p => Math.log(p / (1 - p)), sigmoid = x => 1 / (1 + Math.exp(-x));
const inBounds = p => Math.min(0.995, Math.max(0.005, p));
function blend(pModel, fair, w) {
  const ww = w * 4 * fair * (1 - fair);
  return sigmoid(ww * logit(inBounds(pModel)) + (1 - ww) * logit(inBounds(fair)));
}
// Pérdida logarítmica media de unas líneas resueltas ({ m: p_model, f: p_market, y: 1 si acertó }) con un peso
function logLoss(rows, w) {
  if (!rows.length) return null;
  let s = 0;
  for (const r of rows) { const p = inBounds(blend(r.m, r.f, w)); s -= r.y ? Math.log(p) : Math.log(1 - p); }
  return s / rows.length;
}
const r4 = v => (v == null ? null : Math.round(v * 1e4) / 1e4);

// Lo puro: con las de ajuste y las de prueba y el peso de ahora, el nuevo peso y por qué
function fitWeight(fit, test, current, rules = RULES) {
  const base = { prev: current, nFit: fit.length, nTest: test.length };
  if (fit.length < rules.minFit || test.length < rules.minTest) {
    return { ...base, fitW: current, w: current, applied: false, reason: `poca muestra (${fit.length} de ajuste, ${test.length} de prueba)`, ll: {} };
  }
  const fitW = GRID.reduce((b, w) => (logLoss(fit, w) < logLoss(fit, b) ? w : b), 0);
  // Un paso como mucho hacia el del ajuste, y nunca más de max
  const toward = Math.max(0, Math.min(rules.max, current + Math.max(-rules.step, Math.min(rules.step, fitW - current))));
  const w = Math.round(toward * 100) / 100;
  const ll = { prev: r4(logLoss(test, current)), next: r4(logLoss(test, w)), market: r4(logLoss(test, 0)), model: r4(logLoss(test, 1)) };
  if (w === current) return { ...base, fitW, w: current, applied: false, reason: 'el ajuste da el mismo peso', ll };
  if (!(ll.next < ll.prev - rules.minGain)) {
    return { ...base, fitW, w: current, applied: false, reason: `en la prueba no mejora (${String(ll.prev).replace('.', ',')} → ${String(ll.next).replace('.', ',')})`, ll };
  }
  return { ...base, fitW, w, applied: true, reason: `mejora en la prueba (${String(ll.prev).replace('.', ',')} → ${String(ll.next).replace('.', ',')})`, ll };
}

// Los pesos de ahora (el último aplicado de cada tipo, o el de siempre)
async function weights() {
  const { rows } = await query(`SELECT DISTINCT ON (kind) kind, w, day FROM bets.model_tuning ORDER BY kind, day DESC`);
  const out = { ...DEFAULTS, updated: null };
  for (const r of rows) { out[r.kind] = Number(r.w); out.updated = out.updated && out.updated > r.day ? out.updated : r.day; }
  return out;
}

const madridDay = (d = new Date()) => d.toLocaleDateString('sv-SE', { timeZone: 'Europe/Madrid' });
// Una vez al día: las líneas de jugador (player|…) y las de equipo (total|…, team_total|…) por separado
async function run() {
  const day = madridDay();
  const done = (await query('SELECT count(*)::int AS n FROM bets.model_tuning WHERE day = $1', [day])).rows[0].n;
  if (done >= 2) return null;
  const now = await weights();
  const { rows } = await query(`SELECT CASE WHEN key LIKE 'player|%' THEN 'player' ELSE 'team' END AS kind, start, p_model, p_market, status
    FROM bets.predictions
    WHERE sport = 'basket' AND status IN ('won', 'lost') AND p_model IS NOT NULL AND p_market IS NOT NULL
      AND (key LIKE 'player|%' OR key LIKE 'total|%' OR key LIKE 'team_total|%')
      AND start > now() - make_interval(days => $1)`, [RULES.fitDays + RULES.testDays]);
  const cut = Date.now() - RULES.testDays * 864e5;
  const out = {};
  for (const kind of ['player', 'team']) {
    const xs = rows.filter(r => r.kind === kind).map(r => ({ t: +new Date(r.start), m: Number(r.p_model), f: Number(r.p_market), y: r.status === 'won' ? 1 : 0 }));
    const r = fitWeight(xs.filter(x => x.t < cut), xs.filter(x => x.t >= cut), now[kind]);
    await query(`INSERT INTO bets.model_tuning (day, kind, prev_w, fit_w, w, applied, reason, n_fit, n_test, ll_prev, ll_new, ll_market, ll_model)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) ON CONFLICT (day, kind) DO NOTHING`,
    [day, kind, r.prev, r.fitW, r.w, r.applied, r.reason, r.nFit, r.nTest, r.ll.prev ?? null, r.ll.next ?? null, r.ll.market ?? null, r.ll.model ?? null]);
    out[kind] = r;
  }
  return out;
}

// Los pesos de ahora y los últimos intentos (para Acierto del modelo)
async function summary() {
  const { rows } = await query(`SELECT day, kind, prev_w, fit_w, w, applied, reason, n_fit, n_test, ll_prev, ll_new, ll_market, ll_model
    FROM bets.model_tuning ORDER BY day DESC, kind LIMIT 28`);
  const num = v => (v == null ? null : Number(v));
  return {
    ...(await weights()),
    history: rows.map(r => ({ day: r.day instanceof Date ? r.day.toISOString().slice(0, 10) : String(r.day), kind: r.kind, prev: num(r.prev_w), fit: num(r.fit_w), w: num(r.w), applied: r.applied, reason: r.reason, nFit: r.n_fit, nTest: r.n_test, ll: { prev: num(r.ll_prev), next: num(r.ll_new), market: num(r.ll_market), model: num(r.ll_model) } }))
  };
}

// A los 2 min de arrancar y luego cada hora (sólo hace algo una vez al día)
function startTuning() {
  const go = () => run().then(r => r && console.log('Ajuste del modelo de baloncesto:', JSON.stringify({ player: r.player?.reason, team: r.team?.reason }))).catch(e => console.error('Ajuste del modelo:', e.message));
  setTimeout(go, 120e3);
  setInterval(go, 3600e3);
}

module.exports = { fitWeight, logLoss, blend, weights, summary, run, startTuning, DEFAULTS, RULES };
