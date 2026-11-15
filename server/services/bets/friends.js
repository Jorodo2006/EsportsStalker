// Amigos y apuestas compartidas (migración 013). Cada usuario añade a otro por su nombre; cuando el otro acepta, cada uno
// puede enviarle apuestas suyas. Lo que se envía es una copia de lo que se apuesta (sin el importe, el resultado ni las notas
// de quien la envía) y el amigo la puede copiar a sus apuestas con su propio importe.
// El usuario sale siempre del gateway (who(req) en index.js), nunca de lo que mande el navegador: sólo se ven las solicitudes
// y las recibidas propias, sólo se envían apuestas propias y sólo a amigos aceptados.
const { query, tx } = require('../../shared/db');
const { fail } = require('../../shared/service');
const store = require('./store');

const MAX_FRIENDS = 200;
const MAX_PENDING = 30; // solicitudes enviadas sin contestar: que nadie las mande a todos los nombres que se le ocurran
const MAX_TO = 20; // amigos a los que se envía una apuesta de una vez
const KEEP_DAYS = 60; // lo recibido que se enseña

const txt = (v, max) => String(v ?? '').trim().slice(0, max);
const idOf = v => { const s = String(v ?? ''); if (!/^\d{1,18}$/.test(s)) throw fail('Usuario no válido'); return s; };

async function list(me) {
  const { rows } = await query(`
    SELECT f.status, f.user_id = $1 AS mine, u.id, u.username, coalesce(f.accepted_at, f.created_at) AS since
    FROM bets.friends f JOIN bets.users u ON u.id = CASE WHEN f.user_id = $1 THEN f.friend_id ELSE f.user_id END
    WHERE f.user_id = $1 OR f.friend_id = $1 ORDER BY lower(u.username)`, [me]);
  const one = r => ({ id: String(r.id), username: r.username, since: r.since });
  return {
    friends: rows.filter(r => r.status === 'accepted').map(one),
    incoming: rows.filter(r => r.status === 'pending' && !r.mine).map(one),
    outgoing: rows.filter(r => r.status === 'pending' && r.mine).map(one)
  };
}

async function request(me, username) {
  const name = txt(username, 40);
  if (!name) throw fail('Escribe el nombre de usuario de tu amigo');
  const { rows: [u] } = await query('SELECT id, username FROM bets.users WHERE lower(username) = lower($1)', [name]);
  if (!u) throw fail(`No hay ningún usuario que se llame «${name}»`, 404);
  const other = String(u.id);
  if (other === String(me)) throw fail('No puedes añadirte a ti mismo');
  return tx(async c => {
    const { rows: [pair] } = await c.query(`SELECT user_id, status FROM bets.friends
      WHERE (user_id = $1 AND friend_id = $2) OR (user_id = $2 AND friend_id = $1)`, [me, other]);
    if (pair?.status === 'accepted') throw fail(`${u.username} ya es tu amigo`);
    if (pair && String(pair.user_id) === String(me)) throw fail(`Ya le has enviado la solicitud a ${u.username}: falta que la acepte`);
    // Si el otro ya te la había mandado, pedírsela tú es aceptarla
    if (pair) {
      await c.query(`UPDATE bets.friends SET status = 'accepted', accepted_at = now() WHERE user_id = $1 AND friend_id = $2`, [other, me]);
      return { username: u.username, status: 'accepted' };
    }
    const { rows: [n] } = await c.query(`SELECT count(*) FILTER (WHERE status = 'pending' AND user_id = $1)::int AS pending,
      count(*) FILTER (WHERE status = 'accepted')::int AS friends FROM bets.friends WHERE user_id = $1 OR friend_id = $1`, [me]);
    if (n.pending >= MAX_PENDING) throw fail('Tienes demasiadas solicitudes sin contestar');
    if (n.friends >= MAX_FRIENDS) throw fail(`Puedes tener hasta ${MAX_FRIENDS} amigos`);
    await c.query('INSERT INTO bets.friends (user_id, friend_id) VALUES ($1, $2)', [me, other]);
    return { username: u.username, status: 'pending' };
  });
}

// Aceptar una solicitud que te han enviado (no una tuya)
async function accept(me, otherId) {
  const other = idOf(otherId);
  const { rowCount } = await query(`UPDATE bets.friends SET status = 'accepted', accepted_at = now()
    WHERE user_id = $1 AND friend_id = $2 AND status = 'pending'`, [other, me]);
  if (!rowCount) throw fail('Esa solicitud ya no existe', 404);
  return list(me);
}

// Rechazar, cancelar o dejar de ser amigos: cualquiera de los dos puede
async function remove(me, otherId) {
  const other = idOf(otherId);
  await query(`DELETE FROM bets.friends WHERE (user_id = $1 AND friend_id = $2) OR (user_id = $2 AND friend_id = $1)`, [me, other]);
  return list(me);
}

// Lo que se envía de una apuesta: lo apostado, sin el importe, el estado, el cobro ni las notas
function shareable(b) {
  const legs = Array.isArray(b.legs) && b.legs.length > 1
    ? b.legs.map(l => ({ event: l.event, league: l.league, market: l.market, selection: l.selection, odds: l.odds, sport: l.sport, ...(l.ref ? { ref: l.ref } : {}) }))
    : undefined;
  return {
    sport: b.sport, date: b.date, league: b.league, event: b.event, market: b.market, selection: b.selection,
    bookmaker: b.bookmaker, odds: b.odds, ...(legs ? { legs } : {}), ...(b.ref && !legs ? { ref: b.ref } : {})
  };
}

async function share(me, betId, to, note) {
  const bet = await store.getOwnBet(me, betId);
  if (!bet) throw fail('Esa apuesta no es tuya o ya no existe', 404);
  const ids = [...new Set((Array.isArray(to) ? to : []).map(idOf))].slice(0, MAX_TO);
  if (!ids.length) throw fail('Elige a qué amigos enviársela');
  // Sólo a amigos aceptados: los que no lo son se ignoran
  const { rows } = await query(`SELECT CASE WHEN user_id = $1 THEN friend_id ELSE user_id END AS id FROM bets.friends
    WHERE status = 'accepted' AND (user_id = $1 OR friend_id = $1)`, [me]);
  const friends = new Set(rows.map(r => String(r.id)));
  const ok = ids.filter(id => friends.has(id));
  if (!ok.length) throw fail('Sólo puedes enviar apuestas a tus amigos');
  const payload = JSON.stringify(shareable(bet)), msg = txt(note, 200);
  for (const id of ok) await query('INSERT INTO bets.shared_bets (from_user, to_user, bet, note) VALUES ($1, $2, $3::jsonb, $4)', [me, id, payload, msg]);
  return { sent: ok.length };
}

// Las recibidas (de los últimos 60 días, sin las quitadas) y cuántas no se han visto
async function inbox(me) {
  const { rows } = await query(`
    SELECT s.id, s.bet, s.note, s.created_at, s.seen_at, s.copied_at, u.username AS from_name
    FROM bets.shared_bets s JOIN bets.users u ON u.id = s.from_user
    WHERE s.to_user = $1 AND s.hidden_at IS NULL AND s.created_at > now() - make_interval(days => $2)
    ORDER BY s.created_at DESC LIMIT 100`, [me, KEEP_DAYS]);
  return {
    unseen: rows.filter(r => !r.seen_at).length,
    list: rows.map(r => ({ id: String(r.id), from: r.from_name, bet: r.bet, note: r.note, created: r.created_at, seen: !!r.seen_at, copied: !!r.copied_at }))
  };
}

const seen = async me => { await query('UPDATE bets.shared_bets SET seen_at = now() WHERE to_user = $1 AND seen_at IS NULL', [me]); return { ok: true }; };
const mark = (col) => async (me, id) => {
  const { rowCount } = await query(`UPDATE bets.shared_bets SET ${col} = now() WHERE id = $1 AND to_user = $2`, [idOf(id), me]);
  if (!rowCount) throw fail('No existe', 404);
  return { ok: true };
};

module.exports = { list, request, accept, remove, share, inbox, seen, copied: mark('copied_at'), hide: mark('hidden_at'), shareable };
