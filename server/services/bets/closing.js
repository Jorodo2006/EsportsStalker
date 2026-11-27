// Cuota de cierre de las apuestas y de las recomendaciones del modelo (tabla bets.closing y columnas close_* de bets.predictions,
// migración 022), para el CLV. La da el servicio de cuotas (odds/closing.js) con su histórico; aquí se decide cuál vale para cada
// una y se guarda. Corre al final de cada pasada del resolvedor (settle.js). Como el resolvedor, lee apuestas de todos: sólo para
// esto, nunca en una ruta.
const { query } = require('../../shared/db');
const client = require('../../shared/client');

const AFTER = 10 * 60e3;   // se busca a partir de 10 min después del inicio (la última lectura antes de empezar ya está)
const GIVE_UP = 6 * 3600e3; // a las 6 h sin cuota de cierre se apunta que no la hay y no se busca más
const DAYS = 10;            // apuestas de los últimos días (las de antes ya no tienen lecturas cerca)
const BATCH = 300;

// La casa de una apuesta o recomendación ("Winamax", "betway"…) con el nombre del histórico; '' si es otra o no se sabe
const bookOf = s => (/winamax/i.test(s || '') ? 'winamax' : /betway/i.test(s || '') ? 'betway' : '');

// La cuota de cierre que cuenta: la de la misma casa si la hay; si no (otra casa, o la suya no se leyó), la mejor de las que hay,
// que es la más difícil de batir. Pura (server/test/cierre.test.js)
function chooseClose(books, bookmaker) {
  const entries = Object.entries(books || {}).filter(([, v]) => v && v.price > 1);
  if (!entries.length) return null;
  const own = entries.find(([b]) => b === bookOf(bookmaker));
  const [book, v] = own || entries.sort((a, b) => b[1].price - a[1].price)[0];
  return { book, price: v.price, at: v.at };
}

// Las selecciones de una apuesta que necesitan cuota de cierre: la simple (pos −1) o cada selección de la combinada, con su ref y
// ya empezadas. have: las que ya tiene guardadas ({ pos, match, key, out }). Pura
function pendingOf(bet, have, now = Date.now()) {
  const items = bet.legs?.length ? bet.legs.map((l, pos) => ({ pos, it: l })) : [{ pos: -1, it: bet }];
  return items.filter(({ pos, it }) => {
    const r = it.ref;
    if (!r?.start || !r.key || !r.out || now - +new Date(r.start) < AFTER) return false;
    const h = have.find(c => c.pos === pos);
    return !h || h.match !== r.match || h.key !== r.key || h.out !== r.out;
  }).map(({ pos, it }) => ({ pos, ref: it.ref, event: it.event || bet.event, sport: it.ref.sport || it.sport || bet.sport || 'lol' }));
}

const ask = items => client.call('odds', 'POST', '/internal/odds/closing', { items }, 60e3);

async function forBets() {
  const { rows } = await query(`
    SELECT b.id, b.event, b.sport, b.bookmaker, b.ref,
      (SELECT json_agg(json_build_object('event', l.event, 'sport', l.sport, 'ref', l.ref) ORDER BY l.pos) FROM bets.bet_legs l WHERE l.bet_id = b.id) AS legs,
      (SELECT json_agg(json_build_object('pos', c.pos, 'match', c.match, 'key', c.key, 'out', c.out)) FROM bets.closing c WHERE c.bet_id = b.id) AS have
    FROM bets.bets b
    WHERE b.date >= current_date - ${DAYS} AND b.status <> 'void'
      AND (b.ref IS NOT NULL OR EXISTS (SELECT 1 FROM bets.bet_legs l WHERE l.bet_id = b.id AND l.ref IS NOT NULL))
    ORDER BY b.date DESC LIMIT 2000`);
  const want = [];
  for (const b of rows) {
    for (const p of pendingOf({ ...b, legs: b.legs || [] }, b.have || [])) want.push({ bet: b, ...p });
    if (want.length >= BATCH) break;
  }
  if (!want.length) return 0;
  const found = await ask(want.map(w => ({ sport: w.sport, start: w.ref.start, event: w.event, key: w.ref.key, out: w.ref.out })));
  let n = 0;
  for (const [i, w] of want.entries()) {
    const c = chooseClose(found?.[i]?.books, w.bet.bookmaker);
    if (!c && Date.now() - +new Date(w.ref.start) < GIVE_UP) continue; // se vuelve a mirar en la próxima pasada
    await query(`INSERT INTO bets.closing (bet_id, pos, match, key, out, price, book, at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      ON CONFLICT (bet_id, pos) DO UPDATE SET match = EXCLUDED.match, key = EXCLUDED.key, out = EXCLUDED.out, price = EXCLUDED.price,
        book = EXCLUDED.book, at = EXCLUDED.at, checked_at = now()`,
    [w.bet.id, w.pos, w.ref.match, w.ref.key, w.ref.out, c?.price ?? null, c?.book ?? '', c?.at ?? null]);
    n++;
  }
  return n;
}

async function forPredictions() {
  const { rows } = await query(`SELECT id, sport, start, event, key, out, book FROM bets.predictions
    WHERE NOT close_checked AND start < now() - interval '10 minutes' AND start > now() - interval '${DAYS} days'
    ORDER BY start DESC LIMIT ${BATCH}`);
  if (!rows.length) return 0;
  const found = await ask(rows.map(r => ({ sport: r.sport, start: r.start, event: r.event, key: r.key, out: r.out })));
  let n = 0;
  for (const [i, r] of rows.entries()) {
    const c = chooseClose(found?.[i]?.books, r.book);
    if (!c && Date.now() - +new Date(r.start) < GIVE_UP) continue;
    await query(`UPDATE bets.predictions SET close_price = $2, close_book = $3, close_at = $4, close_checked = true WHERE id = $1`,
      [r.id, c?.price ?? null, c?.book ?? null, c?.at ?? null]);
    n++;
  }
  // Las que ya no se buscarán (empezaron hace más de DAYS días): sin cierre
  await query(`UPDATE bets.predictions SET close_checked = true WHERE NOT close_checked AND start < now() - interval '${DAYS} days'`);
  return n;
}

async function run() {
  try { await forBets(); } catch (e) { console.error('Cuota de cierre (apuestas):', e.message); }
  try { await forPredictions(); } catch (e) { console.error('Cuota de cierre (recomendaciones):', e.message); }
}

module.exports = { run, chooseClose, pendingOf, bookOf };
