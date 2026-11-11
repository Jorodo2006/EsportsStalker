// Registro de las recomendaciones del modelo para medir si acierta (tabla bets.predictions, migración 009).
// Las calcula la interfaz (el modelo de baloncesto corre en el navegador; el de tenis lo da su servicio) y las manda aquí
// mientras se ven; el resolvedor de apuestas las cierra con evaluate, igual que las apuestas. No son de ningún usuario.
const { query } = require('../../shared/db');
const { fail } = require('../../shared/service');

const SPORTS = ['basket', 'tennis', 'football', 'lol'];
// null y '' no son 0: una recomendación sin probabilidad de la casa no dice que la casa dé 0 %
const num = (v, lo, hi) => { if (v == null || v === '') return null; const n = Number(v); return Number.isFinite(n) && n >= lo && n <= hi ? n : null; };
const txt = (v, max) => String(v ?? '').trim().slice(0, max);

// Lo que llega lo manda el navegador de cualquier usuario con sesión: se valida todo y lo que no cuadra se descarta
function clean(x) {
  if (!x || typeof x !== 'object') return null;
  const sport = txt(x.sport, 10), match = txt(x.match, 80), key = txt(x.key, 200), out = txt(x.out, 20);
  if (!SPORTS.includes(sport) || !/^[\w:.-]{1,80}$/.test(match) || !key || !/^[\w-]{1,20}$/.test(out)) return null;
  const price = num(x.price, 1.01, 1000), p = num(x.p, 0.001, 0.999), ev = num(x.ev, -1, 20);
  if (price == null || p == null || ev == null) return null;
  const start = x.start && !Number.isNaN(Date.parse(x.start)) ? new Date(x.start).toISOString() : null;
  return {
    sport, match, key, out, start, grp: txt(x.group, 60) || 'Otros', title: txt(x.title, 160) || key, event: txt(x.event, 120),
    league: txt(x.league, 60), book: txt(x.book, 30), price, p, pModel: num(x.pModel, 0, 1), pMarket: num(x.pMarket, 0, 1), ev,
    rel: num(x.rel, 0, 100) == null ? null : Math.round(Number(x.rel))
  };
}

// Se guarda la última opinión antes del partido; la cuota de la primera vez se queda (para ver si la casa la movió)
async function record(list) {
  if (!Array.isArray(list)) throw fail('Se esperaba una lista');
  const rows = list.slice(0, 400).map(clean).filter(Boolean);
  for (const r of rows) {
    await query(`
      INSERT INTO bets.predictions (sport, match, key, out, start, grp, title, event, league, book, price, first_price, p, p_model, p_market, ev, rel)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$11,$12,$13,$14,$15,$16)
      ON CONFLICT (match, key, out) DO UPDATE SET
        book = EXCLUDED.book, price = EXCLUDED.price, p = EXCLUDED.p, p_model = EXCLUDED.p_model, p_market = EXCLUDED.p_market,
        ev = EXCLUDED.ev, rel = EXCLUDED.rel, title = EXCLUDED.title, last_at = now()
      WHERE bets.predictions.status = 'pending' AND (bets.predictions.start IS NULL OR now() < bets.predictions.start)`,
    [r.sport, r.match, r.key, r.out, r.start, r.grp, r.title, r.event, r.league, r.book, r.price, r.p, r.pModel, r.pMarket, r.ev, r.rel]);
  }
  return { saved: rows.length };
}

// Las que ya deberían haber acabado. resultOf y evaluate son los del resolvedor de apuestas
async function settle(resultOf, evaluate, dayOf) {
  const { rows } = await query(`SELECT id, sport, match, key, out, start FROM bets.predictions
    WHERE status = 'pending' AND start < now() - interval '2 hours' ORDER BY start LIMIT 800`);
  let n = 0;
  for (const r of rows) {
    const ref = { sport: r.sport, match: r.match, key: r.key, out: r.out, start: r.start.toISOString() };
    const R = await resultOf({ ...ref, date: dayOf(r.start) });
    const v = R ? evaluate(ref, R) : null;
    if (v) {
      await query(`UPDATE bets.predictions SET status = $2, result = $3, settled_at = now() WHERE id = $1`, [r.id, v.status, v.text]);
      n++;
    } else if (Date.now() - +r.start > 4 * 864e5) {
      // Cuatro días después sin poder resolverla (aplazado, retirada, mercado raro): fuera de las cuentas
      await query(`UPDATE bets.predictions SET status = 'unknown', settled_at = now() WHERE id = $1`, [r.id]);
    }
  }
  return n;
}

// Las resueltas (como mucho de un año), compactas: la interfaz las agrupa como quiera
async function report() {
  const { rows } = await query(`
    SELECT sport, grp, league, book, price::float, first_price::float, p::float, p_model::float, p_market::float, ev::float, rel, status, start, title, event, result
    FROM bets.predictions WHERE status IN ('won', 'lost', 'void') AND start > now() - interval '365 days'
    ORDER BY start DESC LIMIT 20000`);
  const { rows: [c] } = await query(`SELECT count(*) FILTER (WHERE status = 'pending')::int AS pending,
    count(*) FILTER (WHERE status = 'unknown')::int AS unknown, min(first_at) AS since FROM bets.predictions`);
  return {
    pending: c.pending, unknown: c.unknown, since: c.since,
    rows: rows.map(r => ({
      sport: r.sport, group: r.grp, league: r.league, book: r.book, price: r.price, firstPrice: r.first_price, p: r.p, pModel: r.p_model,
      pMarket: r.p_market, ev: r.ev, rel: r.rel, status: r.status, start: r.start, title: r.title, event: r.event, result: r.result
    }))
  };
}

module.exports = { record, settle, report, clean };
