// API pública de la Euroliga (api-live.euroleague.net, la que usa su web): Euroliga (E) y EuroCup (U).
// Calendario y resultados de la temporada, plantillas y box score de cada partido. La serie de partidos de un
// jugador se monta con los box scores de su equipo (los terminados se guardan y no se vuelven a pedir).
const { getJSON } = require('./cache');

const API = 'https://api-live.euroleague.net';
const COMPS = { euroleague: 'E', eurocup: 'U' };
// La temporada empieza en julio: 2026-27 es E2026
const seasonStart = (d = new Date()) => (d.getMonth() >= 6 ? d.getFullYear() : d.getFullYear() - 1);
const code = (lg, year) => `${COMPS[lg]}${year}`;
const LIVE_MS = 3 * 3600e3; // un partido sin terminar empezado hace menos de 3 h está en juego

async function season(lg, year = seasonStart()) {
  const s = code(lg, year);
  const j = await getJSON(`${API}/v2/competitions/${COMPS[lg]}/seasons/${s}/games`, 2 * 60e3);
  return j.data || [];
}

const sideOf = (t, showScore) => ({
  id: t.club?.code || '', abbr: t.club?.tvCode || t.club?.code || '', name: (t.club?.editorialName || t.club?.abbreviatedName || t.club?.name || '').trim(),
  // Nombres completos y cortos: las casas usan "Real Madrid" o "FC Barcelona", no "Real" ni "Barca"
  alt: [...new Set([t.club?.name, t.club?.abbreviatedName].filter(Boolean).map(s => s.trim()))],
  logo: t.club?.images?.crest || '', score: showScore ? String(t.score ?? 0) : null, record: ''
});

// "Round 6" → "Jornada 6"; las eliminatorias se dejan como vienen
const roundEs = s => String(s || '').replace(/^Round (\d+)$/i, 'Jornada $1');

function toGame(lg, g) {
  const t = new Date(g.utcDate).getTime();
  const live = !g.played && t <= Date.now() && Date.now() - t < LIVE_MS;
  const state = g.played ? 'post' : live ? 'in' : 'pre';
  return {
    id: `${lg}:${g.season?.code || ''}_${g.gameCode}`, league: lg, date: g.utcDate, state,
    status: g.played ? 'Final' : live ? 'En juego' : roundEs(g.roundAlias) || `Jornada ${g.round}`, clock: '',
    round: roundEs(g.roundName), home: sideOf(g.local, state !== 'pre'), away: sideOf(g.road, state !== 'pre')
  };
}

// Partidos entre dos instantes
async function games(lg, from, to) {
  return (await season(lg)).filter(g => { const t = new Date(g.utcDate).getTime(); return t >= from && t < to; }).map(g => toGame(lg, g));
}

async function roster(lg, team) {
  const j = await getJSON(`${API}/v2/competitions/${COMPS[lg]}/seasons/${code(lg, seasonStart())}/clubs/${encodeURIComponent(team)}/people`, 30 * 60e3);
  return (Array.isArray(j) ? j : j.data || [])
    .filter(p => p.typeName === 'Player' && p.active !== false)
    .map(p => ({
      id: p.person.code, name: niceName(p.person.name), pos: p.positionName || '', jersey: p.dorsal || '',
      headshot: p.images?.headshot || '', injury: null
    }));
}

// "SIFTAR, JAKOB" → "Jakob Siftar"
function niceName(s) {
  const [last, first] = String(s || '').split(',').map(x => x.trim());
  const cap = x => x.toLowerCase().replace(/(^|[\s'-])\p{L}/gu, c => c.toUpperCase());
  return first ? `${cap(first)} ${cap(last)}` : cap(last);
}

// Buscador: por nombre en las plantillas de todos los equipos de la competición
async function search(lg, q) {
  const term = norm(q);
  if (term.length < 2) return [];
  const clubs = [...new Set((await season(lg)).flatMap(g => [g.local?.club?.code, g.road?.club?.code]).filter(Boolean))];
  const out = [];
  await pool(clubs, 6, async c => {
    const club = (await season(lg)).map(g => [g.local, g.road]).flat().find(t => t?.club?.code === c)?.club;
    for (const p of await roster(lg, c).catch(() => [])) {
      if (norm(p.name).includes(term)) out.push({ id: p.id, league: lg, team: club?.editorialName || c, teamId: c, name: p.name, pos: p.pos, headshot: p.headshot });
    }
  });
  return out.slice(0, 25);
}

const norm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

// Hasta n tareas a la vez (para no lanzar 40 peticiones de golpe a la API)
async function pool(items, n, fn) {
  const queue = items.slice();
  await Promise.all(Array.from({ length: Math.min(n, queue.length) }, async () => { while (queue.length) await fn(queue.shift()); }));
}

// Partidos del jugador con su equipo: esta temporada y la anterior
async function gamelog(lg, player, team) {
  const y = seasonStart();
  const out = [];
  for (const year of [y, y - 1]) {
    const list = (await season(lg, year).catch(() => [])).filter(g => g.played && (g.local?.club?.code === team || g.road?.club?.code === team));
    await pool(list, 6, async g => {
      const box = await getJSON(`${API}/v3/competitions/${COMPS[lg]}/seasons/${code(lg, year)}/games/${g.gameCode}/stats`, 0, { keep: true }).catch(() => null);
      if (!box) return;
      const home = g.local?.club?.code === team;
      const me = (home ? box.local : box.road)?.players?.find(p => p.player?.person?.code === player);
      const s = me?.stats;
      if (!s || !s.timePlayed) return; // no jugó
      const mine = home ? g.local : g.road, opp = home ? g.road : g.local;
      out.push({
        id: `${year}_${g.gameCode}`, date: g.utcDate, season: year, type: g.phaseType?.code === 'RS' ? 'reg' : 'post', home,
        opp: opp.club?.tvCode || opp.club?.code || '?', team: mine.club?.tvCode || team, teamId: team,
        result: mine.score > opp.score ? 'W' : 'L', score: `${mine.score}-${opp.score}`,
        min: Math.round(s.timePlayed / 6) / 10, pts: s.points || 0, reb: s.totalRebounds || 0, ast: s.assistances || 0,
        stl: s.steals || 0, blk: s.blocksFavour || 0, tov: s.turnovers || 0, fg3m: s.fieldGoalsMade3 || 0
      });
    });
  }
  return { currentSeason: y, games: out.sort((a, b) => new Date(b.date) - new Date(a.date)) };
}

module.exports = { COMPS, games, roster, search, gamelog };

// Estadísticas de un partido ("E2026_10"): jugadores, totales sumados y puntos por cuarto
async function boxscore(lg, gid) {
  const [seasonCode, gameCode] = String(gid).split('_');
  const year = Number(seasonCode.slice(1));
  const g = (await season(lg, year)).find(x => String(x.gameCode) === gameCode);
  if (!g) throw new Error('Partido desconocido');
  const box = g.played || new Date(g.utcDate).getTime() <= Date.now()
    ? await getJSON(`${API}/v3/competitions/${COMPS[lg]}/seasons/${seasonCode}/games/${gameCode}/stats`, g.played ? 0 : 30e3, { keep: g.played }).catch(() => null)
    : null;
  const shoot = (m, a) => `${m || 0}-${a || 0}`;
  const row = s => ({
    min: Math.round((s.timePlayed || 0) / 6) / 10, pts: s.points || 0, reb: s.totalRebounds || 0, ast: s.assistances || 0,
    stl: s.steals || 0, blk: s.blocksFavour || 0, tov: s.turnovers || 0,
    fg: shoot((s.fieldGoalsMade2 || 0) + (s.fieldGoalsMade3 || 0), (s.fieldGoalsAttempted2 || 0) + (s.fieldGoalsAttempted3 || 0)),
    fg3: shoot(s.fieldGoalsMade3, s.fieldGoalsAttempted3), ft: shoot(s.freeThrowsMade, s.freeThrowsAttempted), pm: s.plusMinus != null ? String(s.plusMinus) : ''
  });
  const sum = list => {
    const t = { timePlayed: 0, points: 0, totalRebounds: 0, assistances: 0, steals: 0, blocksFavour: 0, turnovers: 0, fieldGoalsMade2: 0, fieldGoalsAttempted2: 0, fieldGoalsMade3: 0, fieldGoalsAttempted3: 0, freeThrowsMade: 0, freeThrowsAttempted: 0 };
    for (const p of list) for (const k of Object.keys(t)) t[k] += p.stats?.[k] || 0;
    return { ...row(t), min: 0, pm: '' };
  };
  const team = (side, t, b) => {
    const players = (b?.players || []).filter(p => p.stats?.timePlayed);
    const pt = t.partials || {};
    return {
      id: t.club?.code || '', name: (t.club?.editorialName || t.club?.name || '').trim(), abbr: t.club?.tvCode || t.club?.code || '',
      logo: t.club?.images?.crest || '', side,
      periods: [pt.partials1, pt.partials2, pt.partials3, pt.partials4, ...Object.values(pt.extraPeriods || {})].filter(v => v != null).map(Number),
      players: players.map(p => ({ id: p.player?.person?.code || '', name: niceName(p.player?.person?.name), starter: !!p.stats.startFive, ...row(p.stats) })),
      totals: sum(players)
    };
  };
  // Enfrentamientos de la temporada entre los dos equipos
  const codes = [g.local?.club?.code, g.road?.club?.code];
  const series = (await season(lg, year)).filter(x => x.played && codes.includes(x.local?.club?.code) && codes.includes(x.road?.club?.code)).map(x => ({
    date: x.utcDate, status: 'Final',
    score: [x.road, x.local].map(t => ({ abbr: t.club?.tvCode || t.club?.code || '', score: String(t.score), winner: t.score > (t === x.road ? x.local : x.road).score }))
  }));
  return { teams: [team('away', g.road, box?.road), team('home', g.local, box?.local)], series };
}

module.exports.boxscore = boxscore;

// ---------- Clasificación y ficha de equipo ----------
const pctNum = s => { const n = parseFloat(s); return Number.isFinite(n) ? n / 100 : 0; };
const fromEs = g => (/^[A-Z]$/.test(g || '') ? `Grupo ${g}` : /regular/i.test(g || '') ? 'Fase regular' : g || '');

// La API pide la clasificación por jornada, y la jornada en curso puede no tenerla todavía (da 404): la última que responda
async function basicStandings(lg) {
  const s = code(lg, seasonStart());
  const j = await getJSON(`${API}/v2/competitions/${COMPS[lg]}/seasons/${s}/rounds`, 6 * 3600e3);
  const started = (j.data || []).filter(r => new Date(r.minGameStartDate).getTime() <= Date.now()).map(r => r.round).sort((a, b) => b - a);
  let last;
  for (const r of started.slice(0, 4)) {
    try { return await getJSON(`${API}/v3/competitions/${COMPS[lg]}/seasons/${s}/rounds/${r}/basicstandings`, 15 * 60e3); } catch (e) { last = e; }
  }
  if (last) throw last;
  return { teams: [] }; // la temporada aún no ha empezado
}

async function standings(lg) {
  const j = await basicStandings(lg);
  // Racha: los partidos terminados de cada equipo, del más reciente hacia atrás
  const played = (await season(lg)).filter(g => g.played).sort((a, b) => new Date(b.utcDate) - new Date(a.utcDate));
  const streak = c => {
    const won = played.filter(g => g.local?.club?.code === c || g.road?.club?.code === c)
      .map(g => (g.local?.club?.code === c ? g.local.score > g.road.score : g.road.score > g.local.score));
    if (!won.length) return '';
    let n = 0;
    while (n < won.length && won[n] === won[0]) n++;
    return `${won[0] ? 'G' : 'P'}${n}`;
  };
  const groups = new Map();
  for (const t of j.teams || []) {
    const name = fromEs(t.groupName);
    if (!groups.has(name)) groups.set(name, []);
    const n = Math.max(1, t.gamesPlayed || 0);
    groups.get(name).push({
      id: t.club?.code || '', abbr: t.club?.tvCode || t.club?.code || '', name: (t.club?.editorialName || t.club?.name || '').trim(), logo: t.club?.images?.crest || '',
      pos: t.position, seed: t.position, w: t.gamesWon || 0, l: t.gamesLost || 0, pct: pctNum(t.winPercentage), home: t.homeRecord || '', road: t.awayRecord || '', last: t.lastTenRecord || '',
      streak: streak(t.club?.code), pf: Math.round(((t.pointsFor || 0) / n) * 10) / 10, pa: Math.round(((t.pointsAgainst || 0) / n) * 10) / 10,
      diff: Math.round((((t.pointsFor || 0) - (t.pointsAgainst || 0)) / n) * 10) / 10, gb: '', form: (t.last5Form || []).map(x => (x === 'W' ? 'G' : 'P'))
    });
  }
  return [...groups].map(([name, teams]) => ({ name, teams })).sort((a, b) => a.name.localeCompare(b.name));
}

const ageFrom = d => { if (!d) return null; const b = new Date(d), n = new Date(); return n.getFullYear() - b.getFullYear() - (n < new Date(n.getFullYear(), b.getMonth(), b.getDate()) ? 1 : 0); };

async function team(lg, id) {
  const s = code(lg, seasonStart()), C = COMPS[lg];
  const [club, people, stats, table, list, players] = await Promise.all([
    getJSON(`${API}/v2/clubs/${encodeURIComponent(id)}`, 24 * 3600e3).catch(() => ({})),
    getJSON(`${API}/v2/competitions/${C}/seasons/${s}/clubs/${encodeURIComponent(id)}/people`, 30 * 60e3).catch(() => []),
    getJSON(`${API}/v3/competitions/${C}/seasons/${s}/clubs/${encodeURIComponent(id)}/stats`, 30 * 60e3).catch(() => []),
    standings(lg).catch(() => []),
    season(lg),
    getJSON(`${API}/v3/competitions/${C}/statistics/players/traditional?seasonMode=Single&seasonCode=${s}&statisticMode=PerGame&limit=500`, 30 * 60e3).catch(() => ({}))
  ]);
  const staff = Array.isArray(people) ? people : people.data || [];
  const avgs = Object.fromEntries((players.players || []).filter(p => p.player?.team?.code === id).map(p => [p.player.code, p]));
  const roster = staff.filter(p => p.typeName === 'Player' && p.active !== false).map(p => {
    const a = avgs[p.person.code];
    return {
      id: p.person.code, name: niceName(p.person.name), pos: p.positionName || '', jersey: p.dorsal || '', headshot: p.images?.headshot || '',
      age: ageFrom(p.person.birthDate), height: p.person.height ? `${(p.person.height / 100).toFixed(2)} m` : '', weight: p.person.weight ? `${p.person.weight} kg` : '',
      from: p.person.country?.name || '', years: null, salary: null, injury: null, injuryDetail: '', injuryReturn: null,
      avg: a ? { pts: a.pointsScored, reb: a.totalRebounds, ast: a.assists, min: a.minutesPlayed } : null
    };
  });
  const a = (Array.isArray(stats) ? stats[0] : stats)?.averagePerGame || {}, tot = (Array.isArray(stats) ? stats[0] : stats)?.accumulated || {};
  const pc = (m, n) => (n ? `${((m / n) * 100).toFixed(1)}` : null);
  const one = v => (v == null ? null : v.toFixed(1));
  const statRows = [['Puntos', one(a.points)], ['Rebotes', one(a.totalRebounds)], ['Asistencias', one(a.assistances)], ['Robos', one(a.steals)], ['Tapones', one(a.blocksFavour)],
    ['Pérdidas', one(a.turnovers)], ['Tiros de campo %', pc(tot.fieldGoalsMadeTotal, tot.fieldGoalsAttemptedTotal)], ['Triples %', pc(tot.fieldGoalsMade3, tot.fieldGoalsAttempted3)],
    ['Tiros libres %', pc(tot.freeThrowsMade, tot.freeThrowsAttempted)]].filter(([, v]) => v != null).map(([label, value]) => ({ label, value }));
  const top = (label, key, val) => {
    const ls = roster.map(p => ({ p, a: avgs[p.id] })).filter(x => x.a && val(x.a) != null).sort((x, y) => val(y.a) - val(x.a)).slice(0, 3);
    return ls.length ? [{ label, players: ls.map(x => ({ id: x.p.id, name: x.p.name, value: val(x.a).toFixed(1) })) }] : [];
  };
  const leaders = [['Puntos', 'pointsScored'], ['Rebotes', 'totalRebounds'], ['Asistencias', 'assists'], ['Triples', 'threePointersMade'], ['Robos', 'steals'], ['Tapones', 'blocks'], ['Minutos', 'minutesPlayed'], ['Valoración', 'pir']]
    .flatMap(([label, k]) => top(label, k, x => x[k]));
  const group = table.find(g => g.teams.some(x => x.id === id));
  const side = (t, me, won) => ({ me, abbr: t?.club?.tvCode || t?.club?.code || '', name: (t?.club?.editorialName || t?.club?.name || '').trim(), logo: t?.club?.images?.crest || '', score: t?.score != null ? String(t.score) : null, winner: won });
  const games = list.filter(g => g.local?.club?.code === id || g.road?.club?.code === id).map(g => {
    const home = g.local.club.code === id, me = home ? g.local : g.road, opp = home ? g.road : g.local;
    return { id: `${lg}:${g.season?.code || s}_${g.gameCode}`, date: g.utcDate, state: g.played ? 'post' : 'pre', home, us: side(me, true, g.played && me.score > opp.score), them: side(opp, false, g.played && opp.score > me.score) };
  });
  const row = group?.teams.find(x => x.id === id);
  const any = list.map(g => [g.local, g.road]).flat().find(t => t?.club?.code === id)?.club;
  return {
    id, league: lg, name: (club.name || any?.name || '').replace(/\s+/g, ' ').trim(), abbr: any?.tvCode || id, logo: club.images?.crest || any?.images?.crest || '', color: '',
    coach: niceName(staff.find(p => p.typeName === 'Coach')?.person?.name) || '', venue: club.venue?.name ? niceName(club.venue.name) : '', capacity: club.venue?.capacity || null,
    city: club.city ? niceName(club.city) : '', country: club.country?.name || '', president: club.president || '', website: club.website || '', division: '',
    group: group?.name || '', standing: row || null, stats: statRows, leaders,
    results: games.filter(g => g.state === 'post').sort((x, y) => new Date(y.date) - new Date(x.date)).slice(0, 10),
    upcoming: games.filter(g => g.state !== 'post').sort((x, y) => new Date(x.date) - new Date(y.date)).slice(0, 5),
    roster
  };
}

module.exports.standings = standings;
module.exports.team = team;
