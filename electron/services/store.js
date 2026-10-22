// Almacenamiento local en un fichero JSON dentro de la carpeta de datos del usuario.
// Windows: %APPDATA%/LoL Esports Tracker/data.json
// Linux:   ~/.config/LoL Esports Tracker/data.json
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DEFAULT_SETTINGS = {
  currency: '€',
  initialBankroll: 0,
  featuredBooks: 'Bet365,Winamax,Betway', // orden de las columnas del comparador
  leaguepediaUser: '', // contraseña de bot de Fandom (opcional) para subir el límite
  leaguepediaPassword: '',
  lolesportsKey: '0TvQnueqKa5mxJntVWt0w4LpLfEkrV1Ta8rQBb9Z',
  refreshSeconds: 30,
  favoriteLeagues: []
};

const OLD_FEATURED = ['Pinnacle,Bet365,Bwin,Betfair Ex,William Hill,Unibet,Betway,1xBet,Codere,Betsson,Marathonbet,Stake', 'Bet365,Winamax,Betway,Betfair,William Hill', 'Bet365,Winamax,William Hill,Betway'];
// Ajustes de las antiguas fuentes por API (Pinnacle, OddsPapi, Unibet…), que ya no se usan
const OBSOLETE = ['usePinnacle', 'useWinamax', 'useKambi', 'oddspapiKey', 'oddspapiBookmakers', 'pinnacleKey'];

class Store {
  constructor(dir) {
    this.file = path.join(dir, 'data.json');
    this.data = { bets: [], settings: { ...DEFAULT_SETTINGS } };
    this.load();
  }

  load() {
    try {
      const raw = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      this.data.bets = Array.isArray(raw.bets) ? raw.bets : [];
      this.data.settings = { ...DEFAULT_SETTINGS, ...(raw.settings || {}) };
      // La lista de casas de versiones anteriores pasa a la nueva por defecto
      if (OLD_FEATURED.includes(this.data.settings.featuredBooks)) this.data.settings.featuredBooks = DEFAULT_SETTINGS.featuredBooks;
      for (const k of OBSOLETE) delete this.data.settings[k];
    } catch (e) {
      if (e.code !== 'ENOENT') {
        // Fichero corrupto: guardamos una copia antes de empezar de cero
        try { fs.copyFileSync(this.file, this.file + '.bak-' + Date.now()); } catch (_) {}
      }
    }
  }

  save() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = this.file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2));
    fs.renameSync(tmp, this.file);
  }

  getSettings() { return this.data.settings; }

  setSettings(patch) {
    this.data.settings = { ...this.data.settings, ...patch };
    this.save();
    return this.data.settings;
  }

  listBets() { return this.data.bets; }

  saveBet(bet) {
    const clean = normalizeBet(bet);
    const i = this.data.bets.findIndex(b => b.id === clean.id);
    if (i >= 0) this.data.bets[i] = clean; else this.data.bets.push(clean);
    this.save();
    return clean;
  }

  deleteBet(id) {
    this.data.bets = this.data.bets.filter(b => b.id !== id);
    this.save();
  }

  importBets(list) {
    let n = 0;
    for (const b of list) {
      const clean = normalizeBet({ ...b, id: b.id || undefined });
      if (!this.data.bets.some(x => x.id === clean.id)) { this.data.bets.push(clean); n++; }
    }
    this.save();
    return n;
  }
}

const STATUSES = ['pending', 'won', 'lost', 'void', 'cashout', 'halfwon', 'halflost'];

const LEG_STATUSES = ['pending', 'won', 'lost', 'void'];

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
    date: b.date || new Date().toISOString().slice(0, 10),
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
    date: b.date || new Date().toISOString().slice(0, 10),
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

module.exports = { Store, DEFAULT_SETTINGS };
