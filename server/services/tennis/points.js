'use strict';
// Puntos del juego en curso (15-30, 40-AD) y quién saca. ESPN no los da. En la WTA salen de la API que usa su web oficial, cuyo
// robots.txt no pone límites; en la ATP y los Challenger, de LiveScore (livescore.js), porque la web de la ATP responde 403.
// No van a tennis.cache: pasados unos segundos ya no sirven para nada.
const ls = require('./livescore');

const API = 'https://api.wtatennis.com/tennis/tournaments';
const LIST_TTL = 6 * 3600e3;
const LIVE_TTL = 15e3;
const MAX_AGE = 5 * 60e3; // tanto rato sin cambios es que está parado (lluvia, lesión) y ese marcador ya no dice nada

async function getJSON(url) {
  const res = await fetch(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(5000) });
  if (!res.ok) throw new Error(`respondió ${res.status}`);
  return res.json();
}

// ---------- WTA: torneos y partidos en juego ----------
const day = n => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
let list = { t: 0, v: [] };
async function tournaments() {
  if (Date.now() - list.t < LIST_TTL) return list.v;
  const j = await getJSON(`${API}/?page=0&pageSize=30&excludeLevels=ITF&from=${day(-1)}&to=${day(1)}`);
  // Con un día de margen: el torneo acaba en hora de allí y los partidos pueden seguir aquí
  list = { t: Date.now(), v: (j.content || []).filter(t => t.startDate <= day(1) && t.endDate >= day(-1)) };
  return list.v;
}

// Todas las fuentes se traducen a esto: nombres, juegos, puntos, quién saca y cuándo cambió
function wtaRecord(f) {
  const sets = [1, 2, 3, 4, 5].filter(i => f[`ScoreSet${i}A`] !== '' && f[`ScoreSet${i}B`] !== '').map(i => [Number(f[`ScoreSet${i}A`]), Number(f[`ScoreSet${i}B`])]);
  return { source: 'la web de la WTA', lastA: f.PlayerNameLastA, lastB: f.PlayerNameLastB, sets, a: f.PointA, b: f.PointB, serve: f.Serve === 'A' ? 'a' : f.Serve === 'B' ? 'b' : null, at: Date.parse(f.LastUpdated) };
}

let feed = { t: 0, v: [], running: null };
function liveWta() {
  if (Date.now() - feed.t < LIVE_TTL) return Promise.resolve(feed.v);
  // Varias peticiones a la vez comparten la misma lectura
  feed.running ??= (async () => {
    const ts = await tournaments();
    const lists = await Promise.all(ts.map(t => getJSON(`${API}/${t.tournamentGroup.id}/${t.year}/matches?states=L`).then(j => j.matches || []).catch(() => [])));
    feed = { ...feed, t: Date.now(), v: lists.flat().filter(m => m.DrawMatchType === 'S' && m.MatchState === 'P').map(wtaRecord) };
    return feed.v;
  })().finally(() => { feed.running = null; });
  return feed.running;
}

// ---------- cruzar con los partidos de ESPN ----------
// Por palabras y no en orden: ESPN escribe "Li Zongyu" y la WTA, nombre "Zongyu" y apellido "Li"
const words = s => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[-.]/g, ' ').replace(/[^a-z ]/g, '').split(' ').filter(Boolean);
const samePlayer = (name, lastName) => { const w = new Set(words(name)), l = words(lastName); return l.length > 0 && l.every(x => w.has(x)); };

// Sin el 0-0 del set que acaba de empezar: una fuente lo da y la otra no
const trim = sets => { const s = sets.slice(); while (s.length && s[s.length - 1][0] === 0 && s[s.length - 1][1] === 0) s.pop(); return s; };
const pointText = p => (/^a/i.test(String(p)) ? 'AD' : String(p));

function shown(r, swap, now) {
  if (!(now - r.at < MAX_AGE) || r.a == null || r.b == null) return null;
  const [a, b] = swap ? [r.b, r.a] : [r.a, r.b];
  const server = r.serve == null ? null : (r.serve === 'a') !== swap ? 'a' : 'b';
  const cur = r.sets[r.sets.length - 1];
  return { a: pointText(a), b: pointText(b), server, tiebreak: !!cur && cur[0] === 6 && cur[1] === 6, at: r.at, source: r.source };
}

// Devuelve null si no se puede enseñar con garantías. Si los juegos no coinciden con los de ESPN, una de las dos fuentes va por
// detrás (al acabar un tie-break, una daba 6-7 y la otra seguía en 6-6 con 5-6): mejor no enseñar nada que un 5-6 de un set terminado
function pointsOf(m, live, now = Date.now()) {
  for (const r of live) {
    const same = samePlayer(m.a.name, r.lastA) && samePlayer(m.b.name, r.lastB);
    const swap = !same && samePlayer(m.a.name, r.lastB) && samePlayer(m.b.name, r.lastA);
    if (!same && !swap) continue;
    const espn = trim(m.a.sets.map((v, i) => [v, m.b.sets[i]]));
    const other = trim(swap ? r.sets.map(([x, y]) => [y, x]) : r.sets);
    return JSON.stringify(espn) === JSON.stringify(other) ? shown(r, swap, now) : null;
  }
  return null;
}

const quiet = (name, p) => p.catch(e => { console.error(`[tennis] puntos (${name}):`, e.message); return []; });

// Los Challenger ya traen sus juegos y sus puntos de LiveScore: salen de la misma fuente y siempre cuadran
async function withPoints(matches) {
  const wanted = t => matches.filter(m => m.tour === t && m.state === 'in' && !m.level);
  const wta = wanted('wta'), atp = wanted('atp');
  const [liveW, liveA] = await Promise.all([wta.length ? quiet('WTA', liveWta()) : [], atp.length ? quiet('LiveScore', ls.liveAtp()) : []]);
  for (const m of wta) m.points = pointsOf(m, liveW);
  for (const m of atp) m.points = pointsOf(m, liveA);
  for (const m of matches) {
    if (m.level && m.record) m.points = shown(m.record, false, Date.now());
    delete m.record;
  }
  return matches;
}

module.exports = { withPoints, pointsOf, wtaRecord };
