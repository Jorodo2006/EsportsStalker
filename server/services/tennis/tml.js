// Estadísticas de juego de ATP y WTA (saque, resto, juegos y superficie) calculadas con los CSV gratuitos de TennisMyLife
// (stats.tennismylife.org/tennis-match-database). Sus condiciones sólo permiten uso personal y no comercial, y no se pueden
// redistribuir los CSV: se guardan en tennis.cache, nunca en el repo. ESPN no tiene estos datos y la ATP bloquea su web.
const { query } = require('../../shared/db');

const BASE = 'https://stats.tennismylife.org/data';
const YEARS = 3;
const SOURCES = { atp: y => `${y}.csv`, wta: y => `${y}_wta.csv` };
const ONGOING = { atp: 'ongoing_tourneys.csv', wta: 'wta_ongoing_tourneys.csv' };
const KEEP = ['tourney_id', 'tourney_name', 'surface', 'indoor', 'tourney_level', 'tourney_date', 'match_num', 'winner_name', 'winner_rank', 'loser_name', 'loser_rank', 'score', 'round', 'minutes',
  'w_ace', 'w_df', 'w_svpt', 'w_1stIn', 'w_1stWon', 'w_2ndWon', 'w_SvGms', 'w_bpSaved', 'w_bpFaced', 'l_ace', 'l_df', 'l_svpt', 'l_1stIn', 'l_1stWon', 'l_2ndWon', 'l_SvGms', 'l_bpSaved', 'l_bpFaced'];
const SURFACES = ['Hard', 'Clay', 'Grass'];
const MIN_SURFACE = 5; // con menos partidos no se puede hablar de mejor o peor superficie

function parseCsv(text) {
  const rows = [];
  let row = [], cur = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { cur += '"'; i++; } else if (c === '"') q = false; else cur += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(cur); cur = ''; } else if (c === '\n') { row.push(cur.replace(/\r$/, '')); rows.push(row); row = []; cur = ''; } else cur += c;
  }
  if (cur || row.length) { row.push(cur); rows.push(row); }
  const [head, ...body] = rows;
  if (!head?.includes('winner_name')) throw new Error('el CSV no tiene el formato esperado');
  const idx = KEEP.map(k => head.indexOf(k));
  return body.filter(r => r.length > 1).map(r => Object.fromEntries(KEEP.map((k, i) => [k, r[idx[i]] ?? ''])));
}

// En memoria y en tennis.cache: si la fuente falla se sirve lo último guardado
const mem = new Map();
async function getCsv(file, ttl) {
  const url = `${BASE}/${file}`, hit = mem.get(url);
  if (hit && Date.now() - hit.t < ttl) return hit.v;
  try {
    const res = await fetch(url, { headers: { 'User-Agent': 'EsportsStalker/0.3 (uso personal)', Accept: 'text/csv' }, signal: AbortSignal.timeout(40000) });
    if (!res.ok) throw new Error(`respondió ${res.status}`);
    const v = parseCsv(await res.text());
    mem.set(url, { t: Date.now(), v });
    query(`INSERT INTO tennis.cache (key, value, t) VALUES ($1, $2::jsonb, now()) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, t = EXCLUDED.t`, [url, JSON.stringify(v)])
      .catch(e => console.error('tennis.cache:', e.message));
    return v;
  } catch (e) {
    const old = hit?.v ?? (await query('SELECT value FROM tennis.cache WHERE key = $1', [url]).catch(() => ({ rows: [] }))).rows[0]?.value;
    if (old) { mem.set(url, { t: Date.now() - ttl + 300e3, v: old }); return old; } // se reintenta en 5 min
    if (/ongoing/.test(file)) return []; // sin torneo en curso no se pierde nada más
    throw new Error(`No se pudo leer TennisMyLife (${e.message})`);
  }
}

const norm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z ]+/g, ' ').replace(/\s+/g, ' ').trim();

// Todas las filas de un circuito, más el índice por jugador
const built = new Map();
async function dataset(tour) {
  const year = new Date().getFullYear();
  const parts = await Promise.all([
    ...Array.from({ length: YEARS }, (_, i) => getCsv(SOURCES[tour](year - i), i === 0 ? 6 * 3600e3 : 7 * 24 * 3600e3).catch(e => { if (i === 0 && new Date().getMonth() > 0) throw e; return []; })),
    getCsv(ONGOING[tour], 30 * 60e3)
  ]);
  const prev = built.get(tour);
  if (prev && prev.parts.length === parts.length && prev.parts.every((p, i) => p === parts[i])) return prev;
  const seen = new Set(), rows = [], byName = new Map();
  for (const m of parts.flat()) {
    const k = `${m.tourney_id}|${m.match_num}|${m.winner_name}`;
    if (seen.has(k)) continue;
    seen.add(k); rows.push(m);
    for (const n of [m.winner_name, m.loser_name]) { const x = norm(n); if (!byName.has(x)) byName.set(x, []); byName.get(x).push(m); }
  }
  const out = { parts, rows, byName };
  built.set(tour, out);
  return out;
}

// Los nombres de ESPN y de TennisMyLife casi siempre coinciden. Si no, apellido e inicial, y sólo si no hay duda
function resolve(data, name) {
  const n = norm(name);
  if (data.byName.has(n)) return n;
  const w = n.split(' '), last = w[w.length - 1], first = w[0]?.[0];
  const hits = [...data.byName.keys()].filter(k => { const x = k.split(' '); return x[x.length - 1] === last && x[0]?.[0] === first; });
  if (hits.length === 1) return hits[0];
  // Nombres compuestos o al revés: "Daniel Merida" es "Daniel Merida Aguilar" y "Zheng Qinwen", "Qinwen Zheng"
  const more = w.length >= 2 ? [...data.byName.keys()].filter(k => { const x = k.split(' '); return w.every(p => x.includes(p)); }) : [];
  return hits.length === 0 && more.length === 1 ? more[0] : null;
}

const num = v => { const n = parseFloat(v); return Number.isFinite(n) ? n : 0; };
const ratio = (a, b) => (b > 0 ? a / b : null);
const per = (a, b) => (b > 0 ? Math.round((a / b) * 100) / 100 : null);
const blank = () => ({
  matches: 0, won: 0, lost: 0, gamesWon: 0, gamesLost: 0, setsWon: 0, setsLost: 0, tbWon: 0, tbLost: 0, minutes: 0, timed: 0, stat: 0,
  ace: 0, df: 0, svpt: 0, firstIn: 0, firstWon: 0, secondWon: 0, svGms: 0, bpSaved: 0, bpFaced: 0, oAce: 0, oSvpt: 0, oFirstIn: 0, oFirstWon: 0, oSecondWon: 0, oSvGms: 0, oBpSaved: 0, oBpFaced: 0
});

function addMatch(b, m, me) {
  const win = norm(m.winner_name) === me;
  b.matches++; if (win) b.won++; else b.lost++;
  for (const set of String(m.score).split(/\s+/)) {
    const x = set.match(/^(\d+)-(\d+)(?:\((\d+)\))?$/);
    if (!x) continue; // RET, DEF… lo jugado hasta entonces sí cuenta
    const w = +x[1], l = +x[2]; // el resultado siempre va desde el punto de vista del ganador
    b.gamesWon += win ? w : l; b.gamesLost += win ? l : w;
    if (Math.max(w, l) >= 6 && w !== l) { if ((w > l) === win) b.setsWon++; else b.setsLost++; }
    if ((w === 7 && l === 6) || (w === 6 && l === 7)) { if ((w > l) === win) b.tbWon++; else b.tbLost++; }
  }
  if (num(m.minutes)) { b.minutes += num(m.minutes); b.timed++; }
  // Algunos partidos no tienen estadísticas: no pueden contar en los promedios
  if (!num(m.w_svpt) || !num(m.l_svpt)) return;
  const [p, o] = win ? ['w_', 'l_'] : ['l_', 'w_'];
  b.stat++;
  b.ace += num(m[`${p}ace`]); b.df += num(m[`${p}df`]); b.svpt += num(m[`${p}svpt`]); b.firstIn += num(m[`${p}1stIn`]); b.firstWon += num(m[`${p}1stWon`]); b.secondWon += num(m[`${p}2ndWon`]);
  b.svGms += num(m[`${p}SvGms`]); b.bpSaved += num(m[`${p}bpSaved`]); b.bpFaced += num(m[`${p}bpFaced`]);
  b.oAce += num(m[`${o}ace`]); b.oSvpt += num(m[`${o}svpt`]); b.oFirstIn += num(m[`${o}1stIn`]); b.oFirstWon += num(m[`${o}1stWon`]); b.oSecondWon += num(m[`${o}2ndWon`]);
  b.oSvGms += num(m[`${o}SvGms`]); b.oBpSaved += num(m[`${o}bpSaved`]); b.oBpFaced += num(m[`${o}bpFaced`]);
}

function finish(b) {
  const svWon = b.firstWon + b.secondWon, retWon = b.oSvpt - b.oFirstWon - b.oSecondWon, broken = b.bpFaced - b.bpSaved, breaks = b.oBpFaced - b.oBpSaved;
  return {
    matches: b.matches, won: b.won, lost: b.lost, winPct: ratio(b.won, b.matches), statMatches: b.stat,
    gamesWon: b.gamesWon, gamesLost: b.gamesLost, gamesPct: ratio(b.gamesWon, b.gamesWon + b.gamesLost), gamesPerMatch: per(b.gamesWon + b.gamesLost, b.matches),
    gamesWonPerMatch: per(b.gamesWon, b.matches), gamesLostPerMatch: per(b.gamesLost, b.matches),
    setsWon: b.setsWon, setsLost: b.setsLost, setsPct: ratio(b.setsWon, b.setsWon + b.setsLost), tbWon: b.tbWon, tbLost: b.tbLost, tbPct: ratio(b.tbWon, b.tbWon + b.tbLost),
    minutesPerMatch: b.timed ? Math.round(b.minutes / b.timed) : null,
    aces: b.ace, df: b.df, acesPerMatch: per(b.ace, b.stat), dfPerMatch: per(b.df, b.stat), acePct: ratio(b.ace, b.svpt), dfPct: ratio(b.df, b.svpt),
    firstInPct: ratio(b.firstIn, b.svpt), firstWonPct: ratio(b.firstWon, b.firstIn), secondWonPct: ratio(b.secondWon, b.svpt - b.firstIn), servePtsPct: ratio(svWon, b.svpt),
    holdPct: b.svGms ? (b.svGms - broken) / b.svGms : null, bpSavedPct: ratio(b.bpSaved, b.bpFaced), bpFacedPerMatch: per(b.bpFaced, b.stat),
    acesAgainstPerMatch: per(b.oAce, b.stat), ret1Pct: ratio(b.oFirstIn - b.oFirstWon, b.oFirstIn), ret2Pct: ratio(b.oSvpt - b.oFirstIn - b.oSecondWon, b.oSvpt - b.oFirstIn), retPtsPct: ratio(retWon, b.oSvpt),
    breakPct: ratio(breaks, b.oSvGms), bpConvPct: ratio(breaks, b.oBpFaced), bpChancesPerMatch: per(b.oBpFaced, b.stat), totalPtsPct: ratio(svWon + retWon, b.svpt + b.oSvpt)
  };
}

const played = m => !/W\/?O/i.test(m.score) && String(m.score).trim() !== '';
const summary = (list, me) => { const b = blank(); for (const m of list) addMatch(b, m, me); return finish(b); };
const rec = (list, me) => { const won = list.filter(m => norm(m.winner_name) === me).length; return { won, lost: list.length - won, winPct: ratio(won, list.length) }; };

// Media del circuito con los mismos filtros: cada partido cuenta una vez desde cada jugador. Se calcula una sola vez por
// periodo, porque recorre miles de partidos, y es lo que da sentido a un porcentaje suelto
function tourAverages(data, key, pool) {
  data.tour ||= new Map();
  if (data.tour.has(key)) return data.tour.get(key);
  const blocks = { all: blank(), Hard: blank(), Clay: blank(), Grass: blank() };
  for (const m of pool) {
    for (const who of [m.winner_name, m.loser_name]) {
      const me = norm(who);
      addMatch(blocks.all, m, me);
      if (blocks[m.surface]) addMatch(blocks[m.surface], m, me);
    }
  }
  const out = Object.fromEntries(Object.entries(blocks).map(([k, b]) => [k, finish(b)]));
  data.tour.set(key, out);
  return out;
}

function period(key, label, list, me, tour) {
  const surfaces = Object.fromEntries(SURFACES.map(s => [s, summary(list.filter(m => m.surface === s), me)]));
  const ranked = SURFACES.filter(s => surfaces[s].matches >= MIN_SURFACE).sort((a, b) => surfaces[b].winPct - surfaces[a].winPct || surfaces[b].gamesPct - surfaces[a].gamesPct);
  const oppRank = m => num(norm(m.winner_name) === me ? m.loser_rank : m.winner_rank);
  const vs = (from, to) => rec(list.filter(m => { const r = oppRank(m); return r >= from && r <= to; }), me);
  return {
    key, label, total: summary(list, me), surfaces, tour, best: ranked[0] || null, worst: ranked.length > 1 ? ranked[ranked.length - 1] : null,
    vs: { top10: vs(1, 10), top11to50: vs(11, 50), rest: vs(51, 99999) },
    levels: { grandSlam: rec(list.filter(m => m.tourney_level === 'G'), me), masters: rec(list.filter(m => ['M', '1000'].includes(m.tourney_level)), me), others: rec(list.filter(m => ['A', '250', '500'].includes(m.tourney_level)), me) }
  };
}

const ymdOf = d => { const s = String(d); return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`; };

async function playerStats(tour, name) {
  const data = await dataset(tour);
  const me = resolve(data, name);
  const updated = data.rows.reduce((mx, m) => (m.tourney_date > mx ? m.tourney_date : mx), '');
  const base = { source: 'TennisMyLife', updated: updated ? ymdOf(updated) : null, minSurface: MIN_SURFACE };
  if (!me) return { ...base, found: false, periods: [] };
  const all = data.byName.get(me).filter(played);
  const year = new Date().getFullYear();
  const cut = new Date(Date.now() - 364 * 864e5).toISOString().slice(0, 10).replace(/-/g, '');
  const pool = data.rows.filter(played);
  const make = (key, label, test) => { const list = all.filter(test); return list.length ? period(key, label, list, me, tourAverages(data, key, pool.filter(test))) : null; };
  const periods = [
    ...Array.from({ length: YEARS }, (_, i) => make(String(year - i), String(year - i), m => m.tourney_date.startsWith(String(year - i)))),
    make('52w', '52 semanas', m => m.tourney_date >= cut),
    make('all', `${YEARS} años`, () => true)
  ].filter(Boolean);
  return { ...base, found: true, periods };
}

// Palabras que salen en muchos torneos: "Open" no dice nada, y con ella el Madrid Open parecería el Open de Australia
const GENERIC = new Set(['open', 'masters', 'tennis', 'championships', 'championship', 'international', 'internationals', 'tournament', 'cup', 'tour', 'grand', 'prix', 'bank', 'the', 'and', 'atp', 'wta', 'presented']);
const wordsOf = s => norm(s).split(' ').filter(w => w.length >= 3 && !GENERIC.has(w));

// Superficie de un torneo. Los nombres de ESPN y TennisMyLife no coinciden ("Rolex Paris Masters" / "Paris Masters"; Viena es
// "Erste Bank Open" en uno y "Vienna" en otro). El nombre pesa más que la ciudad: en París se juegan Roland Garros y el Masters
async function tournamentEdition(tour, name, city) {
  const data = await dataset(tour);
  const latest = new Map(); // nombre del torneo → su edición más reciente
  for (const m of data.rows) { const k = norm(m.tourney_name); if (!latest.has(k) || m.tourney_date > latest.get(k).tourney_date) latest.set(k, m); }
  const exact = latest.get(norm(name));
  if (exact) return exact;
  const inName = wordsOf(name), inCity = wordsOf(String(city || '').split(',')[0]);
  let best = null, score = 0;
  for (const [k, m] of latest) {
    const w = k.split(' ');
    const sc = inName.filter(x => w.includes(x)).length * 2 + inCity.filter(x => w.includes(x)).length;
    if (sc > score || (sc === score && sc > 0 && m.tourney_date > best.tourney_date)) { best = m; score = sc; }
  }
  return best; // sin coincidencia es mejor no decir nada que dar una superficie falsa
}
const tournamentSurface = async (tour, name, city) => (await tournamentEdition(tour, name, city))?.surface || null;

module.exports = { playerStats, tournamentSurface, tournamentEdition, dataset, resolve, parseCsv, norm, SURFACES };
