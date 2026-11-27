// Surebets: mercados en los que, apostando a cada selección en la casa que mejor la paga (Winamax o Betway), se gana pase lo que
// pase. Pasa cuando la suma de 1/cuota de las mejores es menor que 1: con 2,10 en una casa y 2,05 en la otra en un mercado de dos
// salidas, 1/2,10 + 1/2,05 = 0,964 y se gana un 3,7 % de lo apostado. Sólo con las cuotas ya leídas (las mismas del comparador,
// getMatchOdds): no lee nada nuevo ni añade lecturas. Las casas limitan las cuentas que lo hacen, y una cuota puede haber cambiado
// desde la lectura: la interfaz lo dice y deja volver a leer el partido.
const { query } = require('../../shared/db');

// Mercados que se pueden cubrir: todas sus selecciones juntas son todo lo que puede pasar y sólo una gana. La doble oportunidad
// no (1X y X2 ganan las dos con empate), ni los mercados propios de una casa (wmx|, winamax|, betway|), que no se comparan
const COVERABLE = new Set(['moneyline', 'spread', 'total', 'team_total', 'dnb', 'btts', 'player', 'method', 'distance', 'total_rounds', 'corners', 'cards']);
// Más de un 8 % es casi siempre un error de lectura (una línea o un periodo cambiados en una casa), no un regalo: fuera
const MAX_EDGE = 0.08;
// Desde un 3 % se avisa de que lo compruebe antes de apostar
const CHECK_EDGE = 0.03;
const HOURS = 48; // lo que se lee (scheduler.js): más allá no hay cuotas
const CACHE_MS = 2 * 60e3;

// Las surebets de un partido a partir de lo que da el comparador (Book.result: mercados con sus selecciones y la cuota de cada
// casa). Pura, con pruebas en server/test/surebets.test.js
function arbsOf(result) {
  const out = [];
  for (const m of result?.markets || []) {
    if (!COVERABLE.has(String(m.key).split('|')[0])) continue;
    const legs = m.outcomes.map(o => {
      const best = Object.entries(o.prices || {}).filter(([, p]) => p > 1).sort((a, b) => b[1] - a[1])[0];
      return best ? { id: o.id, label: o.label, book: best[0], price: best[1] } : null;
    });
    // Todas las selecciones con cuota, y de las dos casas: una sola casa no da surebets (sería un error de lectura)
    if (legs.length < 2 || legs.some(l => !l) || new Set(legs.map(l => l.book)).size < 2) continue;
    const sum = legs.reduce((s, l) => s + 1 / l.price, 0);
    const edge = 1 / sum - 1;
    if (edge <= 0 || edge > MAX_EDGE) continue;
    out.push({ key: m.key, market: m.group, legs, sum: round(sum, 4), edge: round(edge, 4), check: edge >= CHECK_EDGE });
  }
  return out.sort((a, b) => b.edge - a.edge);
}
const round = (v, d) => Math.round(v * 10 ** d) / 10 ** d;

let cache = null;
// Partidos por empezar en las próximas 48 h con cuotas vigentes de las dos casas, y sus surebets. force: sin la caché (después de
// volver a leer un partido desde la pantalla)
async function scan(getMatchOdds, fresh, force = false) {
  if (!force && cache && Date.now() - cache.at < CACHE_MS) return cache.data;
  const { rows } = await query(`SELECT m.key, m.a, m.b, m.start, m.sport, m.league FROM odds.matches m
    WHERE m.start > now() AND m.start < now() + interval '${HOURS} hours'
      AND (SELECT count(DISTINCT i.book) FROM odds.imports i WHERE i.match_key = m.key AND ${fresh}) >= 2
    ORDER BY m.start LIMIT 400`);
  const list = [];
  for (const r of rows) {
    const match = { a: r.a, b: r.b, start: r.start, sport: r.sport || 'lol', league: r.league || '' };
    try {
      const res = await getMatchOdds(match);
      const arbs = arbsOf(res);
      if (!arbs.length) continue;
      // Cuándo se leyó cada casa: una surebet de lecturas viejas puede no existir ya
      const read = Object.fromEntries(Object.entries(res.sources || {}).filter(([, s]) => s?.ok && s.ts).map(([b, s]) => [b, s.ts]));
      list.push({ match: { ...match, start: new Date(r.start).toISOString() }, read, arbs });
    } catch (e) { console.warn('Surebets', r.key, e.message); }
  }
  const data = { at: new Date().toISOString(), matches: rows.length, list };
  cache = { at: Date.now(), data };
  return data;
}

module.exports = { scan, arbsOf, MAX_EDGE, CHECK_EDGE };
