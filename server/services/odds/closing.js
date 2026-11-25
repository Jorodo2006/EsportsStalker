// Cuota de cierre: la última que tenía cada casa antes de empezar el partido, del histórico (odds.price_history). Sirve para el
// CLV (closing line value): apostar a mejor cuota que la de cierre es la mejor señal de que se gana a la larga, mejor que el
// beneficio, que con pocas apuestas es casi todo suerte. La piden las apuestas y las recomendaciones (bets, /internal/odds/closing).
const { query } = require('../../shared/db');
const { mentionsTeam } = require('../../shared/mentions');

const NEAR = 6 * 3600e3; // el inicio de la apuesta y el del comparador pueden no coincidir del todo (como sameStart en alerts.js)
// Una cuota vista por última vez más de 3 h antes de empezar no es la de cierre: el partido no se leyó cerca del inicio
const FRESH = 3 * 3600e3;
const SPORTS = ['lol', 'basket', 'tennis', 'football', 'mma'];

// El partido del comparador de una apuesta: mismo deporte, inicio cercano y el texto del partido nombra a los dos. Con varios, el
// de inicio más cercano. Pura (pruebas en server/test/cierre.test.js)
function pickMatch(item, matches) {
  const t = +new Date(item.start);
  const ok = matches.filter(m => m.sport === item.sport && m.start && Math.abs(+new Date(m.start) - t) <= NEAR
    && mentionsTeam(item.event, m.a) && mentionsTeam(item.event, m.b));
  return ok.sort((x, y) => Math.abs(+new Date(x.start) - t) - Math.abs(+new Date(y.start) - t))[0] || null;
}

// De las filas del histórico de una selección (una por tramo de precio y casa), la que estaba vigente al empezar en cada casa,
// si se vio cerca del inicio. { winamax: { price, at }, betway: … }. Pura
function closeOf(rows, start) {
  const t = +new Date(start), out = {};
  for (const r of rows) {
    const ts = +new Date(r.ts), seen = +new Date(r.last_seen);
    if (ts > t) continue;
    const prev = out[r.book];
    if (prev && prev.ts >= ts) continue;
    out[r.book] = { ts, price: Number(r.price), at: new Date(Math.min(seen, t)).toISOString(), fresh: t - Math.min(seen, t) <= FRESH };
  }
  return Object.fromEntries(Object.entries(out).filter(([, v]) => v.fresh && v.price > 1).map(([b, v]) => [b, { price: v.price, at: v.at }]));
}

// items: [{ sport, start, event, key, out }] → la misma lista con { start, books } o null si no hay cierre
async function closingFor(items) {
  const list = (Array.isArray(items) ? items : []).slice(0, 300).map(x => ({
    sport: String(x?.sport || 'lol'), start: x?.start && !Number.isNaN(Date.parse(x.start)) ? new Date(x.start).toISOString() : null,
    event: String(x?.event || '').slice(0, 200), key: String(x?.key || '').slice(0, 200), out: String(x?.out || '').slice(0, 20)
  }));
  const valid = list.filter(x => SPORTS.includes(x.sport) && x.start && x.event && x.key && x.out);
  if (!valid.length) return list.map(() => null);
  const times = valid.map(x => +new Date(x.start));
  const { rows: matches } = await query(`SELECT key, a, b, start, sport FROM odds.matches
    WHERE start BETWEEN $1::timestamptz AND $2::timestamptz`, [new Date(Math.min(...times) - NEAR).toISOString(), new Date(Math.max(...times) + NEAR).toISOString()]);
  const out = [];
  for (const x of list) {
    const m = valid.includes(x) ? pickMatch(x, matches) : null;
    if (!m) { out.push(null); continue; }
    // Sólo las filas de este partido y no de otro anterior entre los mismos (como sameMatch en bridge.js)
    const { rows } = await query(`SELECT book, price, ts, last_seen FROM odds.price_history
      WHERE match_key = $1 AND market_key = $2 AND outcome_id = $3 AND ts <= $4::timestamptz
        AND (match_start IS NULL OR abs(extract(epoch FROM match_start - $4::timestamptz)) < 43200)`, [m.key, x.key, x.out, m.start]);
    const books = closeOf(rows, m.start);
    out.push(Object.keys(books).length ? { start: new Date(m.start).toISOString(), books } : null);
  }
  return out;
}

module.exports = { closingFor, pickMatch, closeOf };
