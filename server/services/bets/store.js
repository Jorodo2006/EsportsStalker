// Apuestas y ajustes en PostgreSQL (esquema bets). Antes era data.json en la carpeta de datos del usuario.
const crypto = require('crypto');
const { query, tx } = require('../../shared/db');

const DEFAULT_SETTINGS = {
  currency: '€',
  initialBankroll: 0,
  featuredBooks: 'Bet365,Winamax,Betway', // orden de las columnas del comparador
  leaguepediaUser: '', // contraseña de bot de Fandom (opcional) para subir el límite
  leaguepediaPassword: '',
  lolesportsKey: '0TvQnueqKa5mxJntVWt0w4LpLfEkrV1Ta8rQBb9Z',
  refreshSeconds: 30,
  favoriteLeagues: [],
  // Lecturas de cuotas programadas (las hace la extensión de Chrome)
  oddsAutoEnabled: true,
  oddsRefreshMinutes: 5,
  oddsAutoHours: 6 // partidos que empiezan en las próximas N horas
};

const OLD_FEATURED = ['Pinnacle,Bet365,Bwin,Betfair Ex,William Hill,Unibet,Betway,1xBet,Codere,Betsson,Marathonbet,Stake', 'Bet365,Winamax,Betway,Betfair,William Hill', 'Bet365,Winamax,William Hill,Betway'];
// Ajustes de las antiguas fuentes por API (Pinnacle, OddsPapi, Unibet…), que ya no se usan
const OBSOLETE = ['usePinnacle', 'useWinamax', 'useKambi', 'oddspapiKey', 'oddspapiBookmakers', 'pinnacleKey', 'oddsProvider'];

async function getSettings() {
  const { rows } = await query('SELECT key, value FROM bets.settings');
  const s = { ...DEFAULT_SETTINGS, ...Object.fromEntries(rows.map(r => [r.key, r.value])) };
  // La lista de casas de versiones anteriores pasa a la nueva por defecto
  if (OLD_FEATURED.includes(s.featuredBooks)) s.featuredBooks = DEFAULT_SETTINGS.featuredBooks;
  for (const k of OBSOLETE) delete s[k];
  return s;
}

async function setSettings(patch) {
  const entries = Object.entries(patch || {}).filter(([k, v]) => !OBSOLETE.includes(k) && v !== undefined);
  if (entries.length) {
    await tx(async c => {
      for (const [k, v] of entries) {
        await c.query(`INSERT INTO bets.settings (key, value) VALUES ($1, $2::jsonb)
          ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`, [k, JSON.stringify(v)]);
      }
    });
  }
  return getSettings();
}

const hasSettings = async () => (await query('SELECT 1 FROM bets.settings LIMIT 1')).rowCount > 0;

// ---------- Apuestas ----------
const LEGS_SQL = `(SELECT json_agg(json_build_object('event', l.event, 'league', l.league, 'market', l.market,
  'selection', l.selection, 'odds', l.odds, 'status', l.status) ORDER BY l.pos) FROM bets.bet_legs l WHERE l.bet_id = b.id) AS legs`;

function fromRow(r) {
  const bet = {
    id: r.id, date: r.date, league: r.league, event: r.event, market: r.market, selection: r.selection,
    bookmaker: r.bookmaker, odds: r.odds, stake: r.stake, status: r.status, cashout: r.cashout, notes: r.notes
  };
  if (r.legs && r.legs.length) bet.legs = r.legs;
  return bet;
}

async function listBets() {
  const { rows } = await query(`SELECT b.*, ${LEGS_SQL} FROM bets.bets b ORDER BY b.seq`);
  return rows.map(fromRow);
}

// Guarda la apuesta (ya normalizada) con sus selecciones. onlyNew: no pisa una existente (importar)
async function writeBet(c, b, onlyNew) {
  const vals = [b.id, b.date, b.league, b.event, b.market, b.selection, b.bookmaker, b.odds, b.stake, b.status, b.cashout, b.notes];
  const r = await c.query(`INSERT INTO bets.bets (id, date, league, event, market, selection, bookmaker, odds, stake, status, cashout, notes)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
    ON CONFLICT (id) DO ${onlyNew ? 'NOTHING' : `UPDATE SET date = EXCLUDED.date, league = EXCLUDED.league, event = EXCLUDED.event,
      market = EXCLUDED.market, selection = EXCLUDED.selection, bookmaker = EXCLUDED.bookmaker, odds = EXCLUDED.odds,
      stake = EXCLUDED.stake, status = EXCLUDED.status, cashout = EXCLUDED.cashout, notes = EXCLUDED.notes, updated_at = now()`}`, vals);
  if (onlyNew && !r.rowCount) return false;
  await c.query('DELETE FROM bets.bet_legs WHERE bet_id = $1', [b.id]);
  for (const [i, l] of (b.legs || []).entries()) {
    await c.query(`INSERT INTO bets.bet_legs (bet_id, pos, event, league, market, selection, odds, status)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`, [b.id, i, l.event, l.league, l.market, l.selection, l.odds, l.status]);
  }
  return true;
}

async function saveBet(bet) {
  const clean = normalizeBet(bet);
  await tx(c => writeBet(c, clean, false));
  return clean;
}

async function deleteBet(id) {
  await query('DELETE FROM bets.bets WHERE id = $1', [String(id)]);
}

// Añade las que no estén ya (por id); devuelve cuántas son nuevas
async function importBets(list) {
  if (!Array.isArray(list)) throw new Error('Se esperaba una lista de apuestas');
  return tx(async c => {
    let n = 0;
    for (const b of list) if (await writeBet(c, normalizeBet({ ...b, id: b.id || undefined }), true)) n++;
    return n;
  });
}

const STATUSES = ['pending', 'won', 'lost', 'void', 'cashout', 'halfwon', 'halflost'];
const LEG_STATUSES = ['pending', 'won', 'lost', 'void'];
const today = () => new Date().toISOString().slice(0, 10);
// La columna es DATE: sólo vale 'AAAA-MM-DD' (si viene con hora, se corta)
const day = v => (/^\d{4}-\d{2}-\d{2}/.test(String(v || '')) ? String(v).slice(0, 10) : today());

function normalizeBet(b) {
  const num = v => { const n = parseFloat(String(v ?? '').replace(',', '.')); return isFinite(n) ? n : 0; };
  let legs = b.legs;
  if (typeof legs === 'string') { try { legs = JSON.parse(legs); } catch (_) { legs = null; } } // desde CSV
  legs = Array.isArray(legs) ? legs.map(l => ({
    event: String(l.event || '').trim(), league: String(l.league || '').trim(), market: String(l.market || '').trim(),
    selection: String(l.selection || '').trim(), odds: num(l.odds), status: LEG_STATUSES.includes(l.status) ? l.status : 'pending'
  })).filter(l => l.selection || l.event) : [];
  if (legs.length >= 2) return normalizeCombo(b, legs, num);
  return {
    id: b.id || crypto.randomUUID(),
    date: day(b.date),
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
  return {
    id: b.id || crypto.randomUUID(),
    date: day(b.date),
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

module.exports = { getSettings, setSettings, hasSettings, listBets, saveBet, deleteBet, importBets, DEFAULT_SETTINGS, OBSOLETE };
