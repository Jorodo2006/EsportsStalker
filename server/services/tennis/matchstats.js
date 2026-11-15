// Estadísticas de un partido de tenis (aces, dobles faltas, primer saque, puntos al saque, bolas de break…). ESPN no las tiene.
// - WTA: la API de su web oficial (la misma de los puntos en directo; su robots.txt no pone límites), en directo y al acabar, por sets
// - Si no (la ATP y los Challenger, o la WTA si su web falla): TennisMyLife, que las publica uno o varios días después
// LiveScore las tendría al momento, pero su robots.txt prohíbe /api/ y se decidió no usarlo para esto (docs/specs/09-tenis.md).
const { cachedJSON } = require('../../shared/cached');
const tml = require('./tml');
const { samePlayer } = require('./points');

const WTA = 'https://api.wtatennis.com/tennis/tournaments';
const getJSON = cachedJSON({ table: 'tennis.cache', saveEvery: 60e3, label: 'WTA' });
const addDays = (d, n) => new Date(Date.parse(d + 'T12:00:00Z') + n * 864e5).toISOString().slice(0, 10);

// Lo mismo para las dos fuentes: un bloque por jugador
// servePts: puntos al saque; firstIn: primeros dentro; firstWon / secondWon: puntos ganados con el primero y con el segundo;
// bpConv / bpChances: bolas de break convertidas al resto y las que tuvo; bpSaved / bpFaced: las salvadas al saque y las que afrontó
const block = (x) => ({
  aces: x.aces ?? null, df: x.df ?? null, servePts: x.servePts ?? null, firstIn: x.firstIn ?? null, firstWon: x.firstWon ?? null,
  secondWon: x.secondWon ?? null, bpConv: x.bpConv ?? null, bpChances: x.bpChances ?? null, bpSaved: x.bpSaved ?? null,
  bpFaced: x.bpFaced ?? null, serveGames: x.serveGames ?? null, totalPts: x.totalPts ?? null
});

// ---------- WTA ----------
function wtaSide(r, s) {
  const servePts = r[`totservplayed${s}`], firstIn = r[`ptsplayed1stserv${s}`], firstWon = r[`ptswon1stserv${s}`], o = s === 'a' ? 'b' : 'a';
  return block({
    aces: r[`aces${s}`], df: r[`dblflt${s}`], servePts, firstIn, firstWon, secondWon: r[`ptstotwonserv${s}`] - firstWon,
    bpConv: r[`breakptsconv${s}`], bpChances: r[`breakptsplayed${s}`],
    // Las que salvó al saque son las que el rival no convirtió
    bpSaved: r[`breakptsplayed${o}`] - r[`breakptsconv${o}`], bpFaced: r[`breakptsplayed${o}`],
    serveGames: r[`servgamesplayed${s}`], totalPts: r[`totptswon${s}`]
  });
}

async function fromWta(m) {
  const list = await getJSON(`${WTA}/?page=0&pageSize=50&excludeLevels=ITF&from=${addDays(m.date, -1)}&to=${addDays(m.date, 1)}`, 30 * 60e3);
  for (const t of list?.content || []) {
    const live = m.state === 'in';
    const ms = (await getJSON(`${WTA}/${t.tournamentGroup.id}/${t.year}/matches`, live ? 30e3 : 5 * 60e3).catch(() => null))?.matches || [];
    for (const x of ms) {
      if (x.DrawMatchType !== 'S') continue;
      const same = samePlayer(m.a, x.PlayerNameLastA) && samePlayer(m.b, x.PlayerNameLastB);
      const swap = !same && samePlayer(m.a, x.PlayerNameLastB) && samePlayer(m.b, x.PlayerNameLastA);
      if (!same && !swap) continue;
      const rows = await getJSON(`${WTA}/${t.tournamentGroup.id}/${t.year}/matches/${x.MatchID}/stats`, x.MatchState === 'F' ? 24 * 3600e3 : 30e3);
      if (!Array.isArray(rows) || !rows.length) return null;
      // a y b en el orden de nuestro partido
      const pair = r => (swap ? { a: wtaSide(r, 'b'), b: wtaSide(r, 'a') } : { a: wtaSide(r, 'a'), b: wtaSide(r, 'b') });
      const total = rows.find(r => r.setnum === 0);
      return {
        source: 'la web de la WTA', live: x.MatchState !== 'F',
        total: total ? pair(total) : null,
        sets: rows.filter(r => r.setnum > 0).sort((p, q) => p.setnum - q.setnum).map(r => ({ n: r.setnum, time: r.settime || null, ...pair(r) }))
      };
    }
  }
  return null;
}

// ---------- TennisMyLife ----------
const n0 = v => { const x = parseFloat(v); return Number.isFinite(x) ? x : null; };
function tmlSide(r, w) {
  const p = w ? 'w_' : 'l_', o = w ? 'l_' : 'w_';
  const faced = n0(r[`${o}bpFaced`]), saved = n0(r[`${o}bpSaved`]);
  return block({
    aces: n0(r[`${p}ace`]), df: n0(r[`${p}df`]), servePts: n0(r[`${p}svpt`]), firstIn: n0(r[`${p}1stIn`]), firstWon: n0(r[`${p}1stWon`]),
    secondWon: n0(r[`${p}2ndWon`]), bpConv: faced != null && saved != null ? faced - saved : null, bpChances: faced,
    bpSaved: n0(r[`${p}bpSaved`]), bpFaced: n0(r[`${p}bpFaced`]), serveGames: n0(r[`${p}SvGms`])
  });
}

async function fromTml(m) {
  const data = await tml.dataset(m.tour);
  const a = tml.resolve(data, m.a), b = tml.resolve(data, m.b);
  if (!a || !b) return null;
  // El partido es de un torneo que empezó como mucho 16 días antes (tourney_date es el lunes del torneo)
  const day = m.date.replace(/-/g, ''), from = addDays(m.date, -16).replace(/-/g, '');
  const r = (data.byName.get(a) || []).find(x => x.tourney_date <= day && x.tourney_date >= from && [tml.norm(x.winner_name), tml.norm(x.loser_name)].includes(b));
  if (!r || n0(r.w_svpt) == null) return null;
  const aWon = tml.norm(r.winner_name) === a;
  return { source: 'TennisMyLife', live: false, minutes: n0(r.minutes), total: { a: tmlSide(r, aWon), b: tmlSide(r, !aWon) }, sets: [] };
}

// m: { tour, date (AAAA-MM-DD, del partido), state, a, b (nombres como los da ESPN) }
async function matchStats(m) {
  if (m.tour === 'wta') {
    const w = await fromWta(m).catch(e => { console.error('[tenis] estadísticas de la WTA:', e.message); return null; });
    if (w?.total) return w;
  }
  if (m.state !== 'post') return null; // TennisMyLife sólo tiene partidos acabados
  return fromTml(m).catch(e => { console.error('[tenis] estadísticas de TennisMyLife:', e.message); return null; });
}

module.exports = { matchStats, wtaSide, tmlSide };
