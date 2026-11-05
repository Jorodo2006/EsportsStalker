// Apuestas y ajustes en PostgreSQL (esquema bets). Antes era data.json en la carpeta de datos del usuario.
const crypto = require('crypto');
const { query, tx } = require('../../shared/db');
const { fail } = require('../../shared/service');

const DEFAULT_SETTINGS = {
  currency: '€',
  initialBankroll: 0,
  featuredBooks: 'Winamax,Betway', // orden de las columnas del comparador
  leaguepediaUser: '', // contraseña de bot de Fandom (opcional) para subir el límite
  leaguepediaPassword: '',
  lolesportsKey: '0TvQnueqKa5mxJntVWt0w4LpLfEkrV1Ta8rQBb9Z',
  refreshSeconds: 30,
  favoriteLeagues: [],
  // Lecturas de cuotas programadas (las hace el lector de Docker)
  oddsAutoEnabled: true,
  oddsRefreshMinutes: 5,
  oddsAutoHours: 6, // partidos que empiezan en las próximas N horas: se leen cada oddsRefreshMinutes
  oddsFarEnabled: true, // el resto, hasta 48 h: cada hora, o cada 3 h a más de un día
  signupOpen: true // si se pueden crear cuentas nuevas desde la pantalla de entrada
};

// Cada usuario tiene las suyas; el resto de ajustes son comunes y sólo los cambia el administrador
const USER_KEYS = ['currency', 'initialBankroll', 'featuredBooks', 'refreshSeconds', 'favoriteLeagues'];
const SECRET_KEYS = ['leaguepediaUser', 'leaguepediaPassword', 'lolesportsKey'];

const OLD_FEATURED = ['Pinnacle,Bet365,Bwin,Betfair Ex,William Hill,Unibet,Betway,1xBet,Codere,Betsson,Marathonbet,Stake', 'Bet365,Winamax,Betway,Betfair,William Hill', 'Bet365,Winamax,William Hill,Betway'];
// Ajustes de las antiguas fuentes por API (Pinnacle, OddsPapi, Unibet…), que ya no se usan
const OBSOLETE = ['usePinnacle', 'useWinamax', 'useKambi', 'oddspapiKey', 'oddspapiBookmakers', 'pinnacleKey', 'oddsProvider'];

// Sin usuario (los demás servicios) sólo cuentan los ajustes comunes
async function getSettings(userId) {
  const { rows } = await query('SELECT key, value FROM bets.settings');
  const own = userId ? (await query('SELECT key, value FROM bets.user_settings WHERE user_id = $1', [userId])).rows : [];
  const s = { ...DEFAULT_SETTINGS, ...Object.fromEntries([...rows, ...own].map(r => [r.key, r.value])) };
  // La lista de casas de versiones anteriores pasa a la nueva por defecto
  if (OLD_FEATURED.includes(s.featuredBooks)) s.featuredBooks = DEFAULT_SETTINGS.featuredBooks;
  // Bet365 se quitó: no se deja leer desde el lector de Docker
  s.featuredBooks = String(s.featuredBooks || '').split(',').map(x => x.trim()).filter(x => x && !/^bet ?365$/i.test(x)).join(',') || DEFAULT_SETTINGS.featuredBooks;
  for (const k of OBSOLETE) delete s[k];
  return s;
}

// El formulario manda todos los ajustes: los comunes se ignoran si no es administrador
async function setSettings(userId, isAdmin, patch) {
  const entries = Object.entries(patch || {}).filter(([k, v]) => k in DEFAULT_SETTINGS && v !== undefined);
  await tx(async c => {
    for (const [k, v] of entries) {
      if (USER_KEYS.includes(k)) {
        await c.query(`INSERT INTO bets.user_settings (user_id, key, value) VALUES ($1, $2, $3::jsonb)
          ON CONFLICT (user_id, key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`, [userId, k, JSON.stringify(v)]);
      } else if (isAdmin) {
        await c.query(`INSERT INTO bets.settings (key, value) VALUES ($1, $2::jsonb)
          ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`, [k, JSON.stringify(v)]);
      }
    }
  });
  return getSettings(userId);
}

// El primer usuario se queda con las apuestas y las preferencias de cuando no había cuentas
async function claimExisting(c, userId) {
  await c.query('UPDATE bets.bets SET user_id = $1 WHERE user_id IS NULL', [userId]);
  await c.query(`INSERT INTO bets.user_settings (user_id, key, value)
    SELECT $1, key, value FROM bets.settings WHERE key = ANY($2)`, [userId, USER_KEYS]);
  await c.query('DELETE FROM bets.settings WHERE key = ANY($1)', [USER_KEYS]);
}

// ---------- Apuestas ----------
const LEGS_SQL = `(SELECT json_agg(json_build_object('event', l.event, 'league', l.league, 'market', l.market,
  'selection', l.selection, 'odds', l.odds, 'status', l.status, 'sport', l.sport) ORDER BY l.pos) FROM bets.bet_legs l WHERE l.bet_id = b.id) AS legs`;

function fromRow(r) {
  const bet = {
    id: r.id, date: r.date, sport: r.sport, league: r.league, event: r.event, market: r.market, selection: r.selection,
    bookmaker: r.bookmaker, odds: r.odds, stake: r.stake, status: r.status, cashout: r.cashout, notes: r.notes
  };
  if (r.legs && r.legs.length) bet.legs = r.legs;
  return bet;
}

async function listBets(userId) {
  const { rows } = await query(`SELECT b.*, ${LEGS_SQL} FROM bets.bets b WHERE b.user_id = $1 ORDER BY b.seq`, [userId]);
  return rows.map(fromRow);
}

// Guarda la apuesta (ya normalizada) con sus selecciones. onlyNew: no pisa una existente (importar).
// El id lo manda el cliente y es único entre todos: nunca se puede pisar la apuesta de otro usuario
async function writeBet(c, userId, b, onlyNew) {
  if (onlyNew) {
    const { rows } = await c.query('SELECT user_id FROM bets.bets WHERE id = $1', [b.id]);
    if (rows[0] && String(rows[0].user_id) === String(userId)) return false;
    if (rows[0]) b = { ...b, id: crypto.randomUUID() }; // el CSV de otro usuario: para éste es una apuesta nueva
  }
  const vals = [b.id, b.date, b.league, b.event, b.market, b.selection, b.bookmaker, b.odds, b.stake, b.status, b.cashout, b.notes, b.sport, userId];
  const r = await c.query(`INSERT INTO bets.bets (id, date, league, event, market, selection, bookmaker, odds, stake, status, cashout, notes, sport, user_id)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
    ON CONFLICT (id) DO UPDATE SET date = EXCLUDED.date, sport = EXCLUDED.sport, league = EXCLUDED.league, event = EXCLUDED.event,
      market = EXCLUDED.market, selection = EXCLUDED.selection, bookmaker = EXCLUDED.bookmaker, odds = EXCLUDED.odds,
      stake = EXCLUDED.stake, status = EXCLUDED.status, cashout = EXCLUDED.cashout, notes = EXCLUDED.notes, updated_at = now()
    WHERE bets.bets.user_id = EXCLUDED.user_id`, vals);
  if (!r.rowCount) throw fail('Esa apuesta no existe', 404);
  await c.query('DELETE FROM bets.bet_legs WHERE bet_id = $1', [b.id]);
  for (const [i, l] of (b.legs || []).entries()) {
    await c.query(`INSERT INTO bets.bet_legs (bet_id, pos, event, league, market, selection, odds, status, sport)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`, [b.id, i, l.event, l.league, l.market, l.selection, l.odds, l.status, l.sport]);
  }
  return true;
}

async function saveBet(userId, bet) {
  const clean = normalizeBet(bet);
  await tx(c => writeBet(c, userId, clean, false));
  return clean;
}

async function deleteBet(userId, id) {
  await query('DELETE FROM bets.bets WHERE id = $1 AND user_id = $2', [String(id), userId]);
}

// Añade las que no estén ya (por id); devuelve cuántas son nuevas
async function importBets(userId, list) {
  if (!Array.isArray(list)) throw new Error('Se esperaba una lista de apuestas');
  return tx(async c => {
    let n = 0;
    for (const b of list) if (await writeBet(c, userId, normalizeBet({ ...b, id: b.id || undefined }), true)) n++;
    return n;
  });
}

const STATUSES = ['pending', 'won', 'lost', 'void', 'cashout', 'halfwon', 'halflost'];
const LEG_STATUSES = ['pending', 'won', 'lost', 'void'];
const SPORTS = ['lol', 'basket', 'tennis'];
// Sin deporte (apuestas de antes o importadas) es LoL
const sportOf = v => (v === 'nba' ? 'basket' : SPORTS.includes(v) ? v : 'lol');
const today = () => new Date().toISOString().slice(0, 10);
// La columna es DATE: sólo vale 'AAAA-MM-DD' (si viene con hora, se corta)
const day = v => (/^\d{4}-\d{2}-\d{2}/.test(String(v || '')) ? String(v).slice(0, 10) : today());

function normalizeBet(b) {
  const num = v => { const n = parseFloat(String(v ?? '').replace(',', '.')); return isFinite(n) ? n : 0; };
  let legs = b.legs;
  if (typeof legs === 'string') { try { legs = JSON.parse(legs); } catch (_) { legs = null; } } // desde CSV
  legs = Array.isArray(legs) ? legs.map(l => ({
    event: String(l.event || '').trim(), league: String(l.league || '').trim(), market: String(l.market || '').trim(),
    selection: String(l.selection || '').trim(), odds: num(l.odds), status: LEG_STATUSES.includes(l.status) ? l.status : 'pending',
    sport: sportOf(l.sport ?? b.sport)
  })).filter(l => l.selection || l.event) : [];
  if (legs.length >= 2) return normalizeCombo(b, legs, num);
  return {
    id: b.id || crypto.randomUUID(),
    date: day(b.date),
    sport: sportOf(b.sport),
    league: String(b.league || '').trim(),
    event: String(b.event || '').trim(),
    market: String(b.market || 'Ganador del partido').trim(),
    selection: String(b.selection || '').trim(),
    bookmaker: String(b.bookmaker || '').trim(),
    odds: num(b.odds),
    stake: num(b.stake),
    status: STATUSES.includes(b.status) ? b.status : 'pending',
    cashout: num(b.cashout),
    notes: String(b.notes || '').trim()
  };
}

// Combinada: la cuota es el producto de las selecciones (las nulas cuentan 1) y el estado sale de ellas:
// una perdida → perdida; todas resueltas → ganada (o nula si todas son nulas). El cash out se respeta.
function normalizeCombo(b, legs, num) {
  const odds = Math.round(legs.reduce((p, l) => p * (l.status === 'void' ? 1 : l.odds || 1), 1) * 100) / 100;
  let status = 'pending';
  if (legs.some(l => l.status === 'lost')) status = 'lost';
  else if (legs.every(l => l.status !== 'pending')) status = legs.every(l => l.status === 'void') ? 'void' : 'won';
  if (b.status === 'cashout') status = 'cashout';
  const uniq = xs => [...new Set(xs.filter(Boolean))];
  const sports = uniq(legs.map(l => l.sport));
  return {
    id: b.id || crypto.randomUUID(),
    date: day(b.date),
    sport: sports.length === 1 ? sports[0] : 'mix',
    league: uniq(legs.map(l => l.league)).join(' / '),
    event: legs.map(l => l.event).join(' + '),
    market: 'Combinada',
    selection: legs.map(l => l.selection).join(' + '),
    bookmaker: String(b.bookmaker || '').trim(),
    odds,
    stake: num(b.stake),
    status,
    cashout: num(b.cashout),
    notes: String(b.notes || '').trim(),
    legs
  };
}

module.exports = { getSettings, setSettings, claimExisting, listBets, saveBet, deleteBet, importBets, DEFAULT_SETTINGS, OBSOLETE, SECRET_KEYS };
