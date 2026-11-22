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
const ticket = require('./ticket');

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
  // Quién jugó, marcó o vio tarjeta, por nombre (para los mercados de jugador de Winamax)
  const played = new Set((d.lineups || []).flatMap(r => r.players.filter(p => p.starter || p.subIn).map(p => norm(p.name))));
  const scored = new Map(), carded = new Set();
  for (const e of d.timeline || []) {
    if (e.kind === 'goal' || e.kind === 'penalty') scored.set(norm(e.player), (scored.get(norm(e.player)) || 0) + 1);
    else if (e.kind === 'yellow' || e.kind === 'red') carded.add(norm(e.player));
  }
  // Estadísticas de un jugador (remates, paradas, faltas…) de la API core de ESPN: una petición por jugador y sólo si hace falta
  const cache = new Map();
  const statsOf = name => {
    const n = norm(name);
    if (!cache.has(n)) {
      const hit = (d.lineups || []).flatMap(r => r.players.map(p => ({ team: r.team, ...p }))).filter(p => norm(p.name) === n && (p.starter || p.subIn));
      cache.set(n, hit.length === 1
        ? client.call('football', 'GET', `/api/football/player-stats?match=${encodeURIComponent(ref.match)}&team=${hit[0].team}&player=${hit[0].id}`).catch(() => null)
        : Promise.resolve(null));
    }
    return cache.get(n);
  };
  return {
    sport: 'football', label: `${m.home.name} ${fa}-${fb} ${m.away.name}`, score, unit: 'goles', played, scored, carded, statsOf,
    corners: corners.every(v => v != null) ? corners : null, cards: Object.keys(st(m.home.id)).length ? cards : null
  };
}

async function tennisResult(ref) {
  // Los dobles (id "dbl:…") van en su propia ruta: server/services/tennis/doubles.js
  const doubles = /^dbl:/.test(String(ref.match || ''));
  const m = (await gamesAround('tennis', doubles ? '/api/tennis/doubles' : '/api/tennis/games', ref.start, ref.date)).find(x => x.id === ref.match);
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
    winner: m.a.winner ? 'a' : m.b.winner ? 'b' : null,
    names: [m.a.name, m.b.name], sets: [sa, sb],
    // mtb: el tercer set fue un super tie-break (llega como un set 1-0, ver evaluate)
    doubles, mtb: !!m.mtb
  };
}

// LoL: sólo el ganador del partido y el hándicap de mapas, con los mapas ganados de cada equipo (a y b, como en la ficha). El
// partido está acabado cuando uno llega a la mitad más uno de los mapas; sin saber el formato (bestOf), no se resuelve
async function lolResult(ref) {
  const ev = await client.call('esports', 'GET', `/api/esports/events/${encodeURIComponent(ref.match)}`);
  const [a, b] = ev?.teams || [];
  const need = Math.floor(Number(ev?.bestOf) / 2) + 1;
  if (!a || !b || !(need >= 1) || Math.max(a.wins, b.wins) < need || a.wins === b.wins) return null;
  return { sport: 'lol', label: `${a.name} ${a.wins}-${b.wins} ${b.name}`, score: p => (p === 0 ? [a.wins, b.wins] : null), unit: 'mapas' };
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

const FETCH = { lol: lolResult, basket: basketResult, football: footballResult, tennis: tennisResult, mma: mmaResult };

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

// Fútbol, mercados de jugador de Winamax (clave wmx|título|…; la selección es el nombre del jugador): "Goleador" (marca en algún
// momento), "Marca N goles o más" y "El jugador recibe una o más tarjetas". Sólo se resuelve si el jugador jugó y su nombre
// coincide exactamente con el de ESPN; si no jugó (cada casa lo paga distinto) o no se encuentra, a mano. Un gol en propia puerta no cuenta
// "Realiza N o más remates (a puerta | paradas)", "Comete N o más faltas" y "Recibe N o más faltas" salen de las estadísticas del
// jugador (stats, que pide run); sin ellas, a mano
const FOOTBALL_COUNT = [
  [/^realiza (\d+) o más remates a puerta$/i, 'shotsOnTarget', 'remates a puerta'], [/^realiza (\d+) o más remates$/i, 'totalShots', 'remates'],
  [/^realiza (\d+) o más paradas$/i, 'saves', 'paradas'], [/^comete (\d+) o más faltas$/i, 'foulsCommitted', 'faltas cometidas'],
  [/^recibe (\d+) o más faltas$/i, 'foulsSuffered', 'faltas recibidas']
];
const footballCountOf = title => { for (const [re, key, label] of FOOTBALL_COUNT) { const m = re.exec(String(title).trim()); if (m) return { n: Number(m[1]), key, label }; } return null; };

function evaluateFootballPlayer(title, who, R, stats) {
  if (R.sport !== 'football' || !R.played) return null;
  const n = norm(who);
  if (!n || !R.played.has(n)) return null;
  const c = footballCountOf(title);
  if (c) return stats && typeof stats[c.key] === 'number' ? { status: stats[c.key] >= c.n ? 'won' : 'lost', text: `${who}: ${stats[c.key]} ${c.label}` } : null;
  const goals = R.scored.get(n) || 0;
  const t = String(title).trim();
  let m;
  if (/^goleador$/i.test(t)) return { status: goals >= 1 ? 'won' : 'lost', text: `${who}: ${goals} gol${goals === 1 ? '' : 'es'}` };
  if ((m = /^marca (\d+) goles o más$/i.exec(t))) return { status: goals >= Number(m[1]) ? 'won' : 'lost', text: `${who}: ${goals} gol${goals === 1 ? '' : 'es'}` };
  if (/^el jugador recibe una o más tarjetas$/i.test(t)) return { status: R.carded.has(n) ? 'won' : 'lost', text: `${who}: ${R.carded.has(n) ? 'vio tarjeta' : 'sin tarjeta'}` };
  return null;
}

// Tenis, mercados propios de Winamax (clave wmx|título|…; la selección es "Sí", "A. Nagel y D. Lajovic", "Par"…): ganar algún set,
// "Cualquier set a cero", el doble resultado (1.er set y partido) y par/impar de los juegos de un set o del partido. Los nombres
// llegan abreviados ("A. Nagel"): tienen que encajar con un solo jugador del partido, si no se queda a mano
function evaluateTennis(title, sel, R) {
  if (!R.names || !R.sets || R.winner == null) return null;
  const [sa, sb] = R.sets;
  if (!sa.length || sa.length !== sb.length) return null;
  const sideOf = t => { const h = [0, 1].filter(i => mentions(R.names[i], t)); return h.length === 1 ? ['a', 'b'][h[0]] : null; };
  const yes = /^s[ií]$/i.test(sel) ? true : /^no$/i.test(sel) ? false : null;
  const t = String(title).trim();
  let m;
  const setWon = (i, side) => (side === 'a' ? sa[i] > sb[i] : sb[i] > sa[i]);
  if ((m = /^gana al menos un set (.+)$/i.exec(t))) {
    const side = sideOf(m[1]);
    if (!side || yes == null) return null;
    const won = sa.some((_, i) => setWon(i, side));
    return { status: won === yes ? 'won' : 'lost', text: `${R.label}` };
  }
  if (/^cualquier set a cero$/i.test(t)) {
    if (yes == null) return null;
    const any = sa.some((x, i) => (x === 0 || sb[i] === 0) && x !== sb[i]);
    return { status: any === yes ? 'won' : 'lost', text: `${R.label}` };
  }
  if (/^doble resultado \(1º set y partido\)$/i.test(t)) {
    const two = String(sel).split(/\s+y\s+/);
    const first = two.length === 2 ? sideOf(two[0]) : null, match = two.length === 2 ? sideOf(two[1]) : null;
    if (!first || !match || sa[0] === sb[0]) return null;
    const ok = (sa[0] > sb[0] ? 'a' : 'b') === first && R.winner === match;
    return { status: ok ? 'won' : 'lost', text: `${R.label}` };
  }
  if ((m = /^(?:(\d)(?:º|\.º|er|\.er)? set - )?total de juegos - par\/impar$/i.exec(t))) {
    const i = m[1] ? Number(m[1]) - 1 : null;
    if (i != null && i >= sa.length) return { status: 'void', text: 'Ese set no se jugó' };
    const v = i == null ? sum(sa) + sum(sb) : sa[i] + sb[i];
    const odd = /^impar$/i.test(sel) ? true : /^par$/i.test(sel) ? false : null;
    return odd == null ? null : { status: (v % 2 === 1) === odd ? 'won' : 'lost', text: `${R.label}: ${v} juegos` };
  }
  return null;
}

// → { status: 'won' | 'lost' | 'void', text } o null si no se sabe resolver
function evaluate(ref, R) {
  const parts = ref.key.split('|');
  const type = parts[0], out = ref.out;
  // Los mercados propios de Winamax de un dobles, a mano: comparan nombres de un jugador ("A. Nagel y D. Lajovic") y cuentan sets a cero
  if (type === 'wmx') return R.sport === 'tennis' ? (R.doubles ? null : evaluateTennis(parts[1], ref.selection, R)) : evaluateFootballPlayer(parts[1], ref.selection, R, ref.stats);
  if (type === 'player') {
    if (R.sport !== 'basket') return null;
    const [, stat, who, l] = parts, line = Number(l), f = PLAYER_STAT[stat];
    if (!f || !isFinite(line)) return null;
    const n = norm(who);
    // Por el nombre exacto; si no, por la inicial y el apellido ("D. Mitchell"), pero sólo si encaja con un único jugador del
    // partido: con Donovan y Davion Mitchell en la pista, cualquiera de los dos sería adivinar, y se resuelve a mano
    const near = R.players.filter(x => { const a = norm(x.name); return a.length > 4 && n.length > 4 && (a.endsWith(n.slice(1)) || n.endsWith(a.slice(1))) && a[0] === n[0]; });
    const p = R.players.find(x => norm(x.name) === n) || (near.length === 1 ? near[0] : null);
    if (!p) return null;
    if (!p.min) return { status: 'void', text: `${p.name} no jugó` };
    const v = f(p);
    return { status: overUnder(v, line, out), text: `${p.name}: ${es(v)} (${stat.toLowerCase()})` };
  }
  const period = Number(parts[1]) || 0, side = parts[2], line = Number(parts[3]);
  if (quarterLine(line)) return null;
  // LoL: de los mercados por mapa (kills, primera sangre…) no se tiene el resultado: sólo ganador y hándicap del partido entero
  if (R.sport === 'lol' && (period !== 0 || !['moneyline', 'spread'].includes(type))) return null;
  // «Ambos equipos recibirán N tarjetas o más» (bet365; sólo llega al subir su ticket): cards_both|0||N, sí o no
  if (type === 'cards_both') {
    const pair = R.cards, n = Number(parts[3]);
    if (!pair || period !== 0 || !(n >= 1) || (out !== 'yes' && out !== 'no')) return null;
    const both = pair[0] >= n && pair[1] >= n;
    return { status: both === (out === 'yes') ? 'won' : 'lost', text: `Tarjetas: ${pair[0]} y ${pair[1]}` };
  }
  if (type === 'corners' || type === 'cards') {
    const pair = R[type];
    if (!pair || period !== 0) return null;
    const v = pair[0] + pair[1];
    return { status: overUnder(v, line, out), text: `${es(v)} ${type === 'corners' ? 'córners' : 'tarjetas'}` };
  }
  if (R.sport === 'mma') return R.fight && !fightMatches(ref.event, R.fight) ? null : evaluateMma(type, parts[2], line, out, R);
  // Dobles con super tie-break: cada casa lo cuenta a su manera (como un juego, como un set…), así que lo que depende de los juegos del
  // partido o del tercer set se resuelve a mano. El ganador del partido y los dos primeros sets, solos. 23: el 3.er set (21-25)
  if (R.mtb && (period === 23 || (period === 0 && type !== 'moneyline'))) return null;
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
const GUESS = { football: '/api/football/games', tennis: '/api/tennis/games', mma: '/api/mma/games' };
async function guessByText(item, date, sport) {
  if (!item.event) return null;
  const games = (await gamesAround(sport, GUESS[sport], null, date)).map(g => ticket.gameOf(sport, g)).filter(Boolean);
  return ticket.guessRef(item, games, date);
}

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
        // Fútbol, tenis y MMA sin partido (apuntadas a mano, o de un sitio que no lo guardaba): por el texto, con las reglas del
        // lector de tickets. Se guarda al momento, sin esperar al final, para que salga en «Tus apuestas» mientras se juega
        if (!it.ref && GUESS[sport]) {
          const g = await guessByText(it, bet.date, sport).catch(() => null);
          if (g) { it.ref = g; touched = true; }
        }
        if (!it.ref || it.ref.settled) continue;
        const R = await resultOf({ ...it.ref, date: bet.date });
        if (!R) continue;
        // Remates, paradas y faltas de un jugador: sus estadísticas se piden aparte
        const stats = R.statsOf && it.ref.key.startsWith('wmx|') && footballCountOf(it.ref.key.split('|')[1]) ? await R.statsOf(it.selection) : null;
        const v = evaluate({ ...it.ref, event: it.event, selection: it.selection, stats }, R);
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
