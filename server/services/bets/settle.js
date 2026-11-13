'use strict';
// Resolución automática de apuestas. Cada 5 minutos mira las apuestas pendientes; las que saben a qué partido y mercado
// pertenecen (ref, lo pone el cupón; las de antes se intentan reconocer por el texto) se resuelven con el resultado que da
// el servicio de su deporte (por su API: este servicio sólo toca el esquema bets). Lo que no sabe interpretar con seguridad
// (retiradas en tenis, prórrogas en eliminatorias de fútbol, hándicaps de cuarto de gol, un jugador que no encuentra) se queda
// pendiente para hacerlo a mano: mejor no resolver que resolver mal.
const { query, notify } = require('../../shared/db');
const client = require('../../shared/client');
const store = require('./store');
const { mentions } = require('../../shared/fighters');
const predictions = require('./predictions');

const TICK = 5 * 60e3;
const madridDay = t => new Date(t).toLocaleDateString('en-CA', { timeZone: 'Europe/Madrid' });
const addDays = (d, n) => { const x = new Date(`${d}T12:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
// Nombres de jugador comparables: sin acentos, mayúsculas, signos ni "Jr." (las casas no siempre lo ponen)
const norm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim().replace(/\s+(jr|sr|ii|iii|iv)\.?$/, '').replace(/[^a-z]/g, '');
const es = v => String(Math.round(v * 100) / 100).replace('.', ',');
const quarterLine = l => Math.abs(l * 4) % 2 === 1; // 0,25 / 0,75: se reparte en dos apuestas; a mano

// ---------- resultados de cada deporte ----------
// Cada uno devuelve null si el partido no ha acabado (o no se puede resolver solo), o
// { a, b, score(period) → [a, b] | null, extra } con a y b orientados como en la app (baloncesto: visitante y local;
// fútbol: local y visitante; tenis: como vienen)
const sum = xs => xs.reduce((s, x) => s + (Number(x) || 0), 0);

async function gamesAround(service, path, start, date) {
  const day = start ? madridDay(start) : date;
  if (!day) return [];
  const days = [day, addDays(day, -1), addDays(day, 1)];
  return (await Promise.all(days.map(d => client.call(service, 'GET', `${path}?date=${d}`).catch(() => [])))).flat();
}

async function basketResult(ref) {
  const g = (await gamesAround('basket', '/api/basket/games', ref.start, ref.date)).find(x => x.id === ref.match);
  if (!g || g.state !== 'post') return null;
  const box = await client.call('basket', 'GET', `/api/basket/boxscore/${encodeURIComponent(g.id)}`);
  const away = box.teams.find(t => t.side === 'away'), home = box.teams.find(t => t.side === 'home');
  if (!away || !home) return null;
  const fa = Number(g.away.score), fb = Number(g.home.score);
  const pa = away.periods || [], pb = home.periods || [];
  // 0 el partido (con prórroga), 1-2 las mitades (la segunda con la prórroga, como las casas), 11-14 los cuartos
  const score = period => {
    if (period === 0) return [fa, fb];
    if (period === 1) return pa.length >= 2 ? [sum(pa.slice(0, 2)), sum(pb.slice(0, 2))] : null;
    if (period === 2) return pa.length >= 4 ? [sum(pa.slice(2)), sum(pb.slice(2))] : null;
    if (period >= 11 && period <= 14) { const i = period - 11; return pa.length > i ? [pa[i], pb[i]] : null; }
    return null;
  };
  const players = [...away.players, ...home.players];
  return { sport: 'basket', label: `${g.away.abbr} ${fa}-${fb} ${g.home.abbr}`, score, players, unit: 'puntos' };
}

async function footballResult(ref) {
  const d = await client.call('football', 'GET', `/api/football/match?id=${encodeURIComponent(ref.match)}`);
  const m = d.match;
  if (m.state !== 'post' || m.off) return null;
  // Con prórroga (eliminatorias) las casas pagan lo de los 90 minutos y ESPN da el marcador final: a mano
  const base = e => parseInt(e.minute, 10);
  if ((d.timeline || []).some(e => base(e) > 90 && !/\+/.test(e.minute)) || /pr[oó]rroga|penaltis|aet|pen/i.test(m.status)) return null;
  const isGoal = e => ['goal', 'penalty', 'owngoal'].includes(e.kind);
  const half = [0, 0];
  for (const e of d.timeline || []) if (isGoal(e) && base(e) <= 45) half[e.team === m.home.id ? 0 : 1]++;
  const fa = Number(m.home.score), fb = Number(m.away.score);
  const st = id => d.stats?.[id] || {};
  const score = period => (period === 0 ? [fa, fb] : period === 1 ? half : period === 2 ? [fa - half[0], fb - half[1]] : null);
  const corners = [st(m.home.id).wonCorners, st(m.away.id).wonCorners];
  const cards = [sum([st(m.home.id).yellowCards, st(m.home.id).redCards]), sum([st(m.away.id).yellowCards, st(m.away.id).redCards])];
  return {
    sport: 'football', label: `${m.home.name} ${fa}-${fb} ${m.away.name}`, score, unit: 'goles',
    corners: corners.every(v => v != null) ? corners : null, cards: Object.keys(st(m.home.id)).length ? cards : null
  };
}

async function tennisResult(ref) {
  const m = (await gamesAround('tennis', '/api/tennis/games', ref.start, ref.date)).find(x => x.id === ref.match);
  if (!m || m.state !== 'post') return null;
  if (/retir|w\.?o\.?|walkover|abandon/i.test(`${m.status} ${m.note}`)) return null; // cada casa lo paga a su manera: a mano
  const sa = m.a.sets || [], sb = m.b.sets || [];
  // 0 el partido (juegos de todos los sets), 21-25 cada set
  const score = period => {
    if (period === 0) return [sum(sa), sum(sb)];
    const i = period - 21;
    return i >= 0 && i < 5 ? (sa.length > i ? [sa[i], sb[i]] : 'unplayed') : null;
  };
  return {
    sport: 'tennis', label: `${m.a.name} ${sa.map((x, i) => `${x}-${sb[i]}`).join(' ')} ${m.b.name}`, score, unit: 'juegos',
    winner: m.a.winner ? 'a' : m.b.winner ? 'b' : null
  };
}

// MMA: el combate tiene que estar terminado y no anulado. Un empate o un "sin resultado" no se resuelven solos: cada casa los paga a
// su manera (la anulación devuelve la apuesta, un empate puede ser pérdida). El método sólo si ESPN o WOW lo dan
async function mmaResult(ref) {
  const day = ref.start ? madridDay(ref.start) : ref.date;
  const f = (await client.call('mma', 'GET', `/api/mma/match?id=${encodeURIComponent(ref.match)}${day ? `&date=${day}` : ''}`)).fight;
  if (!f || f.state !== 'post' || f.cancelled || !f.result) return null;
  return { sport: 'mma', label: `${f.a.name} vs ${f.b.name}`, score: () => null, mma: f.result, fight: { a: { name: f.a.name }, b: { name: f.b.name } } };
}

// ¿La apuesta es de este combate? Se compara el cartel de la apuesta ("A vs B") con los dos luchadores del resultado: si un id
// cambia de combate (WOW añade uno, un sustituto entra con el mismo id), la apuesta no se resuelve con el resultado de otro
function fightMatches(event, f) {
  const parts = String(event || '').split(/\s+(?:vs\.?|-|–|—)\s+/i);
  if (parts.length !== 2 || !f?.a?.name || !f?.b?.name) return false;
  const [x, y] = parts;
  return (mentions(f.a.name, x) && mentions(f.b.name, y)) || (mentions(f.a.name, y) && mentions(f.b.name, x));
}

const FETCH = { basket: basketResult, football: footballResult, tennis: tennisResult, mma: mmaResult };

// ---------- evaluar un mercado ----------
// Líneas de jugador de baloncesto: los mismos nombres de estadística que el analizador y las casas
const PLAYER_STAT = {
  Puntos: p => p.pts, Rebotes: p => p.reb, Asistencias: p => p.ast, 'Triples anotados': p => parseInt(p.fg3, 10) || 0,
  Robos: p => p.stl, Tapones: p => p.blk, Pérdidas: p => p.tov, 'Pts + Reb + Ast': p => p.pts + p.reb + p.ast,
  'Pts + Reb': p => p.pts + p.reb, 'Pts + Ast': p => p.pts + p.ast, 'Reb + Ast': p => p.reb + p.ast, 'Robos + Tapones': p => p.stl + p.blk
};

// Más / Menos de una línea: igual a la línea es nula
const overUnder = (v, line, out) => (v === line ? 'void' : (v > line) === (out === 'over') ? 'won' : 'lost');

// MMA: ganador, método de cada luchador, "llega a decisión" y total de asaltos (claves de odds.js: moneyline|0||, method|0|<ko|sub|dec>|,
// distance|0||, total_rounds|0||<línea>). El tiempo se mide en minutos: asaltos de 5, y el combate acaba en (asalto-1)*5 + tiempo
function evaluateMma(type, kind, line, out, R) {
  const r = R.mma;
  if (!r || r.draw || r.noContest || (r.winner !== 'a' && r.winner !== 'b')) return null;
  const text = `${R.label}: gana ${r.winner === 'a' ? 'la esquina roja' : 'la azul'}${r.method ? ` por ${{ ko: 'KO/TKO', sub: 'sumisión', dec: 'decisión' }[r.method] || 'otro método'}` : ''}`;
  if (type === 'moneyline') return { status: r.winner === out ? 'won' : 'lost', text };
  // Sin método conocido, o uno que cada casa paga a su manera (descalificación…), no se resuelve solo
  if (!['ko', 'sub', 'dec'].includes(r.method)) return null;
  if (type === 'method') return ['ko', 'sub', 'dec'].includes(kind) && (out === 'a' || out === 'b') ? { status: r.winner === out && r.method === kind ? 'won' : 'lost', text } : null;
  if (type === 'distance') return { status: (r.method === 'dec') === (out === 'yes') ? 'won' : 'lost', text };
  if (type === 'total_rounds') {
    const m = /^(\d+):(\d{2})$/.exec(String(r.time || ''));
    if (!m || !Number.isInteger(r.round) || r.round < 1 || !isFinite(line)) return null;
    const minutes = (r.round - 1) * 5 + Number(m[1]) + Number(m[2]) / 60;
    return { status: overUnder(Math.round(minutes * 1000) / 1000, line * 5, out), text: `${text} (${es(minutes)} min)` };
  }
  return null;
}

// → { status: 'won' | 'lost' | 'void', text } o null si no se sabe resolver
function evaluate(ref, R) {
  const parts = ref.key.split('|');
  const type = parts[0], out = ref.out;
  if (type === 'player') {
    if (R.sport !== 'basket') return null;
    const [, stat, who, l] = parts, line = Number(l), f = PLAYER_STAT[stat];
    if (!f || !isFinite(line)) return null;
    const n = norm(who);
    const p = R.players.find(x => norm(x.name) === n)
      || R.players.find(x => { const a = norm(x.name); return a.length > 4 && n.length > 4 && (a.endsWith(n.slice(1)) || n.endsWith(a.slice(1))) && a[0] === n[0]; });
    if (!p) return null;
    if (!p.min) return { status: 'void', text: `${p.name} no jugó` };
    const v = f(p);
    return { status: overUnder(v, line, out), text: `${p.name}: ${es(v)} (${stat.toLowerCase()})` };
  }
  const period = Number(parts[1]) || 0, side = parts[2], line = Number(parts[3]);
  if (quarterLine(line)) return null;
  if (type === 'corners' || type === 'cards') {
    const pair = R[type];
    if (!pair || period !== 0) return null;
    const v = pair[0] + pair[1];
    return { status: overUnder(v, line, out), text: `${es(v)} ${type === 'corners' ? 'córners' : 'tarjetas'}` };
  }
  if (R.sport === 'mma') return R.fight && !fightMatches(ref.event, R.fight) ? null : evaluateMma(type, parts[2], line, out, R);
  const sc = R.score(period);
  if (sc === 'unplayed') return { status: 'void', text: 'Ese set no se jugó' };
  if (!sc || sc.some(v => !isFinite(v))) return null;
  const [a, b] = sc;
  const res = `${R.label}${period ? ` (en ese periodo, ${es(a)}-${es(b)})` : ''}`;
  switch (type) {
    case 'moneyline': {
      // Tenis, partido: el que gana (no quien hace más juegos)
      const w = R.sport === 'tennis' && period === 0 ? R.winner : a > b ? 'a' : b > a ? 'b' : 'x';
      if (!w) return null;
      if (w === 'x' && R.sport !== 'football') return null; // empate en un cuarto de un ganador a dos: según la casa
      return { status: w === out ? 'won' : 'lost', text: res };
    }
    case 'double': {
      const w = a > b ? 'a' : b > a ? 'b' : 'x';
      const ok = { '1x': ['a', 'x'], '12': ['a', 'b'], x2: ['x', 'b'] }[out];
      return ok ? { status: ok.includes(w) ? 'won' : 'lost', text: res } : null;
    }
    case 'dnb':
      return a === b ? { status: 'void', text: res } : { status: (a > b ? 'a' : 'b') === out ? 'won' : 'lost', text: res };
    case 'btts':
      return { status: (a > 0 && b > 0) === (out === 'yes') ? 'won' : 'lost', text: res };
    case 'spread': {
      if (!isFinite(line)) return null;
      const d = a - b + line; // la línea es la del primero (a)
      if (d === 0) return { status: 'void', text: res };
      return { status: (d > 0) === (out === 'a') ? 'won' : 'lost', text: res };
    }
    case 'total':
      return isFinite(line) ? { status: overUnder(a + b, line, out), text: `${res}: ${es(a + b)} ${R.unit}` } : null;
    case 'team_total': {
      const v = side === 'a' ? a : side === 'b' ? b : null;
      return v != null && isFinite(line) ? { status: overUnder(v, line, out), text: `${res}: ${es(v)} ${R.unit}` } : null;
    }
    default: return null;
  }
}

// ---------- reconocer apuestas sin ref (las de antes, o apuntadas desde otro sitio de la app) ----------
// Sólo baloncesto y con los textos que pone la propia app: "CHA @ BKN" + "Total de puntos" + "Más de 212.5",
// "Asistencias · Naji Marshall" + "Más de 2.5", "Jugadores · Asistencias" + "Naji Marshall · Más de 2.5"
const PERIOD_OF = { '1.ª mitad': 1, '2.ª mitad': 2, '1.er cuarto': 11, '2.º cuarto': 12, '3.er cuarto': 13, '4.º cuarto': 14 };
async function guessBasket(item, date) {
  const ev = /^\s*([A-Za-z0-9]{2,4})\s*@\s*([A-Za-z0-9]{2,4})\s*$/.exec(item.event || '');
  if (!ev) return null;
  const games = await gamesAround('basket', '/api/basket/games', null, date);
  const g = games.find(x => x.away.abbr.toUpperCase() === ev[1].toUpperCase() && x.home.abbr.toUpperCase() === ev[2].toUpperCase());
  if (!g) return null;
  const base = { sport: 'basket', match: g.id, start: g.date, guessed: true };
  let market = String(item.market || '').trim(), sel = String(item.selection || '').trim();
  let period = 0;
  const pm = /^(1\.ª mitad|2\.ª mitad|1\.er cuarto|2\.º cuarto|3\.er cuarto|4\.º cuarto) · (.+)$/.exec(market);
  if (pm) { period = PERIOD_OF[pm[1]]; market = pm[2]; }
  // "Jugadores · Asistencias" con "Naji Marshall · Más de 2.5" → como "Asistencias · Naji Marshall" con "Más de 2.5"
  const grp = /^Jugadores · (.+)$/.exec(market), who = /^(.+) · ((?:Más|Menos) de .+)$/.exec(sel);
  if (grp && who) { market = `${grp[1]} · ${who[1]}`; sel = who[2]; }
  const ou = /^(Más|Menos) de ([\d.,]+)$/i.exec(sel);
  const num = ou ? Number(ou[2].replace(',', '.')) : null, side = ou ? (/^más/i.test(ou[1]) ? 'over' : 'under') : null;
  const prop = /^(.+?) · (.+)$/.exec(market);
  if (ou && prop && PLAYER_STAT[prop[1]] && !period) return { ...base, key: `player|${prop[1]}|${prop[2].toLowerCase()}|${num}`, out: side };
  if (ou && /^total de puntos$/i.test(market)) return { ...base, key: `total|${period}||${num}`, out: side };
  const tp = /^Puntos de (.+)$/i.exec(market);
  if (ou && tp) {
    const s = tp[1].toUpperCase() === g.away.abbr.toUpperCase() ? 'a' : tp[1].toUpperCase() === g.home.abbr.toUpperCase() ? 'b' : null;
    return s ? { ...base, key: `team_total|${period}|${s}|${num}`, out: side } : null;
  }
  if (/^ganador/i.test(market)) {
    const s = sel.toUpperCase() === g.away.abbr.toUpperCase() ? 'a' : sel.toUpperCase() === g.home.abbr.toUpperCase() ? 'b' : null;
    return s ? { ...base, key: `moneyline|${period}||`, out: s } : null;
  }
  const hc = /^h[aá]ndicap$/i.test(market) && /^([A-Za-z0-9]{2,4})\s+([+-]?[\d.,]+)$/.exec(sel);
  if (hc) {
    const v = Number(hc[2].replace(',', '.'));
    if (hc[1].toUpperCase() === g.away.abbr.toUpperCase()) return { ...base, key: `spread|${period}||${v}`, out: 'a' };
    if (hc[1].toUpperCase() === g.home.abbr.toUpperCase()) return { ...base, key: `spread|${period}||${-v}`, out: 'b' };
  }
  return null;
}

// ---------- la pasada ----------
let running = false;
async function run() {
  if (running) return;
  running = true;
  const results = new Map(); // un partido se pide una vez por pasada
  const resultOf = async ref => {
    const k = `${ref.sport}|${ref.match}`;
    if (!results.has(k)) {
      const f = FETCH[ref.sport];
      results.set(k, f ? f(ref).catch(e => { console.error('Resolver', k, e.message); return null; }) : Promise.resolve(null));
    }
    return results.get(k);
  };
  let changed = 0;
  try {
    const { rows } = await query(`SELECT id, user_id FROM bets.bets WHERE status = 'pending' AND user_id IS NOT NULL ORDER BY date LIMIT 500`);
    for (const r of rows) {
      const bet = await store.getBet(r.id);
      if (!bet || bet.status !== 'pending') continue;
      const items = bet.legs?.length ? bet.legs : [bet];
      let touched = false;
      for (const it of items) {
        if (it.status && it.status !== 'pending' && it !== bet) continue;
        const sport = it.sport || bet.sport;
        if (!it.ref && sport === 'basket') {
          const g = await guessBasket(it, bet.date).catch(() => null);
          if (g) { it.ref = g; touched = true; }
        }
        if (!it.ref || it.ref.settled) continue;
        const R = await resultOf({ ...it.ref, date: bet.date });
        if (!R) continue;
        const v = evaluate({ ...it.ref, event: it.event }, R);
        if (!v) continue;
        it.status = v.status;
        it.ref = { ...it.ref, settled: { at: new Date().toISOString(), text: v.text } };
        touched = true;
      }
      if (!touched) continue;
      await store.saveBet(r.user_id, bet);
      if (bet.status !== 'pending' || items.some(i => i.ref?.settled)) changed++;
    }
  } catch (e) {
    console.error('Resolver apuestas:', e.message);
  }
  // Las recomendaciones del modelo, con los mismos resultados (un partido se pide una vez para todo)
  try {
    await predictions.settle(resultOf, evaluate, madridDay);
  } catch (e) {
    console.error('Resolver recomendaciones:', e.message);
  } finally {
    running = false;
  }
  if (changed) notify('bets:settled', { n: changed });
  return changed;
}

function startSettler() {
  setTimeout(run, 20e3);
  setInterval(run, TICK);
}

// El resultado de un partido tal y como lo usa evaluate (para probar sin guardar nada)
const resultFor = ref => (FETCH[ref.sport] ? FETCH[ref.sport](ref) : Promise.resolve(null));

module.exports = { startSettler, run, evaluate, guessBasket, resultFor, fightMatches };
