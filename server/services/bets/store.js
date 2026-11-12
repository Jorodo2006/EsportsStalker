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

// Los ajustes son de la app entera: sólo los cambia el administrador y valen para todos (migración 010). De cada usuario
// quedan su banca inicial (cada uno tiene su cartera) y el filtro de ligas de la lista de LoL, que no son ajustes de la app
const USER_KEYS = ['initialBankroll', 'favoriteLeagues'];
const SECRET_KEYS = ['leaguepediaUser', 'leaguepediaPassword', 'lolesportsKey'];

const OLD_FEATURED = ['Pinnacle,Bet365,Bwin,Betfair Ex,William Hill,Unibet,Betway,1xBet,Codere,Betsson,Marathonbet,Stake', 'Bet365,Winamax,Betway,Betfair,William Hill', 'Bet365,Winamax,William Hill,Betway'];
// Ajustes de las antiguas fuentes por API (Pinnacle, OddsPapi, Unibet…), que ya no se usan
const OBSOLETE = ['usePinnacle', 'useWinamax', 'useKambi', 'oddspapiKey', 'oddspapiBookmakers', 'pinnacleKey', 'oddsProvider'];

// Sin usuario (los demás servicios) sólo cuentan los ajustes comunes
async function getSettings(userId) {
  const { rows } = await query('SELECT key, value FROM bets.settings');
  // De lo guardado por cada usuario sólo cuenta lo suyo (USER_KEYS): las filas antiguas de moneda o casas no pisan las comunes
  const own = userId ? (await query('SELECT key, value FROM bets.user_settings WHERE user_id = $1 AND key = ANY($2)', [userId, USER_KEYS])).rows : [];
  const s = { ...DEFAULT_SETTINGS, ...Object.fromEntries([...rows, ...own].map(r => [r.key, r.value])) };
  // La lista de casas de versiones anteriores pasa a la nueva por defecto
  if (OLD_FEATURED.includes(s.featuredBooks)) s.featuredBooks = DEFAULT_SETTINGS.featuredBooks;
  // Bet365 se quitó: no se deja leer desde el lector de Docker
  s.featuredBooks = String(s.featuredBooks || '').split(',').map(x => x.trim()).filter(x => x && !/^bet ?365$/i.test(x)).join(',') || DEFAULT_SETTINGS.featuredBooks;
  for (const k of OBSOLETE) delete s[k];
  return s;
}

// Cada uno guarda lo suyo (USER_KEYS); el resto, sólo el administrador, y vale para todos. Quien no lo es y manda un ajuste
// común recibe un 403: la interfaz no se lo enseña, así que sería una petición a mano
async function setSettings(userId, isAdmin, patch) {
  const entries = Object.entries(patch || {}).filter(([k, v]) => k in DEFAULT_SETTINGS && v !== undefined);
  if (!isAdmin && entries.some(([k]) => !USER_KEYS.includes(k))) throw fail('Sólo el administrador puede cambiar los ajustes', 403);
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
  'selection', l.selection, 'odds', l.odds, 'status', l.status, 'sport', l.sport, 'ref', l.ref) ORDER BY l.pos) FROM bets.bet_legs l WHERE l.bet_id = b.id) AS legs`;

function fromRow(r) {
  const bet = {
    id: r.id, date: r.date, sport: r.sport, league: r.league, event: r.event, market: r.market, selection: r.selection,
    bookmaker: r.bookmaker, odds: r.odds, stake: r.stake, status: r.status, cashout: r.cashout, notes: r.notes
  };
  if (r.ref) bet.ref = r.ref;
  if (r.legs && r.legs.length) bet.legs = r.legs.map(l => (l.ref ? l : (({ ref: _, ...x }) => x)(l)));
  return bet;
}

// Sólo para el resolvedor (settle.js): una apuesta por su id, sin filtrar por usuario. Nunca se expone en una ruta;
// el resolvedor la vuelve a guardar con el user_id de su fila
async function getBet(id) {
  const { rows } = await query(`SELECT b.*, ${LEGS_SQL} FROM bets.bets b WHERE b.id = $1`, [String(id)]);
  return rows[0] ? fromRow(rows[0]) : null;
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
  const vals = [b.id, b.date, b.league, b.event, b.market, b.selection, b.bookmaker, b.odds, b.stake, b.status, b.cashout, b.notes, b.sport, userId,
    b.ref ? JSON.stringify(b.ref) : null];
  const r = await c.query(`INSERT INTO bets.bets (id, date, league, event, market, selection, bookmaker, odds, stake, status, cashout, notes, sport, user_id, ref)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15::jsonb)
    ON CONFLICT (id) DO UPDATE SET date = EXCLUDED.date, sport = EXCLUDED.sport, league = EXCLUDED.league, event = EXCLUDED.event,
      market = EXCLUDED.market, selection = EXCLUDED.selection, bookmaker = EXCLUDED.bookmaker, odds = EXCLUDED.odds,
      stake = EXCLUDED.stake, status = EXCLUDED.status, cashout = EXCLUDED.cashout, notes = EXCLUDED.notes, ref = EXCLUDED.ref, updated_at = now()
    WHERE bets.bets.user_id = EXCLUDED.user_id`, vals);
  if (!r.rowCount) throw fail('Esa apuesta no existe', 404);
  await c.query('DELETE FROM bets.bet_legs WHERE bet_id = $1', [b.id]);
  for (const [i, l] of (b.legs || []).entries()) {
    await c.query(`INSERT INTO bets.bet_legs (bet_id, pos, event, league, market, selection, odds, status, sport, ref)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb)`, [b.id, i, l.event, l.league, l.market, l.selection, l.odds, l.status, l.sport, l.ref ? JSON.stringify(l.ref) : null]);
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
  if (!Array.isArray(list)) throw fail('Se esperaba una lista de apuestas');
  if (list.length > MAX_IMPORT) throw fail(`Se pueden importar como máximo ${MAX_IMPORT} apuestas de una vez`);
  // Las que no pasan la validación se saltan; no se pierde todo el fichero por una fila mala
  const clean = [];
  for (const b of list) {
    try { clean.push(normalizeBet({ ...b, id: b?.id || undefined })); } catch (_) { /* fila no válida */ }
  }
  return tx(async c => {
    let n = 0;
    for (const b of clean) if (await writeBet(c, userId, b, true)) n++;
    return n;
  });
}

const STATUSES = ['pending', 'won', 'lost', 'void', 'cashout', 'halfwon', 'halflost'];
const LEG_STATUSES = ['pending', 'won', 'lost', 'void'];
const SPORTS = ['lol', 'basket', 'tennis', 'football'];
// Sin deporte (apuestas de antes o importadas) es LoL
const sportOf = v => (v === 'nba' ? 'basket' : SPORTS.includes(v) ? v : 'lol');
const today = () => new Date().toISOString().slice(0, 10);
// La columna es DATE: sólo vale 'AAAA-MM-DD' (si viene con hora, se corta)
const day = v => (/^\d{4}-\d{2}-\d{2}/.test(String(v || '')) ? String(v).slice(0, 10) : today());

// Límites: lo que mande el cliente no es de fiar (ver tareas de seguridad). Si algo se sale, se rechaza la apuesta
const MAX_MONEY = 1e6, MAX_ODDS = 1000, MAX_LEGS = 30, MAX_IMPORT = 5000;
const MAX_TEXT = { id: 64, league: 120, event: 300, market: 120, selection: 300, bookmaker: 60, notes: 2000 };

// A qué partido y mercado pertenece (para resolverla sola). Viene del cliente: se valida y lo que no cuadra se descarta
// (la apuesta se guarda igual, sin resolución automática). settled y guessed sólo los pone el resolvedor
function cleanRef(r, sport) {
  if (!r || typeof r !== 'object') return null;
  const s = v => String(v ?? '');
  if (!SPORTS.includes(s(r.sport) || sport)) return null;
  if (!/^[\w:.-]{1,80}$/.test(s(r.match)) || !s(r.key) || s(r.key).length > 200 || !/^[\w-]{1,20}$/.test(s(r.out))) return null;
  const out = { sport: s(r.sport) || sport, match: s(r.match), key: s(r.key), out: s(r.out) };
  if (r.start && !Number.isNaN(Date.parse(r.start))) out.start = new Date(r.start).toISOString();
  if (r.guessed === true) out.guessed = true;
  if (r.settled && typeof r.settled === 'object') out.settled = { at: s(r.settled.at).slice(0, 40), text: s(r.settled.text).slice(0, 200) };
  return out;
}

// { ref } sólo si lo hay: las apuestas sin partido quedan igual que antes
const withRef = (r, sport) => { const ref = cleanRef(r, sport); return ref ? { ref } : {}; };

function normalizeBet(b) {
  if (!b || typeof b !== 'object') throw fail('Apuesta no válida');
  // Texto con tope de longitud; un número que no lo es (NaN, "abc") se rechaza en vez de guardarse como 0
  const text = (v, key) => {
    const s = String(v ?? '').trim();
    if (s.length > MAX_TEXT[key]) throw fail(`El campo ${key} es demasiado largo (máximo ${MAX_TEXT[key]} caracteres)`);
    return s;
  };
  const num = (v, what) => {
    const raw = String(v ?? '').trim();
    if (raw === '') return 0;
    const n = Number(raw.replace(',', '.'));
    if (!isFinite(n)) throw fail(`${what} no es un número`);
    return n;
  };
  const money = (v, what) => {
    const n = num(v, what);
    if (n < 0 || n > MAX_MONEY) throw fail(`${what} fuera de rango (0 a ${MAX_MONEY})`);
    return n;
  };
  // 0 = sin cuota todavía; si la hay, tiene que ser una cuota decimal real
  const odds = (v, what) => {
    const n = num(v, what);
    if (n !== 0 && (n < 1 || n > MAX_ODDS)) throw fail(`${what} fuera de rango (1 a ${MAX_ODDS})`);
    return n;
  };
  let legs = b.legs;
  if (typeof legs === 'string') { try { legs = JSON.parse(legs); } catch (_) { legs = null; } } // desde CSV
  if (Array.isArray(legs) && legs.length > MAX_LEGS) throw fail(`Una combinada admite como máximo ${MAX_LEGS} selecciones`);
  legs = Array.isArray(legs) ? legs.filter(l => l && typeof l === 'object').map(l => ({
    event: text(l.event, 'event'), league: text(l.league, 'league'), market: text(l.market, 'market'),
    selection: text(l.selection, 'selection'), odds: odds(l.odds, 'La cuota'), status: LEG_STATUSES.includes(l.status) ? l.status : 'pending',
    sport: sportOf(l.sport ?? b.sport), ...withRef(l.ref, sportOf(l.sport ?? b.sport))
  })).filter(l => l.selection || l.event) : [];
  if (legs.length >= 2) return normalizeCombo(b, legs, money, text);
  return {
    id: b.id ? text(b.id, 'id') : crypto.randomUUID(),
    date: day(b.date),
    sport: sportOf(b.sport),
    league: text(b.league, 'league'),
    event: text(b.event, 'event'),
    market: text(b.market || 'Ganador del partido', 'market'),
    selection: text(b.selection, 'selection'),
    bookmaker: text(b.bookmaker, 'bookmaker'),
    odds: odds(b.odds, 'La cuota'),
    stake: money(b.stake, 'La apuesta'),
    status: STATUSES.includes(b.status) ? b.status : 'pending',
    cashout: money(b.cashout, 'El cash out'),
    notes: text(b.notes, 'notes'),
    ...withRef(b.ref, sportOf(b.sport))
  };
}

// Combinada: la cuota es el producto de las selecciones (las nulas cuentan 1) y el estado sale de ellas:
// una perdida → perdida; todas resueltas → ganada (o nula si todas son nulas). El cash out se respeta.
function normalizeCombo(b, legs, money, text) {
  const odds = Math.round(legs.reduce((p, l) => p * (l.status === 'void' ? 1 : l.odds || 1), 1) * 100) / 100;
  let status = 'pending';
  if (legs.some(l => l.status === 'lost')) status = 'lost';
  else if (legs.every(l => l.status !== 'pending')) status = legs.every(l => l.status === 'void') ? 'void' : 'won';
  if (b.status === 'cashout') status = 'cashout';
  const uniq = xs => [...new Set(xs.filter(Boolean))];
  const sports = uniq(legs.map(l => l.sport));
  return {
    id: b.id ? text(b.id, 'id') : crypto.randomUUID(),
    date: day(b.date),
    sport: sports.length === 1 ? sports[0] : 'mix',
    league: uniq(legs.map(l => l.league)).join(' / '),
    event: legs.map(l => l.event).join(' + '),
    market: 'Combinada',
    selection: legs.map(l => l.selection).join(' + '),
    bookmaker: text(b.bookmaker, 'bookmaker'),
    odds,
    stake: money(b.stake, 'La apuesta'),
    status,
    cashout: money(b.cashout, 'El cash out'),
    notes: text(b.notes, 'notes'),
    legs
  };
}

module.exports = { USER_KEYS, getSettings, setSettings, claimExisting, getBet, listBets, saveBet, deleteBet, importBets, normalizeBet, DEFAULT_SETTINGS, OBSOLETE, SECRET_KEYS };
